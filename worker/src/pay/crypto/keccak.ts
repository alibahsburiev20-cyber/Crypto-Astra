// Keccak-256 (тот самый, что в Ethereum и TRON, не SHA3-256 из стандарта).
//
// Нужен ровно для одного: адрес TRON — это последние 20 байт
// keccak256(открытый ключ без первого байта). WebCrypto keccak не умеет,
// поэтому считаем сами.
//
// Реализация «в лоб» на BigInt: медленнее оптимизированной на 32-битных словах,
// зато читается как спецификация. Вызовов мало (создание адреса и подпись),
// поэтому скорость здесь не важна, а правильность — важна.

const MASK = (1n << 64n) - 1n;

const RC: bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

/** Смещения rho, индекс = x + 5y. */
const ROT: number[] = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
];

const RATE = 136; // байт для keccak-256

function rotl(value: bigint, shift: number): bigint {
  if (shift === 0) return value;
  const s = BigInt(shift);
  return ((value << s) | (value >> (64n - s))) & MASK;
}

function keccakF(state: bigint[]): void {
  const c = new Array<bigint>(5);
  const b = new Array<bigint>(25);

  for (let round = 0; round < 24; round += 1) {
    // theta
    for (let x = 0; x < 5; x += 1) {
      c[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    }
    for (let x = 0; x < 5; x += 1) {
      const d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) state[x + y] ^= d;
    }

    // rho + pi
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        const index = x + 5 * y;
        const target = y + 5 * ((2 * x + 3 * y) % 5);
        b[target] = rotl(state[index], ROT[index]);
      }
    }

    // chi
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        const i = x + 5 * y;
        state[i] = b[i] ^ ((~b[((x + 1) % 5) + 5 * y] & MASK) & b[((x + 2) % 5) + 5 * y]);
      }
    }

    // iota
    state[0] ^= RC[round];
  }
}

export function keccak256(input: Uint8Array): Uint8Array {
  const state = new Array<bigint>(25).fill(0n);

  const absorb = (block: Uint8Array, offset: number) => {
    for (let i = 0; i < RATE / 8; i += 1) {
      let lane = 0n;
      for (let byte = 7; byte >= 0; byte -= 1) lane = (lane << 8n) | BigInt(block[offset + i * 8 + byte]);
      state[i] ^= lane;
    }
    keccakF(state);
  };

  const blocks = Math.floor(input.length / RATE);
  for (let i = 0; i < blocks; i += 1) absorb(input, i * RATE);

  // Последний блок с паддингом keccak: 0x01 … 0x80.
  const rest = input.slice(blocks * RATE);
  const last = new Uint8Array(RATE);
  last.set(rest);
  last[rest.length] ^= 0x01;
  last[RATE - 1] ^= 0x80;
  absorb(last, 0);

  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i += 1) {
    let lane = state[i];
    for (let byte = 0; byte < 8; byte += 1) {
      out[i * 8 + byte] = Number(lane & 0xffn);
      lane >>= 8n;
    }
  }
  return out;
}

export function keccak256Hex(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let out = '';
  for (const b of keccak256(bytes)) out += b.toString(16).padStart(2, '0');
  return out;
}
