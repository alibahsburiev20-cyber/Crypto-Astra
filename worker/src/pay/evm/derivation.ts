// Ключ игрока для EVM-сети: путь `m/44'/60'/0'/0/{index}`.
//
// Важно: индекс — тот же, что у TRON-адреса игрока. Так у одного игрока один
// номер, два адреса (`T…` и `0x…`), и в базе не появляется третья сущность.
// Путь другой (60 вместо 195), поэтому ключи разные — один адрес не выводится
// из другого.
//
// Функция живёт в Signer-контуре: основной Worker знает только адрес.

import { deriveChild, masterFromSeed } from '../crypto/hd';
import { hexToBytes } from '../crypto/hmac';
import { evmAddressFromPrivateKey } from './address';

/** BIP-44 coin type Ethereum; он же используется в BNB Chain. */
export const COIN_ETH = 60;
const BASE_PATH = [44, COIN_ETH, 0, 0] as const;

export interface DerivedEvmKey {
  index: number;
  privateKey: string;
  address: string;
  path: string;
}

export async function deriveEvmKey(seedHex: string, index: number): Promise<DerivedEvmKey> {
  if (!Number.isInteger(index) || index < 0 || index >= 0x80000000) throw new Error('bad_index');
  const seed = hexToBytes(String(seedHex ?? '').trim());
  let node = await masterFromSeed(seed);
  for (const step of BASE_PATH) node = await deriveChild(node, step, true);
  node = await deriveChild(node, index, false);
  const privateKey = node.key.toString(16).padStart(64, '0');
  return {
    index,
    privateKey,
    address: evmAddressFromPrivateKey(privateKey),
    path: `m/44'/60'/0'/0/${index}`,
  };
}
