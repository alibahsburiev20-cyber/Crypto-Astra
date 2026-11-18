import { describe, expect, it } from 'vitest';
import { adsConfig } from '../../src/ads/config';
import type { Env } from '../../src/env';

const env = (patch: Partial<Env>): Env => ({ ...patch } as unknown as Env);

describe('adsConfig', () => {
  it('по умолчанию реклама выключена и наружу ничего не отдаётся', () => {
    expect(adsConfig(env({}))).toEqual({ enabled: false, provider: null, unit_id: null, script_url: null });
  });

  it('одного ADS_ENABLED без сниппета недостаточно', () => {
    expect(adsConfig(env({ ADS_ENABLED: 'true' })).enabled).toBe(false);
  });

  it('включается только при флаге и ссылке на сниппет', () => {
    const cfg = adsConfig(env({
      ADS_ENABLED: 'true',
      ADS_PROVIDER: 'cryptocoinsad',
      ADS_UNIT_ID: 'unit-1',
      ADS_SCRIPT_URL: 'https://cryptocoinsad.com/snippet.js',
    }));
    expect(cfg).toEqual({
      enabled: true,
      provider: 'cryptocoinsad',
      unit_id: 'unit-1',
      script_url: 'https://cryptocoinsad.com/snippet.js',
    });
  });

  it('ADS_ENABLED=false перебивает любые прочие значения', () => {
    const cfg = adsConfig(env({
      ADS_ENABLED: 'false',
      ADS_SCRIPT_URL: 'https://cryptocoinsad.com/snippet.js',
    }));
    expect(cfg.enabled).toBe(false);
  });
});
