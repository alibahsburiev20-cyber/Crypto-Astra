// Адреса игроков: один адрес на цепь, навсегда.
//
// «Навсегда» теперь привязано к сети, а не к игроку: у одной и той же пары
// (игрок, цепь) адрес не меняется никогда, а смена `PAY_CHAIN` выдаёт игроку
// адрес НОВОЙ цепи, не отменяя старый. Старый продолжает светиться в отчётах
// (казна, plan сбора) до тех пор, пока на нём есть деньги, — иначе переезд
// сети означал бы «адрес игроков исчез вместе с их балансом».
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
import { isEvmAddress, toChecksumAddress } from './evm/address';
import { isValidAddress as isTronAddress } from './tron/address';
import type { PayChain } from './units';

export interface DerivedAddress {
  index: number;
  address: string;
  /**
   * Значение для `pay_addresses.hex`. Формат адреса зависит от сети (TRON —
   * base58 → `41…`, EVM — те же 20 байт без `0x`), поэтому «hex» считает тот,
   * кто знает сеть, а не общий код.
   */
  hex?: string;
}

export interface AddressDeriver {
  derive(index: number): Promise<DerivedAddress>;
}

export interface PlayerAddress {
  address: string;
  /** Сеть, к которой адрес относится — то, что хранит колонка `chain`. */
  chain: PayChain;
  index: number;
  hex: string;
  createdAt: number;
  created: boolean;
}

export async function findAddress(db: D1Database, userId: string, chain: PayChain): Promise<PlayerAddress | null> {
  const row = await db.prepare(
    'SELECT address, chain, derivation_index, hex, created_at FROM pay_addresses WHERE user_id = ? AND chain = ?',
  ).bind(userId, chain).first<{ address: string; derivation_index: number; hex: string; created_at: number }>();
  if (!row) return null;
  return {
    address: String(row.address),
    chain,
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
  chain: PayChain,
): Promise<PlayerAddress> {
  const existing = await findAddress(db, userId, chain);
  if (existing) return existing;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const row = await db.prepare('SELECT COALESCE(MAX(derivation_index), -1) AS last FROM pay_addresses')
      .first<number>('last');
    const index = Number(row ?? -1) + 1;

    const derived = await deriver.derive(index);
    const hex = derived.hex ?? addressToHex(derived.address);

    const res = await db.prepare(
      `INSERT INTO pay_addresses (id, user_id, chain, address, hex, derivation_index, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
    ).bind(`ad_${index}_${userId}`.slice(0, 64), userId, chain, derived.address, hex, index, now).run();

    const changes = Number((res as { meta?: { changes?: number } }).meta?.changes ?? 0);
    if (changes) {
      return {
        address: derived.address,
        chain,
        index,
        hex,
        createdAt: now,
        created: true,
      };
    }

    // Кто-то успел раньше — возможно, для этого же игрока и этой же цепи.
    const again = await findAddress(db, userId, chain);
    if (again) return again;
  }
  throw new Error('address_allocation_failed');
}

/**
 * Клиент Signer-контура. В бою это service binding на отдельный Worker;
 * если биндинг не настроен, адреса не выдаются — и это правильно, лучше
 * ошибка, чем адрес от неизвестного источника.
 *
 * @param chain сеть, адрес которой просим. Одна строка `pay_addresses`
 *   относится ровно к одной цепи, и деривация должна идти по той же сети, под
 *   которой адрес потом ляжет в базу: разъехаться они имеют право только вместе
 *   с ошибкой.
 */
export function signerDeriver(env: Env, chain: PayChain = 'tron'): AddressDeriver {
  return {
    async derive(index: number): Promise<DerivedAddress> {
      const signer = env.SIGNER;
      const token = String(env.SIGNER_TOKEN ?? '');
      if (!signer || !token) throw new Error('signer_not_configured');
      const res = await signer.fetch('https://signer/address', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ index, chain }),
      });
      if (!res.ok) throw new Error(`signer_${res.status}`);
      const data = await res.json() as { index?: number; address?: string };
      if (typeof data.address !== 'string' || data.index !== index) throw new Error('signer_bad_response');
      if (chain !== 'tron') {
        // В базе — нижний регистр: событие из ноды приходит в нижнем регистре, и
        // сверка депозитов идёт сравнением строк. Красоту (EIP-55) включаем при
        // показе игроку, а не при хранении.
        if (!isEvmAddress(data.address)) throw new Error('signer_bad_address');
        const canonical = toChecksumAddress(data.address).toLowerCase();
        return { index, address: canonical, hex: canonical.slice(2) };
      }
      return { index, address: data.address, hex: addressToHex(data.address) };
    },
  };
}

/**
 * Формат адреса и есть цепь: `T…` существует только в TRON, `0x…` — только в EVM.
 * `unknown` — мусор в базе (ручная правка), и он не должен пройти как «наш».
 */
export function addressChain(address: string): PayChain | 'unknown' {
  const raw = String(address ?? '').trim();
  if (isEvmAddress(raw)) return 'bsc';
  if (isTronAddress(raw)) return 'tron';
  return 'unknown';
}

/**
 * Принадлежит ли адрес активной цепи.
 *
 * Это не косметика: при смене `PAY_CHAIN` у игрока в базе остаётся адрес старой
 * сети, а `user_id` уникален — второго адреса не будет. Показать такой адрес
 * значит отправить деньги в цепь, которую мы не сканируем: игрок заплатит, а
 * зачисления не будет. Поэтому «не совпало» — отказ, а не «покажем как есть».
 *
 * Сравнение идёт по ФОРМАТУ, а не по имени цепи, и вот почему: `0x…` одинаково
 * выглядит в BNB Chain и в Polygon (семя и индекс те же), поэтому «адрес polygon»
 * по строке адреса определить невозможно в принципе. Различает их только колонка
 * `pay_addresses.chain`, которую мы сами записали при выдаче, — а здесь вопрос
 * ровно «это EVM-адрес или TRON-адрес», и этого хватает, чтобы поймать ручную
 * правку базы и переезд между рельсами.
 */
export function addressMatchesChain(address: string, chain: PayChain): boolean {
  const format = addressChain(address);
  if (format === 'unknown') return false;
  return chain === 'tron' ? format === 'tron' : format === 'bsc';
}

/** Как адрес показывает игроку: в EVM — с контрольной суммой, иначе опечатку не отличить. */
export function displayAddress(chain: PayChain, address: string): string {
  if (chain === 'tron') return address;
  try {
    return toChecksumAddress(address);
  } catch {
    return address;
  }
}
