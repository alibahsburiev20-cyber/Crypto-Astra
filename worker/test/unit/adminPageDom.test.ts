// Админская страница: что обещано разметкой, то и в коде.
//
// Отдельный DOM-тест — потому что админку «проверяют руками»: ни игрового
// клиента, ни e2e на неё нет. Здесь закреплено то, что иначе проверяется только
// глазами владельца: поле для ключа помощника есть, ключ не уезжает в
// localStorage, а ссылка-приглашение разбирается из фрагмента.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../../', import.meta.url);
const html = readFileSync(new URL('client/admin.html', root), 'utf8');
const js = readFileSync(new URL('client/admin.js', root), 'utf8');

describe('админка: разметка и скрипт про доступы и игроков', () => {
  it('поле для ключа помощника и подпись о роли — в разметке', () => {
    expect(html).toContain('id="key"');
    expect(html).toContain('id="role"');
    expect(html).toContain('astra-admin_');
    // Никаких подсказок «введите пароль»: токен и ключ — секреты, а не пароли.
    expect(html.toLowerCase()).not.toContain('type="text"');
  });

  it('ключ уходит заголовком, а не в URL и не на диск', () => {
    expect(js).toContain("'X-Admin-Key'");
    expect(js).toContain("sessionStorage.setItem(KEY_SESSION");
    expect(js).not.toContain('localStorage');
    // Фрагмент ссылки стирается из адресной строки сразу после чтения.
    expect(js).toContain('history.replaceState');
    expect(js).toMatch(/[#&]k=/);
  });

  it('пустой заголовок не отправляется', () => {
    // `{'X-Admin-Token': ''}` сервер читал бы как «пустая попытка»; пустые
    // заголовки не должны уезжать вовсе.
    expect(js).toContain("...(token() ? { 'X-Admin-Token': token() } : {})");
    expect(js).toContain("...(adminKey() ? { 'X-Admin-Key': adminKey() } : {})");
  });

  it('карточка игрока: поиск, блокировка, удаление с подтверждением', () => {
    for (const id of ['player-ref', 'player-find', 'player-block', 'player-unblock', 'player-close', 'player-reason', 'player-confirm', 'player-card', 'player-status']) {
      expect(html, id).toContain(`id="${id}"`);
      expect(js, id).toContain(`#${id}`);
    }
    expect(js).toContain('/admin/player');
    expect(js).toContain('/admin/player/block');
    expect(js).toContain('/admin/player/close');
    // Подтверждение удаления — текст DELETE, как у самоудаления игрока.
    expect(js).toContain("'DELETE'");
  });

  it('удаление раскрывается в два касания, а не по одному клику', () => {
    // Поле подтверждения спрятано в разметке и появляется только после первого
    // нажатия: «аккаунта нет» после одного случайного клика — это не админка.
    expect(html).toContain('id="player-confirm-wrap" hidden');
    expect(js).toContain('wrap.hidden = false');
    expect(js).toContain("$('#player-confirm-wrap').hidden = true");
    expect(js).toContain("$('#player-confirm').focus()");
    // И не переезжает на другого игрока: поиск прячет поле обратно.
    expect(js).toMatch(/renderPlayer[\s\S]{0,500}player-confirm-wrap/);
  });

  it('доступы: выдача, список, отзыв, журнал', () => {
    for (const id of ['invite-label', 'invite-email', 'invite-days', 'invite-limit', 'invite-create', 'invite-link', 'invite-href', 'invite-copy', 'staff', 'audit']) {
      expect(html, id).toContain(`id="${id}"`);
      expect(js, id).toContain(`#${id}`);
    }
    expect(js).toContain('/admin/accounts/invite');
    expect(js).toContain('/admin/accounts/revoke');
    expect(js).toContain('/admin/audit');
    expect(js).toContain('/admin/session');
  });

  it('кнопки, которые младшему недоступны, отключаются, а не «молча отказывают»', () => {
    expect(js).toContain('function applyRole');
    // Отказ «только владельцу» назван словом, а не кодом: оператор читает экран.
    expect(js).toContain('owner_only:');
    expect(js).toContain('только для владельца');
    for (const sel of ['freeze', 'pay-stop', 'pay-resume', 'pool-add', 'player-close']) {
      expect(js, sel).toContain(`#${sel}`);
    }
  });

  it('ключи словаря ошибок покрывают новые отказы сервера', () => {
    for (const code of ['admin_key_unknown', 'admin_key_revoked', 'admin_key_expired', 'admin_store_unavailable',
      'owner_only', 'grant_limit', 'player_has_funds', 'confirm_required', 'not_blocked', 'player_already_closed',
      'bad_days', 'bad_grant_limit', 'bad_label', 'bad_email', 'account_not_active']) {
      expect(js, code).toContain(`${code}:`);
    }
  });

  it('ссылку-приглашение показывают один раз и копируют в буфер', () => {
    expect(js).toContain('navigator.clipboard');
    expect(js).toContain('data.link');
    // Открытый ключ не пишем в поле формы: только в ответе-ссылке.
    expect(js).not.toContain("$('#invite-key').value");
  });

  it('USDT: списание двухшаговое и превью, и слово подтверждения', () => {
    for (const id of ['adj-player', 'adj-amount', 'adj-reason', 'adj-confirm', 'adj-confirm-wrap',
      'adj-preview', 'adj-preview-btn', 'adj-apply', 'adj-balance', 'adj-load', 'adj-flip', 'adj-status']) {
      expect(html, id).toContain(`id="${id}"`);
      expect(js, id).toContain(`#${id}`);
    }
    expect(js).toContain('/admin/pay/adjust');
    // Слово подтверждения видно человеку в разметке и совпадает с серверным.
    expect(html).toContain('<code>ADJUST</code>');
    // Enter в полях — только превью; запись — из поля подтверждения.
    expect(js).toContain('adjRun(true)');
    expect(js).toContain('adjRun(false)');
    // Превью и запись различаются: `dryRun` обязано доезжать до сервера обоими значениями.
    expect(js).toContain('body: JSON.stringify({ ...v, idem: adjKey, dryRun, confirm:');
    // Ключ идемпотентности генерируется один на операцию: повторный клик обязан
    // вернуть ту же запись, а не списать второй раз.
    expect(js).toContain('let adjKeyUsed = false;');
    expect(js).toContain('if (dryRun) adjReady = true;');
  });

  it('раздел списания USDT скрыт до входа владельца', () => {
    expect(html).toContain('id="usdt-block" hidden');
    expect(js).toContain("'#usdt-block'");
    // Младший его не видит вовсе: сервер ответил бы `owner_only`. Сбор — там же.
    expect(js).toMatch(/\['#staff-block', '#audit-block', '#usdt-block', '#sweep-block'\]/);
  });

  it('сбор USDT: два шага, сеть в запросе, и журнал намерений', () => {
    for (const id of ['sweep-block', 'sweep-chain', 'sweep-address', 'sweep-load', 'sweep-flags', 'sweep-preview',
      'sweep-plan', 'sweep-plan-btn', 'sweep-run', 'sweep-confirm', 'sweep-confirm-wrap', 'sweep-status', 'sweep-log']) {
      expect(html, id).toContain(`id="${id}"`);
      expect(js, id).toContain(`#${id}`);
    }
    expect(js).toContain('/admin/pay/sweep/run');
    expect(js).toContain('/admin/pay/sweeps');
    // Слово подтверждения видно человеку в разметке и совпадает с серверным.
    expect(html).toContain('<code>SWEEP</code>');
    expect(js).toContain('sweepRun(true)');
    expect(js).toContain('sweepRun(false)');
    // dryRun доезжает обоими значениями, а не «всегда правда».
    expect(js).toContain('body: JSON.stringify({ ...v, idem: sweepKey, dryRun, confirm:');
    // Ключ операции один на попытку и сгорает после живой сборки: второй клик не
    // должен означать второй перевод.
    expect(js).toContain('function newSweepKey()');
    expect(js).toMatch(/if \(dryRun\) newSweepKey\(\);/);
    expect(js).toContain('sweepReady = true;');
  });

  it('кнопка сбора не живёт без флагов: объяснение читается до клика', () => {
    // `#sweep-flags` заполняется серверными флагами, а не догадками клиента.
    expect(js).toContain('const f = data.flags || {};');
    expect(js).toContain('PAYMENTS_ENABLED=');
    expect(js).toContain('SWEEP_ENABLED=');
  });

  it('ключи словаря ошибок покрывают отказы списания', () => {
    for (const code of ['balance_below_zero', 'below_pending_withdrawals', 'idem_conflict',
      'amount_too_big', 'bad_idem_key', 'payments_disabled']) {
      expect(js, code).toContain(`${code}:`);
    }
  });

  it('ничего денежного младшему не показывают, а не «показывают и режут на сервере»', () => {
    // Проверка на сервере обязательна и есть; здесь — что интерфейс о роли знает.
    expect(js).toContain("'#staff-block'");
    expect(js).toContain("'#audit-block'");
    expect(js).toContain('function applyRole');
    // До входа разделы доступов спрятаны: `reveal=false` на старте страницы.
    expect(js).toContain("applyRole({ role: 'owner', grantLimit: null }, false)");
  });
});
