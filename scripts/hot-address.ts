// Адрес горячего кошелька из приватного ключа — без вывода самого ключа.
//
// Нужен, чтобы не перепутать `PAY_HOT_ADDRESS` при настройке Signer: адрес,
// вписанный руками с чужого экрана, — типичная причина «выплаты уходят не туда».
//
// Печатает ОБЕ формы одного ключа. Это не «на выбор»: из одного и того же ключа
// получаются адрес `T…` в TRON и адрес `0x…` в BNB Chain, и они не похожи друг на
// друга. При переключении сети в `PAY_HOT_ADDRESS` обязан оказаться `0x`-адрес —
// старый `T…` остаётся валидным адресом в EVM, просто это не наш кошелёк: USDT,
// отправленный на него в BSC, мы не увидим.
//
// Запуск (ключ не попадает в историю команд, если читать из окружения или stdin):
//   SIGNER_PRIVATE_KEY=<hex> npx tsx scripts/hot-address.ts
//   npx tsx scripts/hot-address.ts --stdin < key.txt
//   npx tsx scripts/hot-address.ts --check T...          # сверить с уже заданным
//   npx tsx scripts/hot-address.ts --check 0xAbC...       # и так же для BSC
//   npx tsx scripts/hot-address.ts --check <addr> --chain bsc   # сеть тоже сверяется
//
// Печатает только адреса и вердикт. Ключ не логируется и не сохраняется.

import { readFileSync } from 'node:fs';
import { addressFromPrivateKey } from '../worker/src/pay/crypto/secp256k1';
import { isValidAddress } from '../worker/src/pay/tron/address';
import { evmAddressFromPrivateKey, isEvmAddress, toChecksumAddress } from '../worker/src/pay/evm/address';

const args = process.argv.slice(2);

function readKey(): { key: string; source: string } {
  if (args.includes('--stdin')) {
    const raw = readFileSync(0, 'utf8').trim();
    if (!raw) throw new Error('stdin пуст');
    return { key: raw, source: 'stdin' };
  }
  const index = args.indexOf('--key');
  if (index >= 0 && args[index + 1]) {
    process.stderr.write('Внимание: ключ в аргументах команды остаётся в истории shell. Лучше через окружение или stdin.\n');
    return { key: args[index + 1], source: 'argv' };
  }
  const env = process.env.SIGNER_PRIVATE_KEY ?? '';
  if (!env) throw new Error('нет ключа: задайте SIGNER_PRIVATE_KEY или используйте --stdin');
  return { key: env, source: 'env' };
}

/** Что за сеть у вписанного адреса — по формату, потому что другого признака нет. */
export function chainOfAddress(address: string): 'tron' | 'bsc' | 'unknown' {
  const raw = String(address ?? '').trim();
  if (isEvmAddress(raw)) return 'bsc';
  if (isValidAddress(raw)) return 'tron';
  return 'unknown';
}

export function hotAddresses(keyHex: string): { tron: string; bsc: { lower: string; checksum: string } } {
  const trimmed = keyHex.trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) throw new Error('ключ должен быть 64 hex-символа');
  const clean = trimmed.toLowerCase();
  const tron = addressFromPrivateKey(clean);
  if (!isValidAddress(tron)) throw new Error('получился некорректный адрес — ключ вне кривой?');
  const bsc = evmAddressFromPrivateKey(clean);
  return { tron, bsc: { lower: bsc.toLowerCase(), checksum: toChecksumAddress(bsc) } };
}

function main(): void {
  const { key, source } = readKey();
  const addresses = hotAddresses(key);

  const checkIndex = args.indexOf('--check');
  const expected = checkIndex >= 0 ? (args[checkIndex + 1] ?? '').trim() : '';
  const known = new Set<string>([addresses.tron, addresses.bsc.lower, addresses.bsc.checksum]);
  const matches = expected ? known.has(expected) : null;
  const chain = expected ? chainOfAddress(expected) : null;

  // `--chain` — защита от самого дорогого опечаточного сценария: сети поменялись,
  // а в `PAY_HOT_ADDRESS` остался адрес прошлой цепи. Формально он «наш» (из того
  // же ключа), но в этой сети на нём ноль, и выплаты встали бы молча.
  const wantIndex = args.indexOf('--chain');
  const want = wantIndex >= 0 ? (args[wantIndex + 1] ?? '').trim() : '';
  const wrongChain = want && expected ? chain !== want : false;
  if (want && want !== 'tron' && want !== 'bsc') {
    console.error('--chain принимает только tron или bsc');
    process.exit(2);
  }

  console.log(JSON.stringify({
    keySource: source,
    tron: addresses.tron,
    bsc: addresses.bsc.checksum,
    // Как вписывать в `PAY_HOT_ADDRESS` при `PAY_CHAIN = "bsc"`: Worker сравнивает
    // адрес подписанта с этим значением, и обе формы (с чексуммой и в нижнем
    // регистре) проходят.
    bscLowercase: addresses.bsc.lower,
    expected: expected || null,
    expectedChain: chain,
    wantedChain: want || null,
    matches,
    ok: matches !== false && !wrongChain,
  }, null, 2));
  if (matches === false) {
    console.error('Адрес не совпадает с этим ключом. Исправьте `PAY_HOT_ADDRESS`, не «попробуйте ещё раз».');
    process.exit(1);
  }
  if (wrongChain) {
    console.error(`В \`PAY_HOT_ADDRESS\` адрес сети ${chain}, а работаете вы для ${want}. `
      + 'Возьмите форму из этого же вывода (`tron` или `bsc`) — иначе платить будет нечем.');
    process.exit(1);
  }
}

// Экспортируемо для теста: при импорте (`vitest`) ничего не должно запускаться и
// тем более `process.exit` — иначе падает раннер, а не код.
if (process.argv[1]?.endsWith('hot-address.ts')) main();
