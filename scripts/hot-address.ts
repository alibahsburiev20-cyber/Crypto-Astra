// Адрес горячего кошелька из приватного ключа — без вывода самого ключа.
//
// Нужен, чтобы не перепутать `PAY_HOT_ADDRESS` при настройке Signer: адрес,
// вписанный руками с чужого экрана, — типичная причина «выплаты уходят не туда».
//
// Запуск (ключ не попадает в историю команд, если читать из окружения или stdin):
//   SIGNER_PRIVATE_KEY=<hex> npx tsx scripts/hot-address.ts
//   npx tsx scripts/hot-address.ts --stdin < key.txt
//   npx tsx scripts/hot-address.ts --check T...   # сверить с уже заданным адресом
//
// Печатает только адрес и вердикт. Ключ не логируется и не сохраняется.

import { readFileSync } from 'node:fs';
import { addressFromPrivateKey } from '../worker/src/pay/crypto/secp256k1';
import { isValidAddress } from '../worker/src/pay/tron/address';

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

function main(): void {
  const { key, source } = readKey();
  const trimmed = key.trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) throw new Error('ключ должен быть 64 hex-символа');
  const address = addressFromPrivateKey(trimmed.toLowerCase());
  if (!isValidAddress(address)) throw new Error('получился некорректный адрес — ключ вне кривой?');

  const checkIndex = args.indexOf('--check');
  const expected = checkIndex >= 0 ? (args[checkIndex + 1] ?? '') : '';
  const matches = expected ? expected.trim() === address : null;

  console.log(JSON.stringify({ address, keySource: source, expected: expected || null, matches, ok: matches !== false }, null, 2));
  if (matches === false) process.exit(1);
}

main();

export {};
