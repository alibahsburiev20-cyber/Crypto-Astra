// Конфигурация EVM-сетей, через которые мы принимаем и отправляем USDT.
//
// Одна запись = одна сеть. Всё, что отличается между сетями, живёт здесь:
// `chainId`, адрес контракта USDT, публичный RPC, эксплорер и число
// подтверждений. Число подтверждений — не косметика: в EVM «последний блок»
// может исчезнуть вместе с реоргом, а для Polygon это особенно дорого (он
// делился на цепочки чаще, чем BSC), поэтому там порог в несколько раз выше.
//
// Почему BNB и Polygon, а не что-то ещё: secp256k1 и EIP-1559 у нас уже есть
// (TRON их использовал), формат адреса `0x…` общий, USDT в обеих сетях — обычный
// ERC-20 `transfer(address,uint256)`, а комиссия — доли цента. TRON стоил 3–5 $
// за перевод ровно потому, что там газ платят в TRX по тарифу сети.
//
// USDT в BNB Chain — Binance-Peg (BSC-USD, 18 знаков), в Polygon — USDT0
// (6 знаков). Для игрока разницы нет, для нас знак в шкале — да: см. `pay/units.ts`.

import type { PayNetwork } from '../flags';
import type { PayChain } from '../units';

/** Ключ сети в конфигурации. `bnb` — он же внутренняя цепь `bsc`. */
export type EvmNetworkKey = 'bnb' | 'polygon';

export interface EvmNetwork {
  /**
   * `eth_chainId` сети. Часть конфигурации, а не «число где-то ещё»: подпись
   * привязана к нему, и 137 в 56 не отправляется.
   */
  chainId: number;
  /** JSON-RPC эндпоинт. Ключ не нужен: мы читаем и отправляем подписанное. */
  rpc: string;
  /**
   * Контракт USDT. Пустая строка — сеть не настроена, деньги не принимаем:
   * в тестнетах общий USDT отсутствует, «угаданный» адрес означал бы приём
   * чужого токена за деньги.
   */
  usdt: string;
  explorer: string;
  /** Сколько подтверждений ждём, прежде чем считать деньги пришедшими. */
  confirmations: number;
}

/** Как сеть называется для человека — и в какую цепь она у нас превращается. */
export interface EvmChainMeta {
  key: EvmNetworkKey;
  chain: PayChain;
  label: string;
  labelTestnet: string;
  explorerName: string;
  explorerNameTestnet: string;
}

/** Внутренний ключ цепи BNB Chain. `PAY_CHAIN=bnb` — синоним, а не новая сеть. */
export const BNB_CHAIN: PayChain = 'bsc';

/** Порядок — он же порядок отображения в витрине. */
export const EVM_CHAINS: readonly EvmChainMeta[] = [
  {
    key: 'bnb',
    chain: 'bsc',
    label: 'BNB Smart Chain (BEP-20)',
    labelTestnet: 'BSC testnet (chainId 97)',
    explorerName: 'BscScan',
    explorerNameTestnet: 'BscScan (testnet)',
  },
  {
    key: 'polygon',
    chain: 'polygon',
    label: 'Polygon PoS (USDT0)',
    labelTestnet: 'Polygon Amoy (chainId 80002)',
    explorerName: 'PolygonScan',
    explorerNameTestnet: 'PolygonScan (Amoy)',
  },
];

export function evmMeta(key: EvmNetworkKey): EvmChainMeta {
  const meta = EVM_CHAINS.find((c) => c.key === key);
  if (!meta) throw new Error(`unknown_evm_network:${key}`);
  return meta;
}

export function evmMetaByChain(chain: PayChain): EvmChainMeta | null {
  return EVM_CHAINS.find((c) => c.chain === chain) ?? null;
}

/** BNB Smart Chain, mainnet. */
export const BNB_MAINNET: EvmNetwork = {
  chainId: 56,
  rpc: 'https://bsc-dataseed.bnbchain.org',
  // BSC-USD (Binance-Peg). Другой контракт = другие деньги, поэтому адрес фиксирован.
  usdt: '0x55d398326f99059fF775485246999027B3197955',
  explorer: 'https://bscscan.com',
  confirmations: 15,
};

/** BNB Smart Chain, testnet (chainId 97). Тестового USDT нет — контракт свой. */
export const BNB_TESTNET: EvmNetwork = {
  chainId: 97,
  rpc: 'https://bsc-testnet-rpc.publicnode.com',
  usdt: '',
  explorer: 'https://testnet.bscscan.com',
  confirmations: 3,
};

/**
 * Polygon PoS, mainnet. USDT здесь — USDT0 (LayerZero OFT), 6 знаков, тот же
 * адрес, что был у bridged-версии: контракт не менялся при переходе на USDT0,
 * менялся только стандарт.
 */
export const POLYGON_MAINNET: EvmNetwork = {
  chainId: 137,
  rpc: 'https://polygon-rpc.com',
  usdt: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  explorer: 'https://polygonscan.com',
  // Реорги в Polygon стоят дороже, чем в BSC: 15 блоков по 2 секунды — это 30
  // секунд, за которые цепочка ещё может перестроиться. 64 ≈ 2 минуты.
  confirmations: 64,
};

/** Polygon Amoy, testnet (chainId 80002). */
export const POLYGON_TESTNET: EvmNetwork = {
  chainId: 80002,
  rpc: 'https://rpc-amoy.polygon.technology',
  usdt: '',
  explorer: 'https://amoy.polygonscan.com',
  confirmations: 12,
};

/**
 * Базовая конфигурация сети. `testnet` — среда из `PAY_NETWORK`: всё, что не
 * `mainnet`, считается тестом (см. `pay/flags.ts`).
 */
export function evmNetwork(key: EvmNetworkKey, testnet: boolean): EvmNetwork {
  if (key === 'polygon') return testnet ? POLYGON_TESTNET : POLYGON_MAINNET;
  return testnet ? BNB_TESTNET : BNB_MAINNET;
}

/** `chainId` сети: 56/97 у BNB, 137/80002 у Polygon. */
export function evmChainId(key: EvmNetworkKey, testnet: boolean): number {
  return evmNetwork(key, testnet).chainId;
}

/**
 * Сеть по её числу. `null` — если числа нет в списке: шкала USDT зависит от
 * сети (18 в BNB, 6 в Polygon), и «не угадали» здесь означает «зачислили в
 * миллион раз меньше», а не «опечатались в отчёте».
 */
export function evmKeyByChainId(chainId: number): EvmNetworkKey | null {
  for (const item of EVM_CHAINS) {
    for (const testnet of [false, true]) {
      if (evmNetwork(item.key, testnet).chainId === chainId) return item.key;
    }
  }
  return null;
}

/**
 * Контракт USDT для сети.
 *
 * Порядок переопределения: сначала `PAY_EVM_CONTRACT_<СЕТЬ>` (когда сетей две,
 * общая переменная означала бы «контракт от Polygon в слоте BNB»), затем
 * легаси-`PAY_EVM_CONTRACT` (одна сеть — старая конфигурация продолжает
 * работать), затем значение по умолчанию для этой сети.
 */
export function evmUsdtContract(
  key: EvmNetworkKey | PayNetwork,
  testnet?: boolean | string,
  env: Record<string, string | undefined> = {},
): string {
  // Совместимость со старой сигнатурой `evmUsdtContract(network, configured)`.
  // `configured === undefined` (аргумента не было) — «значения по умолчанию»,
  // `''` — «контракт намеренно не задан». Различать их обязано: иначе вызов
  // `evmReady('mainnet')` читает тестнет-пустоту и говорит «сеть не готова».
  if (key === 'mainnet' || key === 'nile') {
    return evmUsdtContractLegacy(key as PayNetwork, typeof testnet === 'string' ? testnet : undefined);
  }
  const isTest = testnet === true || isTestnetName(testnet);
  const net = key as EvmNetworkKey;
  const perChain = String(env[legacySuffix(net) === 'POL' ? 'PAY_EVM_CONTRACT_POL' : 'PAY_EVM_CONTRACT_BNB'] ?? '').trim();
  if (perChain) return perChain;
  // Переменная без суффикса сети — историческая: она описывает ту единственную
  // EVM-сеть, что была до Polygon, то есть BNB. Отдавать её Polygon значило бы
  // «сканировать контракт BNB в Polygon» — переводы не нашлись бы никогда, и
  // молча. Для Polygon обязателен `PAY_EVM_CONTRACT_POL`.
  const legacy = isBnb(net) ? String(env.PAY_EVM_CONTRACT ?? '').trim() : null;
  // Только `undefined` означает «переменной нет». Пустая строка — это «контракт
  // намеренно не задан», и приём обязан выключиться, а не тихо подхватить
  // стандартный адрес сети.
  if (legacy !== null) return legacy || evmNetwork(net, isTest).usdt;
  return evmNetwork(net, isTest).usdt;
}

/** `true` для BNB: она — «легаси»-сеть, переменные без суффикса относятся к ней. */
function isBnb(key: EvmNetworkKey): boolean {
  return key === 'bnb';
}

/** Суффикс имени переменной окружения для сети. */
function legacySuffix(key: EvmNetworkKey): 'BNB' | 'POL' {
  return key === 'polygon' ? 'POL' : 'BNB';
}

/** RPC сети. Свой эндпоинт обязателен на проде: публичный узел режет `eth_getLogs`. */
export function evmRpcUrl(key: EvmNetworkKey, testnet: boolean, env: Record<string, string | undefined> = {}): string {
  const perChain = String(env[`PAY_EVM_RPC_${legacySuffix(key)}`] ?? '').trim();
  // См. `evmUsdtContract`: общий RPC без суффикса — это узел BNB. Смотреть
  // Polygon через BSC-ноду — значит «сеть отвечает, а наших событий нет».
  const legacy = isBnb(key) ? String(env.PAY_EVM_RPC ?? '').trim() : '';
  return perChain || legacy || evmNetwork(key, testnet).rpc;
}

/** Подтверждения сети; `PAY_EVM_CONFIRMATIONS` остаётся общей override-настройкой. */
export function evmConfirmations(key: EvmNetworkKey, testnet: boolean, env: Record<string, string | undefined> = {}): number {
  const text = String(env[`PAY_EVM_CONFIRMATIONS_${legacySuffix(key)}`] ?? (isBnb(key) ? env.PAY_EVM_CONFIRMATIONS : undefined) ?? '').trim();
  // Пустая переменная — это «не настроено», а не «ноль»: иначе опечатка в env
  // выключила бы ожидания подтверждений на живой сети.
  const raw = text ? Number(text) : NaN;
  if (!Number.isFinite(raw)) return evmNetwork(key, testnet).confirmations;
  // Ниже 1 — это не «ноль подтверждений», а ошибка конфигурации: деньги без
  // ожидания ревернутся вместе с блоком, и мы их зачислим навсегда.
  return Math.max(1, Math.floor(raw));
}

/** Готов ли приём в этой сети: без контракта принимать нечего. */
export function evmReady(key: EvmNetworkKey | PayNetwork, testnet?: boolean | string, env: Record<string, string | undefined> = {}): boolean {
  // Старый вызов `evmReady('mainnet' | 'nile', configured)` идёт через
  // legacy-обёртку: иначе «mainnet» утонул бы в тестнет-значениях.
  if (key === 'mainnet' || key === 'nile') return evmReadyLegacy(key as PayNetwork, typeof testnet === 'string' ? testnet : undefined);
  return /^0x[0-9a-fA-F]{40}$/.test(evmUsdtContract(key, testnet, env));
}

/**
 * Исторические имена и сигнатуры (одна сеть, `PAY_NETWORK` вместо ключа сети).
 *
 * Оставлены не для красоты: на них висят тесты и внешний код, а «переименовали
 * сеть» не должно ломать то, что уже работает. Новая запись — `BNB_MAINNET`.
 */
export const BSC_MAINNET = BNB_MAINNET;
export const BSC_TESTNET = BNB_TESTNET;

/** `'mainnet' | 'nile'` (TRON-имена) → тест это или нет; всё, кроме mainnet, — тест. */
function isTestnetName(value: unknown): boolean {
  if (value === undefined || typeof value === 'boolean') return value === true;
  return String(value).trim().toLowerCase() !== 'mainnet';
}

/** Старый вызов `evmUsdtContract(PAY_NETWORK, configured)` — одна сеть на воркер. */
export function evmUsdtContractLegacy(networkOrTestnet: PayNetwork | boolean, configured?: string): string {
  const testnet = typeof networkOrTestnet === 'boolean' ? networkOrTestnet : isTestnetName(networkOrTestnet);
  const env: Record<string, string | undefined> = {};
  if (configured !== undefined) env.PAY_EVM_CONTRACT = String(configured);
  return evmUsdtContract('bnb', testnet, env);
}

/** Старый вызов `evmReady(PAY_NETWORK, configured)`. */
export function evmReadyLegacy(networkOrTestnet: PayNetwork | boolean, configured?: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(evmUsdtContractLegacy(networkOrTestnet, configured));
}

/**
 * Какие EVM-сети включены. По умолчанию — только BNB: Polygon обязан включаться
 * явно (`PAY_EVM_CHAINS=bnb,polygon`), иначе «дописали конфигурацию» случайно
 * станет «показали игроку вторую сеть».
 */
/** Разбор `PAY_EVM_CHAINS`: известные сети и список опечаток. */
function parseEvmChainList(env: Record<string, string | undefined>): { keys: EvmNetworkKey[]; unknown: string[] } {
  const raw = String(env.PAY_EVM_CHAINS ?? '').trim().toLowerCase();
  // Переменной нет — одна сеть по умолчанию (BNB). Polygon обязана быть названа
  // явно: «дописали env» не имеет права само по себе показать игроку вторую сеть.
  if (!raw) return { keys: ['bnb'], unknown: [] };
  const known = new Map<string, EvmNetworkKey>([['bnb', 'bnb'], ['bsc', 'bnb'], ['polygon', 'polygon'], ['pol', 'polygon'], ['matic', 'polygon']]);
  const keys: EvmNetworkKey[] = [];
  const unknown: string[] = [];
  for (const part of raw.split(',').map((x) => x.trim()).filter(Boolean)) {
    const key = known.get(part);
    if (key === undefined) unknown.push(part);
    else if (!keys.includes(key)) keys.push(key);
  }
  return { keys, unknown };
}

export function evmActiveKeys(env: Record<string, string | undefined> = {}): EvmNetworkKey[] {
  return parseEvmChainList(env).keys;
}

/**
 * Опечатка в `PAY_EVM_CHAINS` словами. `''` — список настроен верно.
 *
 * Возвращаем причину, а не «тихо выкинули неизвестное имя»: `bnb,polygn` иначе
 * означало бы «сканируем BNB, а polygon-адреса игрока никто не смотрит», и
 * выглядело бы это как «игрок не отправил», а не как наша ошибка.
 */
export function evmActiveKeysError(env: Record<string, string | undefined> = {}): string {
  const { unknown } = parseEvmChainList(env);
  return unknown.length ? `unknown_network:${unknown.join('|')}` : '';
}
