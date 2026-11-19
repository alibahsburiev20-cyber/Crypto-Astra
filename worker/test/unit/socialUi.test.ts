import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Клиент «Социального»: два новых раздела в меню и доке, спрайты на месте,
// экраны ходят в /social и /guild, а не рисуют данные из головы.

const root = new URL('../../../', import.meta.url);
const html = readFileSync(new URL('client/index.html', root), 'utf8');
const app = readFileSync(new URL('client/app.js', root), 'utf8');
const css = readFileSync(new URL('client/styles.css', root), 'utf8');

const file = (path: string) => new URL(`client/${path}`, root);
const sizeOf = (path: string) => statSync(file(path)).size;

describe('клиент социального (этап 4)', () => {
  it('разделы «Задания» и «Команда» есть в меню и в доке', () => {
    expect((html.match(/data-view="missions"/g) ?? []).length).toBe(2);
    expect((html.match(/data-view="guild"/g) ?? []).length).toBe(2);
    // Гильдии больше не «скоро»: заглушка убрана.
    expect(html).not.toContain('data-soon="Гильдии"');
    expect(html).toContain('/icons/nav/missions.png');
    expect(html).toContain('/icons/nav/guild.png');
  });

  it('экраны запрашивают /social и /guild и умеют забирать награды', () => {
    expect(app).toContain("authed('/social')");
    expect(app).toContain("authed('/guild')");
    expect(app).toContain('function renderMissions');
    expect(app).toContain('function renderGuild');
    expect(app).toContain("/missions/claim");
    expect(app).toContain("/pass/claim");
    expect(app).toContain("/guild/create");
    expect(app).toContain("/guild/join");
    expect(app).toContain("/guild/kick");
    expect(app).toContain("/referrals/apply");
  });

  it('все коды ошибок социального переведены', () => {
    for (const code of ['mission_incomplete', 'pass_locked', 'guild_full', 'self_referral', 'referral_limit']) {
      expect(app).toContain(`${code}:`);
    }
  });

  it('спрайты существуют и не тяжелее 40 КБ', () => {
    const sprites: [string, number][] = [
      ['icons/nav/missions.png', 64],
      ['icons/nav/guild.png', 64],
      ['icons/social/pass.png', 128],
      ['icons/social/badge.png', 64],
      ['icons/social/banner.png', 96],
    ];
    for (const [path, px] of sprites) {
      const buf = readFileSync(file(path));
      // PNG-сигнатура и размер из IHDR: проверяем, что это действительно картинка нужного размера.
      expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
      expect(buf.readUInt32BE(16)).toBe(px);
      expect(buf.readUInt32BE(20)).toBe(px);
      expect(sizeOf(path)).toBeLessThan(40 * 1024);
    }
    expect(app).toContain('/icons/social/pass.png');
    expect(app).toContain('/icons/social/badge.png');
    expect(app).toContain('/icons/social/banner.png');
  });

  it('док рассчитан на одиннадцать разделов', () => {
    expect(css).toContain('repeat(11, 1fr)');
    expect(css).toContain('.pass-track');
    expect(css).toContain('.ach-grid');
    expect(css).toContain('.guild-hero');
  });
});
