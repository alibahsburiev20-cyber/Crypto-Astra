import { entitlements } from './shop';

// Какие рамки, следы и значки человек реально купил. Живёт рядом с покупками:
// источник истины — `pay_entitlements`, а не клиент и не мир.
//
// Мир получает готовые списки и проверяет по ним выбор игрока. Поэтому «надеть»
// некупленную рамку нельзя даже подделав запрос.

export interface OwnedCosmetics {
  frames: ('nebula' | 'ember' | 'premium')[];
  trails: ('nebula' | 'ember' | 'premium')[];
  badges: 'pioneer'[];
  premiumUntil: number | null;
}

export async function ownedCosmetics(db: D1Database, userId: string, now: number): Promise<OwnedCosmetics> {
  const list = await entitlements(db, userId);
  const frames = new Set<'nebula' | 'ember' | 'premium'>();
  const trails = new Set<'nebula' | 'ember' | 'premium'>();
  const badges = new Set<'pioneer'>();
  let premiumUntil: number | null = null;

  for (const item of list) {
    if (item.expiresAt !== null && item.expiresAt <= now) continue;
    if (item.cosmetic === 'skin:nebula') { frames.add('nebula'); trails.add('nebula'); }
    if (item.cosmetic === 'skin:ember') { frames.add('ember'); trails.add('ember'); }
    if (item.cosmetic === 'badge:pioneer') badges.add('pioneer');
    if (item.cosmetic === 'premium' || item.productId === 'premium_30') {
      frames.add('premium');
      trails.add('premium');
      premiumUntil = Math.max(premiumUntil ?? 0, item.expiresAt ?? 0) || null;
    }
  }

  return { frames: [...frames], trails: [...trails], badges: [...badges], premiumUntil };
}
