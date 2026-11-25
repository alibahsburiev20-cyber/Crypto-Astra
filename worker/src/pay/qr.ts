// QR-код для адреса пополнения — без внешних зависимостей и без сети у игрока.
//
// Зачем сервером: матрицу должен уметь рисовать любой клиент, а «сгенерировать
// картинку на стороннем CDN» для платёжной страницы означает «отдать чужому
// сервису адрес игрока». Плюс клиентская библиотека не прошла бы сверку с тем,
// что реально лежит в базе.
//
// Что здесь сознательно ограничено:
// - уровень коррекции M и версии 1–4 (до 62 байт). Адрес TRON — 34 символа,
//   адрес EVM — 42: помещаются оба, а большего здесь и не кодируется;
// - только байтовый режим (UTF-8). Альфа-numeric-упаковка сэкономила бы версию,
//   но добавила бы второй путь кодирования ради одного-двух модулей;
// - растр — PNG, не SVG: по правилу проекта в интерфейсе нет SVG (проверяется
//   `worker/test/unit/sprites.test.ts`), а zlib для IDAT даёт рантайм бесплатно
//   через `CompressionStream`. Масштаб подобран так, чтобы код не мылился и на
//   retina: 6 пикселей на модуль по умолчанию.
//
// Эталон — `segno` (см. `scripts/qr-golden.py`): матрицы сверяются побитово,
// поэтому здесь не «моя интерпретация стандарта», а тот же результат.

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // порождающий многочлен GF(2^8)
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/**
 * Многочлен генератора для `count` контрольных символов: произведение
 * (x - α^0)…(x - α^(count-1)), коэффициенты — ОТ СТАРШЕЙ степени к младшей
 * (старший равен 1 и при делении пропущен). Порядок здесь важнее формулы:
 * переставленные коэффициенты дают код, который корректно выглядит «на глаз»,
 * но не читается никаким сканером (синдромы ненулевые).
 */
function rsGenerator(count: number): Uint8Array {
  let poly = Uint8Array.from([1]);
  for (let i = 0; i < count; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]; // умножение на x сдвигает степени вверх
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Контрольные символы Рида — Соломона для одного блока данных. */
function rsEncode(data: Uint8Array, eccCount: number): Uint8Array {
  const gen = rsGenerator(eccCount);
  const res = new Uint8Array(eccCount);
  for (const byte of data) {
    const factor = byte ^ res[0];
    res.copyWithin(0, 1);
    res[eccCount - 1] = 0;
    for (let i = 0; i < eccCount; i++) res[i] ^= gfMul(gen[i + 1], factor);
  }
  return res;
}

/**
 * Что влезает в версию при уровне M: кодовых слов данных, контрольных слов на
 * блок, число блоков и позиции выравнивающих паттернов. Версии 5+ не нужны
 * (адрес короче), поэтому и таблицы нет.
 */
const VERSIONS = [
  { version: 1, dataCodewords: 16, eccPerBlock: 10, blocks: 1, align: [] as number[] },
  { version: 2, dataCodewords: 28, eccPerBlock: 16, blocks: 1, align: [6, 18] },
  { version: 3, dataCodewords: 44, eccPerBlock: 26, blocks: 1, align: [6, 22] },
  { version: 4, dataCodewords: 64, eccPerBlock: 18, blocks: 2, align: [6, 26] },
];

/** «Остаточные» биты после данных: у версий 2–6 их 7, они всегда нули. */
function remainderBits(version: number): number {
  return version === 1 ? 0 : 7;
}

export type QrMatrix = {
  /** Сторона в модулях, без тихой зоны. */
  size: number;
  version: number;
  mask: number;
  /** Индексы тёмных модулей строкой `'01'…` по `size` символов. */
  rows: string[];
};

/** Максимум байт, который помещается в выбранную версию (байтовый режим). */
export function qrCapacity(version: number): number {
  const spec = VERSIONS.find((v) => v.version === version);
  if (!spec) return 0;
  // 4 бита режима + 8 бит длины = 12 бит служебного заголовка.
  return Math.floor((spec.dataCodewords * 8 - 12) / 8);
}

export const QR_MAX_BYTES = qrCapacity(4);

function encodeCodewords(bytes: Uint8Array): { codewords: Uint8Array; spec: (typeof VERSIONS)[number] } {
  const spec = VERSIONS.find((v) => qrCapacity(v.version) >= bytes.length);
  if (!spec) throw new Error('qr_payload_too_long');
  const bits: number[] = [];
  const push = (value: number, count: number) => {
    for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4); // байтовый режим
  push(bytes.length, 8); // для версий 1–9 счётчик — 8 бит
  for (const byte of bytes) push(byte, 8);

  const capacityBits = spec.dataCodewords * 8;
  // Терминатор короче 4 бит, если место только под него, — это по стандарту.
  push(0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = new Uint8Array(spec.dataCodewords);
  for (let i = 0; i < bits.length / 8; i++) {
    let value = 0;
    for (let j = 0; j < 8; j++) value = (value << 1) | bits[i * 8 + j];
    codewords[i] = value;
  }
  const pad = [0xec, 0x11];
  for (let i = bits.length / 8; i < spec.dataCodewords; i++) codewords[i] = pad[(i - bits.length / 8) % 2];
  return { codewords, spec };
}

/** Разбивка на блоки, контрольные суммы и чередование — как требует стандарт. */
function interleave(codewords: Uint8Array, spec: (typeof VERSIONS)[number]): number[] {
  const blocks: Uint8Array[] = [];
  const ecc: Uint8Array[] = [];
  // В версиях 1–4 при уровне M блоки равные: делить остаток не нужно.
  const perBlock = spec.dataCodewords / spec.blocks;
  for (let i = 0; i < spec.blocks; i++) {
    const chunk = codewords.slice(i * perBlock, (i + 1) * perBlock);
    blocks.push(chunk);
    ecc.push(rsEncode(chunk, spec.eccPerBlock));
  }
  const out: number[] = [];
  for (let i = 0; i < perBlock; i++) for (const block of blocks) out.push(block[i]);
  for (let i = 0; i < spec.eccPerBlock; i++) for (const block of ecc) out.push(block[i]);
  for (let i = 0; i < remainderBits(spec.version); i++) out.push(0);
  return out;
}

const MASKS = [
  (r: number, c: number) => (r + c) % 2 === 0,
  (r: number) => r % 2 === 0,
  (_r: number, c: number) => c % 3 === 0,
  (r: number, c: number) => (r + c) % 3 === 0,
  (r: number, c: number) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r: number, c: number) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r: number, c: number) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r: number, c: number) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function formatBits(mask: number): number {
  // Уровень M = 00 по таблице QR.
  const data = (0b00 << 3) | mask;
  let rem = data << 10;
  for (let i = 4; i >= 0; i--) {
    if (rem & (1 << (i + 10))) rem ^= 0x537 << i;
  }
  return ((data << 10) | rem) ^ 0x5412;
}

/**
 * Центры выравнивающих паттернов. Из декартова произведения позиций выбрасываются
 * ровно три угла — те, что попадают на поисковые паттерны: (первый,первый),
 * (первый,последний), (последний,первый). Ошибка в этом условии стоит не «картинка
 * чуть другая», а весь поток данных: 25 модулей сдвигают раскладку, и сканер
 * читает мусор (проверено на эталоне — см. `payQr.test.ts`).
 */
function alignmentCenters(spec: (typeof VERSIONS)[number]): [number, number][] {
  const positions = spec.align;
  if (positions.length < 2) return [];
  const first = positions[0]!;
  const last = positions[positions.length - 1]!;
  const out: [number, number][] = [];
  for (const r of positions) {
    for (const c of positions) {
      if ((r === first && c === first) || (r === first && c === last) || (r === last && c === first)) continue;
      out.push([r, c]);
    }
  }
  return out;
}

/**
 * Сетка служебных модулей: куда нельзя ставить данные. Паттерны рисуем тем же
 * обходом, что и проверку «не залезли ли мы на чужое», — иначе они разъедутся.
 */
function reservedMap(size: number, spec: (typeof VERSIONS)[number]): Uint8Array {
  const reserved = new Uint8Array(size * size);
  const set = (r: number, c: number) => {
    if (r >= 0 && c >= 0 && r < size && c < size) reserved[r * size + c] = 1;
  };
  const corners = [[0, 0], [0, size - 8], [size - 8, 0]] as const;
  for (const [row, col] of corners) {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) set(row + r, col + c);
  }
  for (let i = 0; i < size; i++) { set(6, i); set(i, 6); } // тайминги
  for (const [r, c] of alignmentCenters(spec)) {
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc);
  }
  for (let i = 0; i <= 8; i++) { set(8, i); set(i, 8); } // информация о формате
  for (let i = 0; i < 8; i++) { set(8, size - 1 - i); set(size - 1 - i, 8); }
  return reserved;
}

/**
 * Поисковый паттерн: тёмное кольцо 7×7 и тёмное ядро 3×3, вокруг — белый
 * разделитель. `row`/`col` — верхний левый угол семёрки; обход на -1…7 затем
 * прокрашивает разделитель белым там, где он внутри матрицы.
 */
function drawFinder(put: (r: number, c: number, dark: boolean) => void, row: number, col: number, size: number): void {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
      const inner = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const ring = inner && (r === 0 || r === 6 || c === 0 || c === 6);
      const core = inner && r >= 2 && r <= 4 && c >= 2 && c <= 4;
      put(rr, cc, ring || core);
    }
  }
}

function drawPatterns(
  modules: Uint8Array, size: number, spec: (typeof VERSIONS)[number], mask: number,
): void {
  const put = (r: number, c: number, dark: boolean) => { modules[r * size + c] = dark ? 1 : 0; };
  drawFinder(put, 0, 0, size);
  drawFinder(put, 0, size - 7, size);
  drawFinder(put, size - 7, 0, size);
  for (let i = 8; i < size - 8; i++) { put(6, i, i % 2 === 0); put(i, 6, i % 2 === 0); }
  for (const [r, c] of alignmentCenters(spec)) {
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) put(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
  }
  const format = formatBits(mask);
  for (let i = 0; i < 15; i++) {
    // Порядок — от старшего бита к младшему: «бит 0» в спецификации это MSB
    // пятнадцатибитного слова, а не младший разряд.
    const bit = ((format >> (14 - i)) & 1) === 1;
    // Копия 1 — вокруг левого верхнего паттерна, копия 2 — у правого нижнего.
    if (i < 6) put(8, i, bit);
    else if (i === 6) put(8, 7, bit);
    else if (i === 7) put(8, 8, bit);
    else if (i === 8) put(7, 8, bit);
    else put(14 - i, 8, bit);
    // В копии 2 ряд (size-8, 8) занят обязательным тёмным модулем: бит формата
    // встал бы поверх него, и сканер потерял бы якорь. Это ровно одна ячейка, но
    // именно она решает, прочитается код или нет.
    if (i === 7) put(8, size - 8, bit);
    else if (i < 8) {
      if (size - 1 - i !== size - 8) put(size - 1 - i, 8, bit);
    } else put(8, size - 15 + i, bit);
  }
  put(size - 8, 8, true); // обязательный тёмный модуль — ставим последним
}

/** Штраф за маску: четыре правила из ISO/IEC 18004. Нужна читаемость, а не эстетика. */
function penalty(modules: Uint8Array, size: number): number {
  let score = 0;
  const runPenalty = (get: (i: number) => number) => {
    let run = 1;
    for (let i = 1; i < size; i++) {
      if (get(i) === get(i - 1)) {
        run++;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      } else run = 1;
    }
  };
  for (let r = 0; r < size; r++) runPenalty((i) => modules[r * size + i]);
  for (let c = 0; c < size; c++) runPenalty((i) => modules[i * size + c]);

  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const value = modules[r * size + c];
      if (value === modules[r * size + c + 1] && value === modules[(r + 1) * size + c]
        && value === modules[(r + 1) * size + c + 1]) score += 3;
    }
  }

  const pattern = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const countPattern = (get: (i: number) => number) => {
    for (let start = 0; start <= size - pattern.length; start++) {
      let hits = 0;
      for (let i = 0; i < pattern.length; i++) if (get(start + i) === pattern[i]) hits++;
      if (hits === pattern.length) score += 40;
    }
  };
  for (let r = 0; r < size; r++) countPattern((i) => modules[r * size + i]);
  for (let c = 0; c < size; c++) countPattern((i) => modules[i * size + c]);

  let dark = 0;
  for (let i = 0; i < modules.length; i++) dark += modules[i];
  const percent = (dark * 100) / modules.length;
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

/**
 * Матрица QR для текста. `mask` — для тестов и повторимости; в бою маска
 * выбирается по штрафу, как предписывает стандарт.
 */
export function qrMatrix(text: string, options: { mask?: number } = {}): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  if (!bytes.length) throw new Error('qr_empty_payload');
  const { codewords, spec } = encodeCodewords(bytes);
  // Кода слова — байты, а матрица заполняется битами: старший бит pertama,
  // порядок байтов тот, что дало чередование блоков.
  const stream: number[] = [];
  for (const word of interleave(codewords, spec)) {
    for (let bit = 7; bit >= 0; bit--) stream.push((word >>> bit) & 1);
  }
  const size = spec.version * 4 + 17;
  const reserved = reservedMap(size, spec);

  const place = (modules: Uint8Array, maskFn: (r: number, c: number) => boolean) => {
    let index = 0;
    let upward = true;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--; // столбец 6 занят таймингом
      for (let step = 0; step < size; step++) {
        const row = upward ? size - 1 - step : step;
        for (let c = 0; c < 2; c++) {
          const column = col - c;
          if (reserved[row * size + column]) continue;
          const bit = index < stream.length ? (stream[index] ?? 0) : 0;
          index++;
          modules[row * size + column] = (bit ^ (maskFn(row, column) ? 1 : 0)) & 1;
        }
      }
      upward = !upward;
    }
  };

  const candidates: { mask: number; modules: Uint8Array; score: number }[] = [];
  const masks = options.mask !== undefined ? [options.mask] : [0, 1, 2, 3, 4, 5, 6, 7];
  for (const mask of masks) {
    const modules = new Uint8Array(size * size);
    drawPatterns(modules, size, spec, mask);
    place(modules, MASKS[mask]!);
    // Штраф считаем один раз на кандидата: в свободном тарифе CPU у Worker лимитирован,
    // а сравнивать придётся восемь матриц.
    candidates.push({ mask, modules, score: options.mask !== undefined ? 0 : penalty(modules, size) });
  }
  let best = candidates[0]!;
  if (options.mask === undefined) {
    for (const candidate of candidates) if (candidate.score < best.score) best = candidate;
  }

  const rows: string[] = [];
  for (let r = 0; r < size; r++) {
    let line = '';
    for (let c = 0; c < size; c++) line += best.modules[r * size + c] ? '1' : '0';
    rows.push(line);
  }
  return { size, version: spec.version, mask: best.mask, rows };
}

const QUIET = 4; // модулей тихой зоны — минимум по стандарту
export const QR_DEFAULT_SCALE = 6;
export const QR_MAX_SCALE = 16; // потолок: запрос из URL не должен рисовать полотно в 10 тысяч пикселей

const PNG_CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = PNG_CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** zlib-поток (обёртка над deflate) — ровно то, что требует формат PNG в IDAT. */
async function zlibDeflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(bytes).body!.pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * PNG-картинка кода: чёрно-белый растр, 1 бит на пиксель. Один `<img>` с таким
 * источником читается любым сканером кошелька, а в браузере это не документ и
 * не чужая разметка — просто битмап.
 */
export async function qrPng(text: string, options: { mask?: number; scale?: number } = {}): Promise<Uint8Array> {
  const matrix = qrMatrix(text, { mask: options.mask });
  // `Number.isFinite` обязательно: `?scale=abc` из URL иначе превращает размер в NaN.
  const wanted = Number.isFinite(options.scale as number) ? Math.trunc(options.scale as number) : QR_DEFAULT_SCALE;
  const scale = Math.max(1, Math.min(QR_MAX_SCALE, wanted));
  const side = (matrix.size + QUIET * 2) * scale;
  const rowBytes = Math.ceil(side / 8);
  const raw = new Uint8Array(side * (rowBytes + 1));
  for (let y = 0; y < side; y++) {
    const row = Math.floor(y / scale) - QUIET;
    const line = row >= 0 && row < matrix.size ? matrix.rows[row]! : '';
    let o = y * (rowBytes + 1);
    raw[o++] = 0; // фильтр строки «None»: пиксели пишутся как есть
    for (let x = 0; x < side; x++) {
      const col = line ? Math.floor(x / scale) - QUIET : -1;
      const dark = col >= 0 && col < matrix.size && line[col] === '1';
      // В 1-битном grayscale 1 = белый: тёмный модуль — это «не установить бит».
      if (!dark) raw[o + (x >> 3)] |= 1 << (7 - (x & 7));
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, side);
  view.setUint32(4, side);
  ihdr[8] = 1; // глубина: 1 бит
  // colorType 0 (grayscale), compression 0, filter 0, interlace 0 — нули по умолчанию.
  const idat = await zlibDeflate(raw);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let off = 0;
  for (const part of parts) {
    out.set(part, off);
    off += part.length;
  }
  return out;
}
