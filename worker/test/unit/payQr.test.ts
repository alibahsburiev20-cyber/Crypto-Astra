// QR адреса пополнения: кодировщик, картинка и маршрут.
//
// Почему тест такой придирчивый. QR — единственное место в витрине, где игрок
// получает 42 символа адреса не глазами, а камерой: ошибка здесь не «некрасивая
// картинка», а «деньги ушли на чужой адрес». Поэтому сверяемся не с собой, а с
// независимой реализацией: `segno` (см. `scripts/qr-golden.py`), и дополнительно
// проверяем контрольные символы синдромами — это другая арифметическая задача,
// чем то деление, которым ECC считается при кодировании.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { QR_MAX_BYTES, qrCapacity, qrMatrix, qrPng } from '../../src/pay/qr';
import { payQr } from '../../src/routes/pay';
import { hexToBase58 } from '../../src/pay/tron/address';

const FIXTURE = JSON.parse(
  readFileSync(new URL('../fixtures/payQr.json', import.meta.url), 'utf8'),
) as {
  cases: { text: string; mask: number; version: number; size: number; rows: string[] }[];
};

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
})();

const TRON_ADDR = hexToBase58('41' + '11'.repeat(20));
const EVM_ADDR = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';

/** Позиции служебных модулей — те же, что у кодировщика, но по описанию ISO. */
function reservedRows(size: number, version: number): boolean[][] {
  const res: boolean[][] = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const set = (r: number, c: number) => {
    if (r >= 0 && c >= 0 && r < size && c < size) res[r]![c] = true;
  };
  for (const [row, col] of [[0, 0], [0, size - 8], [size - 8, 0]] as const) {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) set(row + r, col + c);
  }
  for (let i = 0; i < size; i++) { set(6, i); set(i, 6); }
  const aligns: Record<number, number[]> = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26] };
  const positions = aligns[version] ?? [];
  if (positions.length > 1) {
    const first = positions[0]!;
    const last = positions[positions.length - 1]!;
    for (const r of positions) {
      for (const c of positions) {
        if ((r === first && c === first) || (r === first && c === last) || (r === last && c === first)) continue;
        for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc);
      }
    }
  }
  for (let i = 0; i <= 8; i++) { set(8, i); set(i, 8); }
  for (let i = 0; i < 8; i++) { set(8, size - 1 - i); set(size - 1 - i, 8); }
  return res;
}

function rowsOf(matrix: { rows: string[] }): number[][] {
  return matrix.rows.map((line) => [...line].map(Number));
}

/** Обход ISO 7.7.3: пары столбцов справа налево, зигзагом, столбец 6 пропущен. */
function dataBits(mat: number[][], size: number, mask: number, version: number): number[] {
  const reserved = reservedRows(size, version);
  const masked = (r: number, c: number): boolean => {
    switch (mask) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    }
  };
  const bits: number[] = [];
  let upward = true;
  // Столбец 6 занят таймингом, и об него сдвигается РАЗБИЕНИЕ на пары, а не только
  // одна пара: (8,7) → (5,4) → (3,2) → (1,0). Если сдвигать «одну пару», поток
  // расходится на несколько столбцов, и проверка начинает показывать ошибки там,
  // где их нет (именно так этот тест сначала и упал).
  let col = size - 1;
  while (col > 0) {
    if (col === 6) col -= 1;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (let z = 0; z < 2; z++) {
        const c = col - z;
        if (reserved[row]![c]) continue;
        bits.push(masked(row, c) ? mat[row]![c]! ^ 1 : mat[row]![c]!);
      }
    }
    upward = !upward;
    col -= 2;
  }
  return bits;
}

function codewordsOf(mat: number[][], size: number, mask: number, version: number): number[] {
  const bits = dataBits(mat, size, mask, version);
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    out.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  return out;
}

/** GF(2^8) независимым способом: syndrome = C(α^i). Правильный код — нули. */
function syndromesZero(codewords: number[], count: number): boolean {
  const exp = new Uint8Array(512);
  const log = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    exp[i] = x;
    log[x] = i;
    x = (x << 1) ^ (x & 0x80 ? 0x11d : 0);
  }
  for (let i = 255; i < 512; i++) exp[i] = exp[i - 255]!;
  const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : exp[log[a]! + log[b]!]!);
  for (let i = 0; i < count; i++) {
    let acc = 0;
    for (const word of codewords) acc = mul(acc, exp[i]!) ^ word;
    if (acc !== 0) return false;
  }
  return true;
}

describe('QR-код адреса', () => {
  it('версия выбирается по длине адреса, а не «первая попавшаяся»', () => {
    expect(qrCapacity(1)).toBe(14);
    expect(qrCapacity(4)).toBe(62);
    expect(qrMatrix(TRON_ADDR).version).toBe(3);
    expect(qrMatrix(EVM_ADDR).version).toBe(3);
    expect(qrMatrix('A'.repeat(62)).version).toBe(4);
    expect(QR_MAX_BYTES).toBe(62);
  });

  it('длиннее 62 байт — явный отказ, а не обрезок адреса', () => {
    expect(() => qrMatrix('A'.repeat(63))).toThrow(/too_long/);
    expect(() => qrMatrix('')).toThrow(/empty/);
  });

  it('матрица совпадает с эталоном segno: служебные поля и поток данных', () => {
    // Паддинг намеренно не сверяем: segno дописывает целый нулевой кодовый символ,
    // когда поток уже выровнен по байту, а ISO (§7.4.10) требует в этом случае
    // сразу переходить к 0xEC/0x11. Разница — только в хвосте данных, сканеру она
    // не мешает: он читает режим, длину и ровно столько байт, сколько заявлено.
    let checked = 0;
    for (const testCase of FIXTURE.cases) {
      const mine = qrMatrix(testCase.text, { mask: testCase.mask });
      expect(mine.size, `size для ${testCase.text.slice(0, 8)} маска ${testCase.mask}`).toBe(testCase.size);
      expect(mine.version).toBe(testCase.version);
      expect(mine.mask).toBe(testCase.mask);
      const expected = testCase.rows.map((b64) => {
        const buf = Buffer.from(b64, 'base64');
        let bits = '';
        for (const byte of buf) bits += byte.toString(2).padStart(8, '0');
        return [...bits.slice(0, testCase.size)].map(Number);
      });
      const reserved = reservedRows(testCase.size, testCase.version);
      const mineRows = rowsOf(mine);
      // (1) все служебные модули — поисковые паттерны, тайминги, выравнивание,
      // информация о формате и обязательный тёмный модуль — бит в бит.
      for (let r = 0; r < testCase.size; r++) {
        for (let c = 0; c < testCase.size; c++) {
          if (reserved[r]![c]) {
            expect(mineRows[r]![c], `служебный модуль (${r},${c}) маска ${testCase.mask}`)
              .toBe(expected[r]![c]!);
          }
        }
      }
      // (2) данные до паддинга — то же самое, что у эталона.
      const payloadBytes = Math.ceil((12 + testCase.text.length * 8) / 8);
      const mineWords = codewordsOf(mineRows, mine.size, mine.mask, mine.version);
      const refWords = codewordsOf(expected, testCase.size, testCase.mask, testCase.version);
      expect(mineWords.slice(0, payloadBytes), `данные ${testCase.text.slice(0, 8)} маска ${testCase.mask}`)
        .toEqual(refWords.slice(0, payloadBytes));
      checked++;
    }
    expect(checked).toBe(FIXTURE.cases.length);
    expect(checked).toBeGreaterThanOrEqual(32);
  });

  it('контрольные символы верны: синдромы обращаются в ноль', () => {
    // Проверка независимым способом — не «наша же функция кодирования наоборот».
    // Блоки распускаем вручную: при двух блоках (версия 4) чередование идёт по
    // одному слову, и «в лоб» контрольная сумма не сошлась бы.
    const layout: Record<number, { data: number; ecc: number; blocks: number }> = {
      1: { data: 16, ecc: 10, blocks: 1 },
      2: { data: 28, ecc: 16, blocks: 1 },
      3: { data: 44, ecc: 26, blocks: 1 },
      4: { data: 64, ecc: 18, blocks: 2 },
    };
    for (const text of [TRON_ADDR, EVM_ADDR, 'HELLO', 'A'.repeat(62), 'a'.repeat(1)]) {
      const matrix = qrMatrix(text);
      const words = codewordsOf(rowsOf(matrix), matrix.size, matrix.mask, matrix.version);
      const plan = layout[matrix.version]!;
      const perBlock = plan.data / plan.blocks;
      for (let b = 0; b < plan.blocks; b++) {
        const data: number[] = [];
        for (let i = 0; i < perBlock; i++) data.push(words[b + i * plan.blocks]!);
        const ecc: number[] = [];
        const eccStart = plan.data;
        for (let i = 0; i < plan.ecc; i++) ecc.push(words[eccStart + b + i * plan.blocks]!);
        expect(syndromesZero([...data, ...ecc], plan.ecc), `${text} блок ${b}`).toBe(true);
      }
    }
  });

  it('адрес читается из матрицы обратно — то, что увидит сканер кошелька', () => {
    for (const text of [TRON_ADDR, EVM_ADDR]) {
      const matrix = qrMatrix(text);
      const bits = dataBits(rowsOf(matrix), matrix.size, matrix.mask, matrix.version);
      const stream = bits.join('');
      expect(stream.slice(0, 4)).toBe('0100'); // байтовый режим
      const declared = parseInt(stream.slice(4, 12), 2);
      expect(declared).toBe(text.length);
      let decoded = '';
      for (let i = 0; i < declared; i++) {
        decoded += String.fromCharCode(parseInt(stream.slice(12 + i * 8, 20 + i * 8), 2));
      }
      expect(decoded).toBe(text);
    }
  });

  it('выбор маски по штрафу не меняет данные: тот же поток, другие точки', () => {
    const auto = qrMatrix(TRON_ADDR);
    expect([0, 1, 2, 3, 4, 5, 6, 7]).toContain(auto.mask);
    const payloadBytes = Math.ceil((12 + TRON_ADDR.length * 8) / 8);
    const autoWords = codewordsOf(rowsOf(auto), auto.size, auto.mask, auto.version);
    for (const mask of [0, 3, 7]) {
      const pinned = qrMatrix(TRON_ADDR, { mask });
      const words = codewordsOf(rowsOf(pinned), pinned.size, pinned.mask, pinned.version);
      expect(words.slice(0, payloadBytes)).toEqual(autoWords.slice(0, payloadBytes));
    }
  });
});

describe('PNG-растр для витрины', () => {
  it('картинка = ровно то, что в матрице: распаковываем PNG независимо', async () => {
    const matrix = qrMatrix(EVM_ADDR);
    const png = await qrPng(EVM_ADDR, { mask: matrix.mask, scale: 4 });
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // Чанки разбираем вручную: длина, тип, данные и CRC — если CRC не сходится,
    // энкодер врёт, даже если картинка «на глаз» правильная.
    const chunks: { type: string; data: Uint8Array }[] = [];
    let off = 8;
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    while (off < png.length) {
      const len = view.getUint32(off);
      const type = String.fromCharCode(...png.subarray(off + 4, off + 8));
      const data = png.subarray(off + 8, off + 8 + len);
      const crc = view.getUint32(off + 8 + len);
      let c = 0xffffffff;
      const table = CRC_TABLE;
      for (const byte of png.subarray(off + 4, off + 8 + len)) c = table[(c ^ byte) & 0xff]! ^ (c >>> 8);
      expect((c ^ 0xffffffff) >>> 0, `CRC чанка ${type}`).toBe(crc);
      chunks.push({ type, data });
      off += 12 + len;
    }
    expect(chunks.map((chunk) => chunk.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    const ihdr = new DataView(chunks[0]!.data.buffer, chunks[0]!.data.byteOffset, chunks[0]!.data.byteLength);
    const side = (matrix.size + 8) * 4; // тихая зона 4 модуля с каждой стороны
    expect(ihdr.getUint32(0)).toBe(side);
    expect(ihdr.getUint32(4)).toBe(side);
    expect(ihdr.getUint8(8)).toBe(1); // 1 бит на пиксель
    expect(ihdr.getUint8(9)).toBe(0); // grayscale
    // IDAT — zlib; DecompressionStream даёт тот же декодер, что и у браузера.
    const inflate = new Response(chunks[1]!.data).body!
      .pipeThrough(new DecompressionStream('deflate'));
    const raw = new Uint8Array(await new Response(inflate).arrayBuffer());
    const rowBytes = Math.ceil(side / 8);
    expect(raw.length).toBe(side * (rowBytes + 1));
    for (let y = 0; y < side; y++) {
      expect(raw[y * (rowBytes + 1)], `фильтр строки ${y}`).toBe(0);
      const line = matrix.rows[Math.floor(y / 4) - 4] ?? '';
      for (let x = 0; x < side; x++) {
        const col = Math.floor(x / 4) - 4;
        const dark = col >= 0 && col < matrix.size && line[col] === '1';
        const bit = (raw[y * (rowBytes + 1) + 1 + (x >> 3)]! >> (7 - (x & 7))) & 1;
        expect(bit, `пиксель (${y},${x})`).toBe(dark ? 0 : 1);
      }
    }
  });

  it('масштаб ограничен: запрос не должен рисовать полотно в 10 тысяч пикселей', async () => {
    const size = qrMatrix('abc').size;
    const width = (scale: number) => (size + 8) * scale;
    const ihdrWidth = async (png: Uint8Array) => new DataView(png.buffer, png.byteOffset, png.byteLength).getUint32(16);
    expect(await ihdrWidth(await qrPng('abc', { mask: 0, scale: 100500 }))).toBe(width(16));
    expect(await ihdrWidth(await qrPng('abc', { mask: 0, scale: -3 }))).toBe(width(1));
    expect(await ihdrWidth(await qrPng('abc', { mask: 0, scale: Number.NaN }))).toBe(width(6));
  });

  it('PNG детерминирован при зафиксированной маске', async () => {
    const a = await qrPng(TRON_ADDR, { mask: 2, scale: 6 });
    const b = await qrPng(TRON_ADDR, { mask: 2, scale: 6 });
    expect([...a]).toEqual([...b]);
    // Другая маска — другой растр, иначе выбор маски ничего не менял бы.
    const c = await qrPng(TRON_ADDR, { mask: 5, scale: 6 });
    expect([...a]).not.toEqual([...c]);
  });
});

describe('маршрут /pay/qr', () => {
  const db = {
    prepare() {
      return {
        bind() { return this; },
        async first() { return { address: EVM_ADDR, derivation_index: 3, hex: '22'.repeat(20), created_at: 1 }; },
        async all() { return { results: [] }; },
        async run() { return { meta: { changes: 1 } }; },
      };
    },
  };
  const env = {
    DB: db,
    PAYMENTS_ENABLED: 'on',
    DEPOSITS_ENABLED: 'on',
    PURCHASES_ENABLED: 'on',
    PAY_CHAIN: 'bsc',
    PAY_NETWORK: 'mainnet',
    PAY_EVM_CONTRACT: '0x55d398326f99059ff775485246999027b3197955',
    SIGNER: { fetch: async () => new Response('{}', { status: 500 }) },
  } as never;
  const auth = { userId: 'u1', worldId: 'w1' };

  it('отдаёт PNG с заголовками, которые не дают картинке стать документом', async () => {
    const res = await payQr(env, auth as never, new Request('https://api.test/pay/qr'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // Разрешение по умолчанию: версия 3 + тихая зона → (29+8)*6.
    expect(new DataView(bytes.buffer).getUint32(16)).toBe((29 + 8) * 6);
  });

  it('параметр scale режется, а не уходит в неограниченный рендер', async () => {
    const res = await payQr(env, auth as never, new Request('https://api.test/pay/qr?scale=99999'));
    const bytes = new Uint8Array(await res.arrayBuffer());
    // Адрес в чексумме — 42 символа → версия 3 (29 модулей), потолок масштаба 16.
    expect(new DataView(bytes.buffer).getUint32(16)).toBe((29 + 8) * 16);
  });

  it('выключенный приём денег = тот же отказ, что и у выдачи адреса', async () => {
    const off = { ...env, DEPOSITS_ENABLED: 'off' } as never;
    await expect(payQr(off, auth as never, new Request('https://api.test/pay/qr')))
      .rejects.toMatchObject({ status: 503, code: 'deposits_disabled' });
  });

  it('адрес в базе относится к другой сети — QR не рисуется', async () => {
    const tronDb = {
      ...db,
      prepare: () => ({
        bind: () => ({ first: async () => ({ address: TRON_ADDR, derivation_index: 1, hex: '41', created_at: 1 }) }),
      }),
    };
    const mixed = { ...env, DB: tronDb } as never;
    await expect(payQr(mixed, auth as never, new Request('https://api.test/pay/qr')))
      .rejects.toMatchObject({ status: 409, code: 'address_chain_mismatch' });
  });
});
