import type { Env } from '../env';

export interface AdsConfig {
  enabled: boolean;
  provider: string | null;
  unit_id: string | null;
  script_url: string | null;
}

const clean = (v: string | undefined): string => (v ?? '').trim();

/**
 * Реклама включается только при явном ADS_ENABLED=true и наличии сниппета.
 * Пока договора нет, слот на клиенте не рендерится вообще — это дефолт.
 */
export function adsConfig(env: Env): AdsConfig {
  const on = clean(env.ADS_ENABLED).toLowerCase() === 'true';
  const script = clean(env.ADS_SCRIPT_URL);
  const enabled = on && script.length > 0;
  return {
    enabled,
    provider: enabled ? clean(env.ADS_PROVIDER) || null : null,
    unit_id: enabled ? clean(env.ADS_UNIT_ID) || null : null,
    script_url: enabled ? script : null,
  };
}
