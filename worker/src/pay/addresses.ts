// Адреса игроков: один адрес, навсегда.
//
// Адрес не генерируется в основном Worker: он спрашивает его у Signer-контура,
// который знает семя. Основной Worker видит только результат — адрес и индекс.
// Поэтому утечка базы не даёт доступ к деньгам.
//
// Индекс выдаётся как «максимальный + 1» и защищён UNIQUE-ограничением: если два
// запроса пришли одновременно, второй получит ошибку и повторит попытку, а не
// займёт чужой индекс.

import type { Env } from '../env';
import { addressToHex } from './tron/address';

export interface DerivedAddress {
  index: number;
  address: string;
}

export interface AddressDeriver {
  derive(index: number): Promise<DerivedAddress>;
}

export interface PlayerAddress {
  address: string;
  index: number;
  hex: string;
  createdAt: number;
  created: boolean;
}

export async function findAddress(db: D1Database, userId: string): Promise<PlayerAddress | null> {
  const row = await db.prepare(
    'SELECT address, derivation_index, hex, created_at FROM pay_addresses WHERE user_id = ?',
  ).bind(userId).first<{ address: string; derivation_index: number; hex: string; created_at: number }>();
  if (!row) return null;
  return {
    address: String(row.address),
    index: Number(row.derivation_index),
    hex: String(row.hex),
    createdAt: Number(row.created_at),
    created: false,
  };
}

export async function ensureAddress(
  db: D1Database,
  userId: string,
  deriver: AddressDeriver,
  now: number,
): Promise<PlayerAddress> {
  const existing = await findAddress(db, userId);
  if (existing) return existing;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const row = await db.prepare('SELECT COALESCE(MAX(derivation_index), -1) AS last FROM pay_addresses')
      .first<number>('last');
    const index = Number(row ?? -1) + 1;

    const derived = await deriver.derive(index);

    const res = await db.prepare(
      `INSERT INTO pay_addresses (id, user_id, address, hex, derivation_index, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
    ).bind(`ad_${index}_${userId}`.slice(0, 64), userId, derived.address, addressToHex(derived.address), index, now).run();

    const changes = Number((res as { meta?: { changes?: number } }).meta?.changes ?? 0);
    if (changes) {
      return {
        address: derived.address,
        index,
        hex: addressToHex(derived.address),
        createdAt: now,
        created: true,
      };
    }

    // Кто-то успел раньше — возможно, для этого же игрока.
    const again = await findAddress(db, userId);
    if (again) return again;
  }
  throw new Error('address_allocation_failed');
}

/**
 * Клиент Signer-контура. В бою это service binding на отдельный Worker;
 * если биндинг не настроен, адреса не выдаются — и это правильно, лучше
 * ошибка, чем адрес от неизвестного источника.
 */
export function signerDeriver(env: Env): AddressDeriver {
  return {
    async derive(index: number): Promise<DerivedAddress> {
      const signer = env.SIGNER;
      const token = String(env.SIGNER_TOKEN ?? '');
      if (!signer || !token) throw new Error('signer_not_configured');
      const res = await signer.fetch('https://signer/address', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ index }),
      });
      if (!res.ok) throw new Error(`signer_${res.status}`);
      const data = await res.json() as { index?: number; address?: string };
      if (typeof data.address !== 'string' || data.index !== index) throw new Error('signer_bad_response');
      return { index, address: data.address };
    },
  };
}
