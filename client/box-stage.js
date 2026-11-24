// Анимация открытия бокса.
//
// Отдельный модуль, а не кусок app.js, по двум причинам:
//  1. его можно проверить в jsdom без всей игры (сеть, токены, таймеры мира);
//  2. таймлайн живёт в одном месте — правки анимации не задевают логику.
//
// Что происходит на экране:
//   0 мс    — вуаль, бокс выпрыгивает и парит;
//   350 мс  — тряска, звук;
//   800 мс  — крышка «выстреливает»: вспышка и искры;
//   850 мс+ — из центра вылетают ресурсы с иконками и количеством, по одному;
//   конец   — карточка «что выпало» и кнопка «Забрать».
//
// Клик по сцене проматывает анимацию к результату — ждать её никто не обязан.
// При `prefers-reduced-motion` анимации нет вовсе: сразу результат.

const SPARKS = 18;

/** Ресурсы из ответа сервера → чипы. Одинаковые складываются в один. */
export function stageItems(drops) {
  const out = [];
  for (const d of drops || []) {
    if (!d || !d.resource) continue;
    const amount = Math.max(0, Math.round(Number(d.amount) || 0));
    if (!amount) continue;
    const found = out.find((i) => i.resource === d.resource);
    if (found) found.amount += amount;
    else out.push({ resource: String(d.resource), name: String(d.name || d.resource), amount });
  }
  return out;
}

/**
 * Позиции чипов: веер вверх (до 140°), чтобы они не уезжали под панель итога.
 * Разброс симметричный: пара «слева — справа» получает одинаковый радиус,
 * иначе веер выглядит перекошенным.
 */
export function stageLayout(count, size) {
  const r = Math.min(150, Math.max(78, size * 0.28));
  const step = count <= 1 ? 0 : Math.min(52, 170 / (count - 1));
  return Array.from({ length: count }, (_, i) => {
    const deg = -90 + (i - (count - 1) / 2) * step;
    const rad = (deg * Math.PI) / 180;
    // Глубина зависит от удалённости от центра веера, а не от индекса: так
    // левый и правый край стоят на одной дуге.
    const k = Math.min(i, count - 1 - i);
    const radius = r * (0.92 + ((k * 7) % 5) / 40);
    // По горизонтали разброс шире, но чип шириной ~68 px не должен уезжать за
    // край: на экране 390 px это ±151 px от центра, берём с запасом.
    const maxTx = Math.max(56, size * 0.34);
    const maxTy = Math.max(56, size * 0.34);
    const tx = Math.cos(rad) * radius * 1.25;
    const ty = Math.sin(rad) * radius;
    return {
      tx: Math.round(Math.sign(tx) * Math.min(Math.abs(tx), maxTx)),
      ty: -Math.round(Math.min(Math.abs(ty), maxTy)),
      rot: Math.round(((i % 2 === 0 ? 1 : -1) * (3 + (i % 5))) * 10) / 10,
      delay: i * 70,
    };
  });
}

/**
 * Сцена открытия. Возвращает объект с `play(payload)`, `finish()` и `close()`.
 * Ничего не знает про сеть: данные приносит вызывающий.
 */
export function createBoxStage({ doc = globalThis.document, win = globalThis } = {}) {
  let root = null;
  let timers = [];
  let settled = false;
  let onClose = null;

  const reduced = () => {
    try { return !!win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; } catch { return false; }
  };
  const addTimer = (fn, ms) => { timers.push(setTimeout(fn, ms)); };
  const clearTimers = () => { for (const id of timers) clearTimeout(id); timers = []; };

  function spark(i) {
    const span = doc.createElement('span');
    span.className = 'box-spark';
    const deg = (360 / SPARKS) * i + (i % 3) * 7;
    const dist = 90 + ((i * 53) % 90);
    span.style.setProperty('--a', `${deg}deg`);
    span.style.setProperty('--d', `${dist}px`);
    span.style.setProperty('--s', `${2 + (i % 3)}px`);
    return span;
  }

  function chip(item, layout, index) {
    const node = doc.createElement('div');
    node.className = 'box-chip';
    if (item.rare) node.classList.add('is-rare');
    if (item.part) node.classList.add('is-part');
    node.dataset.resource = item.resource;
    node.style.setProperty('--tx', `${layout.tx}px`);
    node.style.setProperty('--ty', `${layout.ty}px`);
    node.style.setProperty('--r', `${layout.rot}deg`);
    node.style.setProperty('--delay', `${layout.delay}ms`);
    node.style.setProperty('--i', String(index));

    const img = doc.createElement('img');
    img.className = 'box-chip-art';
    img.src = `/icons/resources/${item.resource}.png`;
    img.alt = '';
    img.width = 38;
    img.height = 38;
    img.loading = 'eager';

    const count = doc.createElement('b');
    count.className = 'box-chip-count';
    count.textContent = `×${item.amount}`;

    const caption = doc.createElement('span');
    caption.className = 'box-chip-name';
    caption.textContent = item.name;

    node.append(img, count, caption);
    return node;
  }

  function build(payload) {
    const items = stageItems(payload.drops);
    const layout = stageLayout(items.length, Math.min(
      Number(win.innerWidth) || 360,
      Number(win.innerHeight) || 640,
    ));
    const kinds = new Set((payload.drops || []).map((d) => d.resource));
    // Компоненты и редкие ресурсы подсвечиваем: это половина удовольствия от бокса.
    const parts = new Set(['energy_cell', 'circuit', 'alloy_plate']);

    const veil = doc.createElement('div');
    veil.className = 'box-stage-veil';

    const glow = doc.createElement('div');
    glow.className = 'box-stage-glow';

    const box = doc.createElement('div');
    box.className = 'box-stage-box';
    const art = doc.createElement('img');
    art.className = 'box-stage-art';
    art.src = payload.sprite || '/sprites/boxes/daily.png';
    art.alt = payload.name ? `Бокс «${payload.name}»` : 'Бокс';
    art.width = 220;
    art.height = 220;
    box.append(art);

    const sparks = doc.createElement('div');
    sparks.className = 'box-stage-sparks';
    for (let i = 0; i < SPARKS; i++) sparks.append(spark(i));

    const chips = doc.createElement('div');
    chips.className = 'box-stage-items';
    items.forEach((item, i) => {
      chips.append(chip(
        { ...item, rare: item.resource === 'astralite' || item.resource === 'void_crystal' || item.resource === 'quantum_dust', part: parts.has(item.resource) },
        layout[i],
        i,
      ));
    });

    const result = doc.createElement('div');
    result.className = 'box-stage-result';
    const title = doc.createElement('b');
    title.textContent = payload.name ? `Из «${payload.name}» выпало:` : 'Выпало:';
    const list = doc.createElement('ul');
    list.className = 'box-stage-list';
    for (const item of items) {
      const li = doc.createElement('li');
      li.dataset.resource = item.resource;
      const icon = doc.createElement('img');
      icon.src = `/icons/resources/${item.resource}.png`;
      icon.alt = '';
      icon.width = 20;
      icon.height = 20;
      icon.loading = 'lazy';
      const name = doc.createElement('span');
      name.textContent = item.name;
      const amount = doc.createElement('b');
      amount.textContent = `×${item.amount}`;
      li.append(icon, name, amount);
      list.append(li);
    }
    const hint = doc.createElement('p');
    hint.className = 'box-stage-hint';
    const rare = kinds.has('astralite') || kinds.has('void_crystal') || kinds.has('quantum_dust');
    const componentCount = (payload.drops || []).filter((d) => parts.has(d.resource)).length;
    hint.textContent = [
      rare ? 'Редкая находка!' : '',
      componentCount ? `Компонентов: ${componentCount}` : '',
      'Всё уже на складе.',
    ].filter(Boolean).join(' ');
    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'cta';
    closeBtn.dataset.boxClose = '1';
    closeBtn.textContent = 'Забрать';
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); close(); });
    result.append(title, list, hint, closeBtn);

    root.append(veil, glow, sparks, chips, box, result);
    root.dataset.boxId = payload.box || '';
    return { items };
  }

  function cleanup() {
    clearTimers();
    if (root) {
      root.remove();
      root = null;
    }
    try { doc.body?.classList?.remove('is-box-stage'); } catch { /* нет body — не беда */ }
    doc.removeEventListener?.('keydown', onKey);
  }

  function close() {
    const cb = onClose;
    cleanup();
    settled = true;
    onClose = null;
    if (cb) cb();
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault?.(); finish(); }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault?.(); finish(); }
  }

  /** Проматывает анимацию: все чипы на местах, результат на экране. */
  function finish() {
    if (!root) return;
    clearTimers();
    root.classList.add('is-settled');
    const result = root.querySelector('.box-stage-result');
    if (result) result.hidden = false;
  }

  function open(payload, done) {
    close();
    onClose = done || null;
    settled = false;
    root = doc.createElement('div');
    root.className = 'box-stage';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', payload.name ? `Открытие: ${payload.name}` : 'Открытие бокса');
    build(payload);

    const result = root.querySelector('.box-stage-result');
    if (result) result.hidden = true;

    root.addEventListener('click', () => finish());
    doc.body.append(root);
    try { doc.body?.classList?.add('is-box-stage'); } catch { /* ignore */ }
    doc.addEventListener?.('keydown', onKey);

    if (reduced()) {
      root.classList.add('is-settled');
      if (result) result.hidden = false;
      return;
    }

    addTimer(() => root?.classList.add('is-shaking'), 350);
    addTimer(() => root?.classList.add('is-opened'), 800);
    // Результат открываем после последнего чипа: иначе карточка перекрывает полёт.
    const lastChip = (root?.querySelectorAll('.box-chip').length || 1) - 1;
    addTimer(() => finish(), 1000 + lastChip * 70 + 700);
  }

  return {
    get opened() { return !!root; },
    play: open,
    finish,
    close,
    _cleanup: cleanup,
    get _settled() { return settled; },
  };
}

export default createBoxStage;
