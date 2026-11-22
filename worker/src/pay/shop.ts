// Магазин Astra Pay.
//
// Первая версия продаёт только косметику и разовые услуги. Никакой подписки,
// никаких «бустеров» и ничего, что влияет на баланс игры: ASTRA нельзя купить,
// а купленное не даёт преимущества в механике.
//
// Цены живут на сервере. Клиент присылает только `productId` и ключ
// идемпотентности — прислать цену он не может.
//
// Покупка защищена дважды:
//   * запись в журнал вставляется только если денег хватает
//     (`INSERT … SELECT … WHERE сумма >= цена`) — гонка не уводит баланс в минус;
//   * выдача вставляется только если запись в журнал реально появилась
//     (`WHERE EXISTS (… idem_key …)`) — «товар без оплаты» невозможен.
// Обе вставки идут одной пачкой, поэтому половины покупки не бывает.

import { formatMicroUsdt } from './tron/amount';
import { payBalanceMicro, payLedgerHead, payCanonical } from './ledger';
import { sha256Hex } from '../shared/sha256';

export type ProductKind = 'cosmetic' | 'service' | 'premium';

export interface PayProduct {
  id: string;
  kind: ProductKind;
  title: string;
  description: string;
  /** Иконка-спрайт из `client/sprites/` или встроенный emoji-код. */
  icon: string;
  priceMicro: number;
  /** Название косметики, которое попадает в профиль. */
  cosmetic?: string;
  /** Корпус, к которому применяется скин. Пусто — ко всем. */
  hull?: string;
  /** Срок действия в днях. Пусто — навсегда. */
  durationDays?: number;
  enabled: boolean;
}

export class ShopError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = 'ShopError';
    this.code = code;
  }
}

/**
 * Каталог. Цены — в микро-USDT, целыми. Менять их можно только здесь: клиент
 * цену не присылает. `enabled: false` — товар виден в списке как «скоро».
 */
export const PRODUCTS: PayProduct[] = [
  {
    id: 'skin_nebula',
    kind: 'cosmetic',
    title: 'Корпус «Небула»',
    description: 'Окраска корпуса корабля. Только внешний вид.',
    icon: '🛰️',
    cosmetic: 'skin:nebula',
    priceMicro: 2_000_000,
    enabled: true,
  },
  {
    id: 'skin_ember',
    kind: 'cosmetic',
    title: 'Корпус «Уголь»',
    description: 'Тёмная окраска с оранжевыми полосами.',
    icon: '🔥',
    cosmetic: 'skin:ember',
    priceMicro: 2_000_000,
    enabled: true,
  },
  {
    id: 'badge_pioneer',
    kind: 'cosmetic',
    title: 'Значок «Первопроходец»',
    description: 'Значок в профиле и в списке гильдии.',
    icon: '🧭',
    cosmetic: 'badge:pioneer',
    priceMicro: 1_000_000,
    enabled: true,
  },
  {
    id: 'callsign_custom',
    kind: 'service',
    title: 'Свой позывной',
    description: 'Смена отображаемого имени один раз.',
    icon: '✍️',
    priceMicro: 3_000_000,
    enabled: true,
  },
  {
    id: 'premium_30',
    kind: 'premium',
    title: 'Astra Premium · 30 дней',
    description: 'Значок Premium у позывного, эксклюзивный корпус, второй слот Astra Pass и +2 попытки на арене каждый день. Без влияния на экономику и рейтинг пула.',
    icon: '💎',
    cosmetic: 'premium',
    durationDays: 30,
    priceMicro: 5_000_000,
    enabled: true,
  },
  {
    id: 'skin_nebula_premium',
    kind: 'cosmetic',
    title: 'Корпус «Гиперион» (Premium)',
    description: 'Эксклюзивная окраска для владельцев Premium.',
    icon: '🌟',
    cosmetic: 'skin:hyperion',
    hull: 'flagship',
    priceMicro: 1,
    enabled: false, // выдаётся вместе с Premium, отдельно не продаётся
  },
];

export function findProduct(id: string): PayProduct | null {
  return PRODUCTS.find((p) => p.id === id) ?? null;
}

/** Публичный каталог: без служебных полей, цены в человеческом виде. */
export function catalogForClient(): {
  id: string; kind: ProductKind; title: string; description: string; icon: string;
  priceMicro: number; price: string; enabled: boolean;
  durationDays: number | null; hull: string | null;
}[] {
  return PRODUCTS.filter((p) => p.enabled).map((p) => ({
    id: p.id,
    kind: p.kind,
    title: p.title,
    description: p.description,
    icon: p.icon,
    priceMicro: p.priceMicro,
    price: formatMicroUsdt(p.priceMicro),
    durationDays: p.durationDays ?? null,
    hull: p.hull ?? null,
    enabled: p.enabled,
  }));
}

export interface PurchaseInput {
  userId: string;
  productId: string;
  /** Ключ от клиента: повтор запроса не спишет деньги дважды. */
  idemKey: string;
}

export interface PurchaseResult {
  purchaseId: string;
  productId: string;
  priceMicro: number;
  balanceMicro: number;
  duplicated: boolean;
}

export async function purchase(
  db: D1Database,
  input: PurchaseInput,
  now: number,
): Promise<PurchaseResult> {
  const product = findProduct(String(input.productId ?? ''));
  if (!product || !product.enabled) throw new ShopError('unknown_product');

  const rawKey = String(input.idemKey ?? '').trim();
  if (!/^[A-Za-z0-9._:-]{8,64}$/.test(rawKey)) throw new ShopError('bad_idem_key');
  const idemKey = `buy:${input.userId}:${rawKey}`;
  const purchaseId = `pu_${hashId(idemKey)}`;

  const existing = await db.prepare('SELECT id FROM pay_entitlements WHERE user_id = ? AND purchase_id = ?')
    .bind(input.userId, purchaseId).first<string>('id');
  if (existing) {
    return {
      purchaseId, productId: product.id, priceMicro: product.priceMicro,
      balanceMicro: await payBalanceMicro(db, input.userId), duplicated: true,
    };
  }

  const balance = await payBalanceMicro(db, input.userId);
  if (balance < product.priceMicro) throw new ShopError('insufficient_funds');

  const prev = await payLedgerHead(db);
  const entry = {
    userId: input.userId,
    delta: -product.priceMicro,
    reason: 'purchase' as const,
    sourceRef: product.id,
    idemKey,
    createdAt: now,
  };
  const hash = sha256Hex(payCanonical(entry, prev));

  try {
    await db.batch([
      db.prepare(
        `INSERT INTO pay_ledger (id, user_id, asset, delta, reason, source_ref, idem_key, prev_hash, hash, created_at)
         SELECT ?, ?, 'USDT', ?, 'purchase', ?, ?, ?, ?, ?
          WHERE (SELECT COALESCE(SUM(delta), 0) FROM pay_ledger WHERE user_id = ?) >= ?`,
      ).bind(
        // delta отрицательная: покупка списывает деньги.
        `pl_${hash.slice(0, 24)}`, input.userId, -product.priceMicro, product.id, idemKey, prev, hash, now,
        input.userId, product.priceMicro,
      ),
      db.prepare(
        `INSERT INTO pay_entitlements (id, user_id, product_id, purchase_id, granted_at, expires_at, payload)
         SELECT ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM pay_ledger WHERE idem_key = ?)`,
      ).bind(
        `et_${hashId(idemKey)}`, input.userId, product.id, purchaseId, now,
        product.durationDays ? now + product.durationDays * 86_400_000 : null,
        JSON.stringify({ cosmetic: product.cosmetic ?? null, title: product.title }), idemKey,
      ),
      db.prepare(
        'INSERT INTO pay_audit_log (id, actor, action, target, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(
        `au_${hashId(idemKey)}`, input.userId, 'purchase', product.id,
        JSON.stringify({ priceMicro: product.priceMicro, idemKey: rawKey }), now,
      ),
    ]);
  } catch (e) {
    const again = await db.prepare('SELECT id FROM pay_entitlements WHERE user_id = ? AND purchase_id = ?')
      .bind(input.userId, purchaseId).first<string>('id');
    if (again) {
      return {
        purchaseId, productId: product.id, priceMicro: product.priceMicro,
        balanceMicro: await payBalanceMicro(db, input.userId), duplicated: true,
      };
    }
    throw e;
  }

  const after = await payBalanceMicro(db, input.userId);
  if (after < 0) {
    // Страховка: если гонка всё же увела баланс в минус, покупка не считается
    // выданной. Возврат денег делает админ компенсирующей записью.
    throw new ShopError('balance_race');
  }
  return { purchaseId, productId: product.id, priceMicro: product.priceMicro, balanceMicro: after, duplicated: false };
}

export interface Entitlement {
  productId: string;
  purchaseId: string;
  grantedAt: number;
  expiresAt: number | null;
  cosmetic: string | null;
}

export async function entitlements(db: D1Database, userId: string): Promise<Entitlement[]> {
  const { results } = await db.prepare(
    'SELECT product_id, purchase_id, granted_at, expires_at, payload FROM pay_entitlements WHERE user_id = ? ORDER BY granted_at DESC',
  ).bind(userId).all<{ product_id: string; purchase_id: string; granted_at: number; expires_at: number | null; payload: string }>();
  return (results ?? []).map((row) => {
    let cosmetic: string | null = null;
    try {
      cosmetic = (JSON.parse(row.payload) as { cosmetic?: string | null }).cosmetic ?? null;
    } catch {
      cosmetic = null;
    }
    return {
      productId: String(row.product_id),
      purchaseId: String(row.purchase_id),
      grantedAt: Number(row.granted_at),
      expiresAt: row.expires_at === null || row.expires_at === undefined ? null : Number(row.expires_at),
      cosmetic,
    };
  });
}

function hashId(text: string): string {
  return sha256Hex(text).slice(0, 24);
}

/** Активен ли Premium прямо сейчас. */
export async function premiumStatus(
  db: D1Database,
  userId: string,
  now: number,
): Promise<{ active: boolean; until: number | null }> {
  const row = await db.prepare(
    `SELECT MAX(expires_at) AS until FROM pay_entitlements
      WHERE user_id = ? AND product_id = 'premium_30' AND expires_at IS NOT NULL AND expires_at > ?`,
  ).bind(userId, now).first<number>('until');
  // Пустой результат — это «нет Premium», а не «Premium бессрочный».
  const until = row === null || row === undefined ? null : Number(row);
  return { active: until !== null && until > now, until };
}
