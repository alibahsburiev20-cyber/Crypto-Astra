// Сквозная проверка BSC-рельса: адрес → депозит → зачисление → покупка → заявка
// на выплату → подпись → сеть → подтверждение.
//
// Зачем этот скрипт. Юнит-тесты (`payEvm*.test.ts`) проверяют каждый кусок на
// подставной ноде — быстро, детерминированно, но не касаясь реальной сети.
// Здесь тот же код идёт целиком и в том же порядке, что в проде: функции зовёт
// прогон, а состояние базы и сети сверяется после каждого шага. Так видны
// классы расхождений, которые по частям не видны: адрес не той формы, шкала
// знаков, курсор, который не двигается, «зачислили два раза», подпись чужого
// получателя, квитанция, по которой сверка не проходит.
//
// Два режима:
//
//   --loopback   весь путь на локальной подставной ноде, сети нет. Прогоняется
//                хоть в CI: проверяет склейку шагов (скан → зачисление →
//                транзакция → сверка), а не поведение сети.
//   по умолчанию — сеть: реальная нода BSC-тестнета. Нужно, чтобы шаг был
//                проверен по-настоящему:
//                - доступ к PAY_EVM_RPC из той машины, где запущен скрипт;
//                - тестовый USDT-контракт, задеплоленный под `PAY_EVM_CONTRACT`
//              //                - тестовые USDT на адресе игрока (иначе нечего зачислять);
//                - тестовый BNB на «горячем» кошельке, если просите настоящую
//                  отправку (`--send`).
//                Боевые флаги (`PAYOUTS_ENABLED`/`SWEEP_ENABLED`) скрипт не
//                включает: в сеть уходит только то, что явно разрешено флагом
//                `--send`, и только в тестнет.
//
// Запуск:
//   npm run pay:rehearse -- --loopback
//   PAY_CHAIN=bsc PAY_NETWORK=testnet PAY_EVM_CONTRACT=0x… PAY_HOT_ADDRESS=0x… \
//     npx tsx scripts/pay-bsc-rehearsal.ts --blocks 3000 --wait 600
//   # настоящая отправка (нужен тестовый BNB на кошельке):
//   … --send --hot-key <hex>
//
// Код выхода: 0 — всё проверено и сошлось, 2 — сошлось, но часть шагов не
// тронута (непроверенное названо вслух), 1 — есть расхождение.

import { makeD1 } from '../worker/test/helpers/d1';
import { ensurePaySchema, resetPaySchemaForTests } from '../worker/src/pay/schema';
import { payBalanceMicro, verifyPayLedger } from '../worker/src/pay/ledger';
import { chainSpec } from '../worker/src/pay/chain';
import type { PayNetwork } from '../worker/src/pay/flags';
import { createEvmRpc, TRANSFER_TOPIC0, addressToTopic, type EvmLog, type LogFilter } from '../worker/src/pay/evm/rpc';
import { applyEvmDeposits, readCursor, scanEvmBlocks } from '../worker/src/pay/evm/deposits';
import { applySignature, decodeSignedTx, signingHash } from '../worker/src/pay/evm/tx';
import { buildPayoutTx, PAYOUT_GAS_LIMIT, payoutGas, sendUsdtEvm, type EvmSignerClient } from '../worker/src/pay/evm/broadcast';
import { applyEvmPayoutConfirmations, nonceKey, releaseNonce, reserveNonce, verifyPayout } from '../worker/src/pay/evm/payouts';
import { approveWithdrawal, markBroadcast, minWithdrawMicro, requestWithdrawal, reserveWithdrawal } from '../worker/src/pay/payouts';
import { evmSweepPlan } from '../worker/src/pay/evm/sweep';
import { deriveEvmKey } from '../worker/src/pay/evm/derivation';
import { evmAddressFromPrivateKey, toChecksumAddress } from '../worker/src/pay/evm/address';
import { keccak256, keccak256Hex } from '../worker/src/pay/crypto/keccak';
import { bytesToHex, hexToBytes } from '../worker/src/pay/crypto/hmac';
import { signDigest } from '../worker/src/pay/crypto/secp256k1';
import { PAY_TABLES } from '../worker/src/pay/schema';
import { entitlements, purchase } from '../worker/src/pay/shop';
import {
  checkChainEnv,
  depositVerdict,
  formatUsdt,
  idempotencyVerdict,
  ledgerVerdict,
  microToRaw,
  payoutTxCheck,
  receiptVerdict,
  signerGuardsCheck,
  summarize,
} from './lib/rehearse';

/**
 * Всё, что нужно прогону от сети. Реальный `createEvmRpc(...)` и подставной
 * узел `--loopback` реализуют один и тот же интерфейс, поэтому боевые функции
 * (`sendUsdtEvm`, `verifyPayout`, `evmSweepPlan`) в обоих режимах получают
 * одинаковый вход — расхождение «у вас же нода подставная» снимается импортом,
 * а не словами.
 */
interface NodeLike {
  blockNumber(): Promise<number>;
  logs(filter: LogFilter): Promise<EvmLog[]>;
  chainId(): Promise<number>;
  gasPrice(): Promise<bigint>;
  feeHistory(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } | null>;
  transactionCount(address: string, blockTag?: string): Promise<number>;
  balance(address: string): Promise<bigint>;
  call(to: string, data: string): Promise<string>;
  sendRawTransaction(raw: string): Promise<string>;
  transactionReceipt(hash: string): Promise<{
    transactionHash: string; blockNumber: number | null; status: boolean; gasUsed: number; logs: EvmLog[];
  } | null>;
}

interface Receipt {
  transactionHash: string;
  blockNumber: number | null;
  status: boolean;
  gasUsed: number;
  logs: EvmLog[];
}

interface Args {
  loopback: boolean;
  send: boolean;
  blocks: number;
  waitSec: number;
  intervalSec: number;
  amountMicro: number;
  buy: string;
  payoutRatio: number;
  contract: string | null;
  hotKey: string | null;
  seed: string;
  playerIndex: number;
  /** Какую EVM-сеть прогоняем: `bsc` | `polygon`. Флаг перебивает `PAY_CHAIN`. */
  chain: string;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | null => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
  };
  const loopback = argv.includes('--loopback');
  return {
    loopback,
    send: argv.includes('--send'),
    blocks: Number(get('blocks') ?? '2000'),
    waitSec: Number(get('wait') ?? '0'),
    intervalSec: Number(get('interval') ?? '15'),
    amountMicro: Number(get('amount-micro') ?? '5000000'),
    buy: get('buy') ?? 'skin_ember',
    payoutRatio: Number(get('payout-ratio') ?? '1'),
    contract: get('contract'),
    hotKey: get('hot-key'),
    seed: get('seed') ?? '11'.repeat(32),
    playerIndex: Number(get('player-index') ?? '1'),
    // Флаг, а не только переменная окружения: прогон обеих сетей обязан
    // запускаться с одной и той же командой, иначе вторая сеть «проверяется»
    // только тем, кто помнит экзотический синтаксис env-префикса.
    chain: String(get('chain') ?? process.env.PAY_CHAIN ?? 'bsc').trim().toLowerCase(),
  };
}

/** Окружение воркера: то, что дала оболочка, плюс разумный тестнет по умолчанию. */
function buildEnv(args: Args): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v;
  env.PAY_CHAIN = args.chain || 'bsc';
  env.PAY_NETWORK = env.PAY_NETWORK || 'testnet';
  // Список сканируемых сетей подгоняем под проверяемую: без этого `PAY_CHAIN=polygon`
  // означало бы «адреса выдаём в Polygon, а `evmChainSpecs` по умолчанию смотрит
  // BNB» — и прогон проверял бы не ту сеть, которую назван проверять.
  if (!env.PAY_EVM_CHAINS) env.PAY_EVM_CHAINS = env.PAY_CHAIN === 'polygon' || env.PAY_CHAIN === 'pol' || env.PAY_CHAIN === 'matic' ? 'polygon' : 'bnb';
  // Имя переменной — по сети. Прогон Polygon обязан настраиваться `PAY_EVM_*_POL`
  // (как и воркер): писать polygon-контракт в общий `PAY_EVM_CONTRACT` — это
  // «токен BNB в слоте Polygon», и прогон проверял бы не ту конфигурацию.
  const suffix = env.PAY_CHAIN === 'polygon' || env.PAY_CHAIN === 'pol' || env.PAY_CHAIN === 'matic' ? 'POL' : 'BNB';
  const contractKey = `PAY_EVM_CONTRACT${suffix === 'POL' ? '_POL' : ''}`;
  const rpcKey = `PAY_EVM_RPC${suffix === 'POL' ? '_POL' : ''}`;
  const confKey = `PAY_EVM_CONFIRMATIONS${suffix === 'POL' ? '_POL' : ''}`;
  if (args.contract) env[contractKey] = args.contract;
  // В loopback контракт — игрушечный токен прогона: иначе проверка конфигурации
  // выключает приём, и зациклить её на подставной ноде нельзя.
  if (args.loopback && !env[contractKey]) env[contractKey] = '0x' + 'c0'.repeat(20);
  // Подтверждения: те же дефолты, что в `pay/evm/config.ts` — иначе «нет
  // значения» выглядит как ошибка конфигурации, а не как «оператор не спорил».
  if (!env[confKey] && !env.PAY_EVM_CONFIRMATIONS) {
    env[confKey] = env.PAY_NETWORK === 'mainnet' ? (suffix === 'POL' ? '64' : '15') : (suffix === 'POL' ? '12' : '3');
  }
  if (args.hotKey) env.SIGNER_PRIVATE_KEY = args.hotKey;
  if (!env[rpcKey] && !env.PAY_EVM_RPC) {
    env[rpcKey] = env.PAY_NETWORK === 'mainnet'
      ? (suffix === 'POL' ? 'https://polygon-rpc.com' : 'https://bsc-dataseed.bnbchain.org')
      : (suffix === 'POL' ? 'https://rpc-amoy.polygon.technology' : 'https://bsc-testnet-rpc.publicnode.com');
  }
  return env;
}

const T0 = 1_764_000_000_000;
/** Второй адрес в прогоне: он «чужой» для зачисления и «свой» для плана сбора. */
const OTHER = '0x' + '77'.repeat(20);

const results: { step: string; status: 'ok' | 'skip' | 'fail'; reason: string }[] = [];

function report(step: string, status: 'ok' | 'skip' | 'fail', reason: string): void {
  results.push({ step, status, reason });
  const mark = status === 'ok' ? 'OK     ' : status === 'skip' ? 'ПРОПУСК' : 'ПРОВАЛ ';
  console.log(`${String(results.length).padStart(2, '0')} [${mark}] ${step}: ${reason}`);
}

function reportChecks(prefix: string, checks: { step: string; status: string; reason: string }[]): void {
  for (const c of checks) report(`${prefix} · ${c.step}`, c.status as 'ok' | 'skip' | 'fail', c.reason);
}

/** Локальная подставная нода: помнит переводы и отдаёт квитанции. */
class LoopbackNode implements NodeLike {
  head = 100;
  chainIdValue = 97;
  /** Знаки токена: подставка обязана врать про них так же, как проверяющая сеть. */
  decimalsValue = 18;
  private logRows: Record<string, unknown>[] = [];
  private txCount = new Map<string, number>();
  private receipts = new Map<string, Receipt>();
  usdt = new Map<string, bigint>();
  bnb = new Map<string, bigint>();

  constructor(readonly contract: string, readonly hot: string) {}

  /** «Игрок перевёл нам USDT»: событие в новом блоке. */
  fund(to: string, amountRaw: bigint): string {
    this.head += 1;
    const from = this.hot.toLowerCase();
    this.usdt.set(to.toLowerCase(), (this.usdt.get(to.toLowerCase()) ?? 0n) + amountRaw);
    this.usdt.set(from, (this.usdt.get(from) ?? 0n) >= amountRaw ? (this.usdt.get(from) ?? 0n) - amountRaw : 0n);
    const hash = `0x${keccak256Hex(`fund:${to}:${amountRaw}:${this.head}`).slice(0, 64)}`;
    this.logRows.push({
      address: this.contract,
      topics: [TRANSFER_TOPIC0, addressToTopic(from), addressToTopic(to)],
      data: `0x${amountRaw.toString(16).padStart(64, '0')}`,
      blockNumber: this.head,
      transactionHash: hash.slice(0, 66),
      logIndex: 0,
      removed: false,
    });
    return hash.slice(0, 66);
  }

  /** Балансы «на руках» у кошельков — их читает план сбора. */
  setBalances(balances: Record<string, { usdt: bigint; bnb: bigint }>): void {
    for (const [address, value] of Object.entries(balances)) {
      this.usdt.set(address.toLowerCase(), value.usdt);
      this.bnb.set(address.toLowerCase(), value.bnb);
    }
  }

  mine(blocks: number): void { this.head += blocks; }

  async blockNumber(): Promise<number> { return this.head; }
  async chainId(): Promise<number> { return this.chainIdValue; }
  async gasPrice(): Promise<bigint> { return 1_000_000_000n; }
  async feeHistory() { return { maxFeePerGas: 1_500_000_000n, maxPriorityFeePerGas: 1_000_000_000n }; }
  async transactionCount(address: string): Promise<number> { return this.txCount.get(address.toLowerCase()) ?? 0; }
  async balance(address: string): Promise<bigint> { return this.bnb.get(address.toLowerCase()) ?? 0n; }
  async call(to: string, data: string): Promise<string> {
    if (String(to).toLowerCase() !== this.contract.toLowerCase()) return '0x';
    // `decimals()` — есть ли токен в сети; `balanceOf(address)` — сколько на адресе.
    if (data.toLowerCase().startsWith('0x95d89b41')) return `0x${(this.decimalsValue).toString(16).padStart(64, '0')}`;
    if (data.toLowerCase().startsWith('0x70a08231')) {
      const address = `0x${data.slice(10 + 24, 10 + 64)}`.toLowerCase();
      return `0x${(this.usdt.get(address) ?? 0n).toString(16).padStart(64, '0')}`;
    }
    return '0x';
  }
  async logs(filter: LogFilter): Promise<EvmLog[]> {
    const wanted = ((filter.topics?.[2] as string[] | null) ?? []).map((t) => String(t).toLowerCase());
    return this.logRows
      .filter((row) => Number(row.blockNumber) >= filter.fromBlock && Number(row.blockNumber) <= filter.toBlock)
      .filter((row) => (wanted.length ? wanted.includes(String((row as { topics: string[] }).topics[2]).toLowerCase()) : true)) as unknown as EvmLog[];
  }
  async sendRawTransaction(raw: string): Promise<string> {
    const tx = decodeSignedTx(raw);
    // Как настоящая нода: `eth_sendRawTransaction` отвечает хешем БЕЗ `0x`, и
    // `sendUsdtEvm` сверяет именно такую строку со своим расчётом.
    const hash = bytesToHex(keccak256(hexToBytes(raw.slice(2))));
    const from = this.hot.toLowerCase();
    this.txCount.set(from, this.transactionCountFrom(hash) + 1);
    const recipient = `0x${String(tx.data).replace(/^0x/i, '').slice(8, 72).slice(24)}`.toLowerCase();
    const amount = BigInt(`0x${String(tx.data).replace(/^0x/i, '').slice(72, 136)}`);
    this.head += 1;
    this.usdt.set(from, (this.usdt.get(from) ?? 0n) >= amount ? (this.usdt.get(from) ?? 0n) - amount : 0n);
    this.usdt.set(recipient, (this.usdt.get(recipient) ?? 0n) + amount);
    this.receipts.set(hash, {
      transactionHash: `0x${hash}`,
      blockNumber: this.head,
      status: true,
      gasUsed: 46_000,
      logs: [{
        address: this.contract,
        topics: [TRANSFER_TOPIC0, addressToTopic(from), addressToTopic(recipient)],
        data: `0x${amount.toString(16).padStart(64, '0')}`,
        blockNumber: this.head,
        transactionHash: hash,
        logIndex: 0,
        removed: false,
      }],
    });
    this.logRows.push(this.receipts.get(hash)!.logs[0] as unknown as Record<string, unknown>);
    return hash;
  }
  async transactionReceipt(hash: string): Promise<Receipt | null> {
    return this.receipts.get(String(hash).toLowerCase()) ?? null;
  }
  private transactionCountFrom(hash: string): number {
    void hash;
    return this.txCount.get(this.hot.toLowerCase()) ?? 0;
  }
}

/**
 * Подпись локальным ключом — те же отсечки, что выставляет Signer.
 *
 * В бою ключ живёт только в Signer-контуре, поэтому прогон обязан показать, что
 * локальный путь проходит ровно те же границы: чужой контракт, чужая сеть,
 * сумма больше потолка, `value` не ноль. Это не «замена Signer'у», а проверка
 * того, что тело транзакции собирается так, как его примет Signer.
 */
function localSigner(privKey: string, opts: { contract: string; chainIds: number[]; maxTxMicro: number }): EvmSignerClient {
  return {
    async signEvm(request: { tx: Record<string, string | number>; signingHash: string; recipient: string; amountMicro: number }): Promise<{ signature: string; from: string }> {
      const recipient = String(request.recipient ?? '').toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(recipient)) throw new Error('bad_recipient');
      if (recipient === String(opts.contract).toLowerCase()) throw new Error('recipient_is_contract');
      if (!/^[0-9a-f]{64}$/.test(String(request.signingHash).replace(/^0x/i, '').toLowerCase())) throw new Error('bad_signing_hash');
      if (Number(request.amountMicro) <= 0) throw new Error('bad_amount');
      if (Number(request.amountMicro) > opts.maxTxMicro) throw new Error('amount_too_large');
      if (!opts.chainIds.includes(Number(request.tx.chainId))) throw new Error('chain_not_allowed');
      if (String(request.tx.to).toLowerCase() !== String(opts.contract).toLowerCase()) throw new Error('contract_not_allowed');
      if (BigInt(request.tx.value ?? '0') !== 0n) throw new Error('bad_value');
      if (BigInt(request.tx.gasLimit) > PAYOUT_GAS_LIMIT) throw new Error('gas_too_high');
      const digest = hexToBytes(String(request.signingHash).replace(/^0x/i, ''));
      return { signature: signDigest(digest, privKey).signature, from: evmAddressFromPrivateKey(privKey) };
    },
  };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const env = buildEnv(args);
  // `PAY_HOT_ADDRESS` в прогоне выводится из того же ключа, что и подпись:
  // сверяется не «адрес похож», а «адрес = этому ключу» — ровно та пара,
  // расхождение которой в бою стоит денег.
  if (!env.PAY_HOT_ADDRESS) {
    env.PAY_HOT_ADDRESS = evmAddressFromPrivateKey(String(env.SIGNER_PRIVATE_KEY ?? '').replace(/^0x/i, '').trim() || '0'.repeat(63) + '1');
  }
  // `Env` воркера в скриптах недоступен (в tsconfig.scripts нет его типов), а
  // `chainSpec` читает только нужные поля — отдаём им ровно их.
  const asEnv = env as unknown as Parameters<typeof chainSpec>[0];

  console.log(`Сквозная проверка EVM-рельса USDT в сети «${env.PAY_CHAIN}» (флаг --chain, иначе PAY_CHAIN)`);
  console.log(`режим: ${args.loopback ? 'loopback — локальная подставная нода' : 'сеть — реальная нода'}; отправка: ${args.send ? 'разрешена флагом --send' : 'нет (dry-run)'}`);
  console.log('');

  // 1. Конфигурация: всё, что решается без сети.
  const cfg = checkChainEnv(env);
  reportChecks('конфигурация', cfg.checks);
  if (cfg.fatal && !args.loopback) return finish(cfg.gasSymbol);

  // Тип `PayNetwork` исторически назван по TRON-тестнету (`nile`); для EVM-сетей
  // это «не mainnet» = тестнет. Значение берём из PAY_NETWORK, как это делает
  // флаг-модуль, а сеть прогон берёт из `cfg.chain`: одна и та же сборка скрипта
  // обязана проходить и BNB, и Polygon, иначе «мы прогнали рельс» будет значить
  // «прогнали одну сеть из двух».
  const network: PayNetwork = env.PAY_NETWORK === 'mainnet' ? 'mainnet' : 'nile';
  const spec = chainSpec(asEnv, { network, chain: cfg.chain });
  const contract = spec.contract || '0x' + 'c0'.repeat(20);
  // Знаки сети — они же «шкала прогона»: `loopback`, суммы raw и сверка каллдейта
  // обязаны считать в 18 или в 6 знаках в зависимости от того, какая сеть
  // прогоняется. Локальная переменная `decimals` ниже — это ответ `decimals()` от
  // ноды, не путать.
  const chainDecimals = spec.decimals;
  // `expectedId` ниже читается уже из спеки; петле он нужен раньше, чем нода
  // ответила, поэтому берём то же число из конфигурации.
  const expectedIdForLoop = spec.chainId ?? cfg.expectedChainId;
  const missing = [
    spec.ready.addresses ? null : 'выдача адресов',
    spec.ready.deposits ? null : 'мониторинг депозитов',
    spec.ready.payouts ? null : 'выплаты',
  ].filter(Boolean);
  report('контур сети', missing.length ? 'fail' : 'ok',
    `${spec.label}: ${missing.length ? `не готово — ${missing.join(', ')} (${spec.ready.reason || 'без причины'})` : 'адреса, депозиты и выплаты — включены'}; знаков ${spec.decimals}, подтверждений ${spec.confirmations}`);

  // 2. База: та же схема, что в проде (DDL из `pay/schema.ts`).
  resetPaySchemaForTests();
  const { db } = makeD1();
  await ensurePaySchema(db);
  const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'pay_%'").all<{ name: string }>();
  const tableCount = tables.results?.length ?? 0;
  // С сверкой по списку, а не по «на глазок 16»: таблица может появиться, и
  // «всё хорошо» должно означать «все таблицы контура на месте».
  report('схема', tableCount >= PAY_TABLES.length ? 'ok' : 'fail', `таблиц денежного контура в базе: ${tableCount} из ${PAY_TABLES.length}`);

  // 3. Адрес игрока: то же семя и тот же путь BIP-44, что у Signer.
  const player = await deriveEvmKey(args.seed, args.playerIndex);
  const hotKey = String(env.SIGNER_PRIVATE_KEY ?? '').replace(/^0x/i, '').trim() || '0'.repeat(63) + '1';
  const hot = evmAddressFromPrivateKey(hotKey);
  await db.prepare(
    `INSERT INTO pay_addresses (id, user_id, chain, address, hex, derivation_index, active, last_scanned_ts, created_at)
     VALUES ('ad_player', 'u_player', ?, ?, ?, ?, 1, 0, ?)`,
  ).bind(spec.chain, player.address.toLowerCase(), player.address.slice(2).toLowerCase(), player.index, T0).run();
  await db.prepare(
    `INSERT INTO pay_addresses (id, user_id, chain, address, hex, derivation_index, active, last_scanned_ts, created_at)
     VALUES ('ad_other', 'u_other', ?, ?, ?, 99, 1, 0, ?)`,
  ).bind(spec.chain, OTHER, OTHER.slice(2), T0).run();
  report('адрес игрока', /^0x[0-9a-fA-F]{40}$/.test(player.address) ? 'ok' : 'fail',
    `${toChecksumAddress(player.address)} — путь ${player.path}; монитор ищет его по колонке chain='${spec.chain}'`);
  report('адрес ↔ сеть', hot.startsWith('0x') ? 'ok' : 'fail',
    `PAY_HOT_ADDRESS=${hot} — форма 0x обязательна: T… в ${spec.label} остаётся валидным адресом, но это не наш кошелёк`);

  // 4. В loopback прогон сам играет «игрок отправил USDT»: событие в блоке,
  // газ на кошельке и балансы, которые читает план сбора.
  const loop = args.loopback ? new LoopbackNode(contract, hot) : null;
  if (loop) {
    // Подставка обязана выглядеть как та сеть, которую прогоняем: и `chainId`, и
    // `decimals()`. Иначе «loopback зелёный» проверяет BNB, а решение принимается
    // про Polygon.
    loop.chainIdValue = expectedIdForLoop;
    loop.decimalsValue = chainDecimals;
    loop.fund(player.address, microToRaw(args.amountMicro, chainDecimals));
    loop.setBalances({
      // 1.5 USDT на «чужом» адресе: ровно столько, чтобы план сбора обязан был
      // признать его собираемым (минимум вывода в EVM — 1 USDT).
      [OTHER]: { usdt: microToRaw(1_500_000, chainDecimals), bnb: 1n * 10n ** 17n },
      [player.address]: { usdt: 0n, bnb: 0n },
    });
    // Тестовая нативка «на руках» — ровно столько, чтобы --send-путь был проходим.
    loop.bnb.set(hot.toLowerCase(), 5n * 10n ** 17n);
    loop.usdt.set(hot.toLowerCase(), 2n * 10n ** BigInt(chainDecimals));
    // Событие обязано «состариться» до `head − confirmations`, иначе сканер
    // правомерно его не видит. Майним подтверждений + 1 блок.
    loop.mine(spec.confirmations + 1);
  }

  // 5. Нода: сеть, последний блок, есть ли контракт.
  const node = (loop ?? createEvmRpc({ url: spec.apiBase, timeoutMs: 15_000 })) as unknown as NodeLike;
  let head = 0;
  let nodeId = 0;
  let decimals = '';
  let nodeOk = true;
  try {
    nodeId = await node.chainId();
    head = await node.blockNumber();
    decimals = await node.call(contract, '0x95d89b41');
  } catch (e) {
    nodeOk = false;
    report('нода', args.loopback ? 'fail' : 'skip',
      `${e instanceof Error ? e.message : String(e)} — ${spec.apiBase} из этой среды недоступна; прогон против сети требует запуска с машины, у которой есть выход в интернет`);
  }
  const expectedId = cfg.expectedChainId;
  if (nodeOk) {
    report('нода', nodeId === expectedId ? 'ok' : 'fail',
      `chainId=${nodeId} (ожидали ${expectedId} для ${spec.label}), последний блок ${head}`);
    report('контракт USDT', BigInt(decimals || '0x0') > 0n ? 'ok' : 'fail',
      BigInt(decimals || '0x0') > 0n
        ? `decimals() = ${Number(BigInt(decimals))} по ${contract}`
        : `по ${contract} кода нет: токена в этой сети не существует (в тестнете USDT задеплойте сами и передайте --contract)`);
    const hotBnb = await node.balance(hot).catch(() => 0n);
    report(`${cfg.gasSymbol} на кошельке`, hotBnb > 0n ? 'ok' : 'skip',
      `${hotBnb} wei на ${hot}${hotBnb > 0n ? '' : ` — без тестового ${cfg.gasSymbol} настоящая отправка невозможна`}`);
  }

  // 6. Скан → зачисление.
  const scanAddresses = [player.address, OTHER];
  if (!args.loopback) {
    const from = Math.max(0, head - args.blocks);
    await db.prepare(
      `INSERT INTO pay_chain_cursor (chain, contract, height, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (chain, contract) DO UPDATE SET height = excluded.height, updated_at = excluded.updated_at`,
    ).bind(spec.chain, contract, from, T0).run();
    report('курсор', 'ok', `старт с блока ${await readCursor(db, spec.chain, contract)} — окно ${args.blocks} блоков до head−${spec.confirmations}`);
  }
  const deadline = Date.now() + args.waitSec * 1000;
  let credited = 0;
  let processed = 0;
  let orphan = 0;
  let rejected = 0;
  let scanError: string | null = null;
  let scannedTo = 0;
  let passes = 0;
  for (;;) {
    passes += 1;
    const scan = await scanEvmBlocks(db, {
      rpc: node,
      contract,
      chain: spec.chain,
      confirmations: spec.confirmations,
      addresses: scanAddresses,
      blocksPerPass: args.blocks,
    }, Date.now());
    const applied = await applyEvmDeposits(db, contract, Date.now(), 100, spec.chain);
    credited += applied.credited;
    processed += applied.processed;
    orphan += applied.orphan;
    rejected += scan.rejected;
    scannedTo = scan.toBlock;
    scanError = scan.error;
    if (credited > 0 || args.loopback || scanError || Date.now() >= deadline) break;
    console.log(`   … переводов на адрес нет: окно ${scan.fromBlock}–${scan.toBlock}, head ${scan.head}. Ждём ${args.intervalSec} с и повторяем.`);
    await new Promise((r) => setTimeout(r, args.intervalSec * 1000));
  }
  const balanceAfterDeposit = await payBalanceMicro(db, 'u_player');
  const verdict = depositVerdict({
    expectedMicro: args.loopback ? args.amountMicro : balanceAfterDeposit,
    creditedMicro: balanceAfterDeposit,
    events: processed,
    rejected,
    error: scanError,
    cursor: scannedTo,
  });
  // Сеть недоступна — это не «код не зачисляет»: называем причину средой, а не
  // прогоном, иначе отчёт выглядит как находка в денежном контуре.
  const depStatus = verdict.status === 'fail' && !nodeOk && !args.loopback ? 'skip' : verdict.status;
  report('депозит → зачисление', depStatus,
    `${nodeOk || args.loopback ? '' : 'нода недоступна → '}${verdict.reason}; баланс игрока ${formatUsdt(balanceAfterDeposit)} USDT, курсор ${scannedTo}, проходов ${passes}`);
  report('чужие переводы', scanError ? 'skip' : orphan ? 'fail' : 'ok', scanError
    ? 'скан не удался — про сирот и чужие переводы ничего не известно'
    : `отброшено нодой/фильтром: ${rejected}, сирот (деньги без владельца): ${orphan}${orphan ? ' — это адрес без активной записи в pay_addresses: игроку нужен возврат' : ''}`);

  // 7. Идемпотентность: второй проход ничего не добавляет.
  const second = await applyEvmDeposits(db, contract, Date.now(), 100, spec.chain);
  const balanceSecond = await payBalanceMicro(db, 'u_player');
  const idem = idempotencyVerdict({
    secondCredited: second.credited,
    balanceAfterFirst: balanceAfterDeposit,
    balanceAfterSecond: balanceSecond,
  });
  report('идемпотентность зачисления', idem.status, `${idem.reason}; дублей отброшено ${second.duplicated}`);

  // 8. Покупка в магазине: деньги игрока уходят в экономику, право появляется.
  if (balanceSecond <= 0) {
    report('покупка', 'skip', 'баланс пуст — покупать нечем (нужен зачисленный депозит)');
  } else {
    try {
      const order = await purchase(db, { userId: 'u_player', productId: args.buy, idemKey: 'rehearsal-buy-1' }, Date.now());
      const again = await purchase(db, { userId: 'u_player', productId: args.buy, idemKey: 'rehearsal-buy-1' }, Date.now() + 1);
      const owned = await entitlements(db, 'u_player');
      const afterBuy = await payBalanceMicro(db, 'u_player');
      const okBuy = afterBuy === balanceSecond - order.priceMicro;
      report('покупка', okBuy && owned.length === 1 && again.duplicated ? 'ok' : 'fail',
        `${order.productId} за ${formatUsdt(order.priceMicro)} USDT: баланс ${formatUsdt(balanceSecond)} → ${formatUsdt(afterBuy)}, прав ${owned.length}${owned[0]?.cosmetic ? ` (${owned[0].cosmetic})` : ''}, повтор того же ключа ${again.duplicated ? 'не списал второй раз' : 'СПИСАЛ ВТОРОЙ РАЗ'}`);
    } catch (e) {
      report('покупка', 'fail', `${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 9. Границы подписи — то, что в бою отмеряет Signer.
  const balanceBeforePayout = await payBalanceMicro(db, 'u_player');
  const chainId = nodeId || expectedId;
  const minMicro = minWithdrawMicro(spec.chain);
  // Сумма выплаты округляется вниз до кванта вывода: заявка мельче минимума не
  // создаётся, а «остаток на балансе» — ровно то, что останется игроку.
  const payoutMicro = Math.floor(balanceBeforePayout * args.payoutRatio / minMicro) * minMicro;
  const guards = signerGuardsCheck({ env, contract, chainId, amountMicro: payoutMicro, key: cfg.key });
  reportChecks('границы подписи', guards.checks);

  // 10. Заявка на выплату и тело транзакции. И там, и там — боевой код:
  // заявка проходит таблицу переходов `pay/payouts.ts`, транзакция собирается и
  // разбирается `pay/evm/broadcast.ts` + `pay/evm/tx.ts`.
  let withdrawalId = '';
  let reservedMicro = 0;
  let localHash = '';
  let nonceLock: { nonce: number; key: string } | null = null;

  if (payoutMicro < minMicro) {
    report('заявка на выплату', 'skip', `на балансе ${formatUsdt(balanceBeforePayout)} USDT, минимум вывода ${formatUsdt(minMicro)} USDT — заявку создать нечем`);
    report('транзакция выплаты', 'skip', 'нет заявки — собирать нечего');
  } else {
    const requested = await requestWithdrawal(db, {
      userId: 'u_player', chain: spec.chain, address: player.address, amountMicro: payoutMicro, idemKey: 'rehearsal-wd-1',
    }, Date.now());
    withdrawalId = requested.withdrawal.id;
    const secondRequest = await requestWithdrawal(db, {
      userId: 'u_player', chain: spec.chain, address: player.address, amountMicro: payoutMicro, idemKey: 'rehearsal-wd-1',
    }, Date.now() + 1);
    const count = await db.prepare("SELECT COUNT(*) AS n FROM pay_withdrawals WHERE user_id = 'u_player'").first<number>('n');
    report('заявка на выплату', Number(count ?? 0) === 1 && secondRequest.duplicated ? 'ok' : 'fail',
      `${withdrawalId} на ${formatUsdt(payoutMicro)} USDT, статус ${requested.withdrawal.status}, повтор той же заявки: ${secondRequest.duplicated ? 'вторая строка не появилась' : 'ПОЯВИЛАСЬ ВТОРАЯ СТРОКА'}, всего заявок ${count}`);
    await approveWithdrawal(db, withdrawalId, Date.now());
    await reserveWithdrawal(db, withdrawalId, Date.now());
    // Резерв обязателен: без записи в журнал одна и та же монета могла бы уйти
    // дважды, и ни одна сверка бы это не поймала.
    reservedMicro = payoutMicro;
    report('резерв', (await payBalanceMicro(db, 'u_player')) === balanceBeforePayout - payoutMicro ? 'ok' : 'fail',
      `списание в реестр reason=payout: баланс ${formatUsdt(balanceBeforePayout)} → ${formatUsdt(await payBalanceMicro(db, 'u_player'))}`);

    const nonce = await node.transactionCount(hot, 'pending').catch(() => 0);
    const tx = buildPayoutTx({
      chainId,
      nonce,
      contract,
      recipient: player.address,
      amountMicro: payoutMicro,
      // Знаки сети, в которую платим: прогон обязан собрать ровно то тело, что
      // соберёт боевой код, — иначе «сумма в каллдейте» проверялась бы не та.
      chain: spec.chain,
      maxFeePerGas: 1_500_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
    });
    const raw = applySignature(tx, signDigest(hexToBytes(signingHash(tx).slice(2)), hotKey).signature);
    const decoded = decodeSignedTx(raw);
    reportChecks('транзакция выплаты', payoutTxCheck({
      got: decoded as unknown as Record<string, unknown>,
      want: { contract, chainId, nonce, gasLimit: PAYOUT_GAS_LIMIT, recipient: player.address, amountMicro: payoutMicro, decimals: chainDecimals, gasSymbol: cfg.gasSymbol },
    }).checks);
    // Тот же расчёт, что делает узел и что сверяет `sendUsdtEvm`: keccak256 от
    // байт подписанной транзакции. Разошлось — значит в сеть уходит не то тело.
    localHash = `0x${bytesToHex(keccak256(hexToBytes(raw.slice(2))))}`;
    report('хеш ↔ отправка', /^0x[0-9a-f]{64}$/.test(localHash) ? 'ok' : 'fail',
      `${localHash} — хеш того же тела, которое уходит в сеть; узел обязан ответить тем же`);

    // 11. Замок nonce: два параллельных отправителя не берут один номер. Замок
    // нужен и здесь: прогон обязан показать, что «взятый» номер действительно
    // занят, иначе `sendUsdtEvm` подпишет чужой nonce.
    try {
      const first = await reserveNonce(db, node, chainId, hot, Date.now());
      const secondTry = await reserveNonce(db, node, chainId, hot, Date.now());
      nonceLock = first;
      report('замок nonce', secondTry.nonce > first.nonce ? 'ok' : 'fail',
        `первый взял ${first.nonce}, второй — ${secondTry.nonce}; ключ ${nonceKey(chainId, hot, first.nonce)}`);
    } catch (e) {
      report('замок nonce', 'fail', `${e instanceof Error ? e.message : String(e)} — номер занять не удалось`);
    }
  }

  // 12. Отправка. Здесь у прогона единственный «внешний» мир: сеть. В loopback
  // она локальная и отвечает так же, как настоящая нода, — включая форму `txid`
  // и квитанцию, на которых чаще всего и спотыкаются.
  let sentTxid: string | null = null;
  if (!withdrawalId) {
    report('отправка в сеть', 'skip', 'нет заявки — отправлять нечего');
  } else if (args.send && env.PAY_NETWORK === 'mainnet') {
    report('отправка в сеть', 'fail', 'PAY_NETWORK=mainnet: прогон не отправляет транзакции в боевую сеть — только в тестнет');
  } else if (!args.loopback && !args.send) {
    report('отправка в сеть', 'skip', 'флаг --send не выставлен: транзакция собрана и проверена, в сеть не уходила');
  } else {
    const signer: EvmSignerClient = localSigner(hotKey, {
      contract,
      chainIds: [chainId],
      maxTxMicro: Number(env.SIGNER_MAX_TX_MICRO ?? '100000000'),
    });
    try {
      if (!args.loopback) {
        const gas = await payoutGas(node, hot);
        report('газ', 'ok', `maxFeePerGas=${gas.maxFeePerGas} wei, maxPriority=${gas.maxPriorityFeePerGas} wei, nonce от ноды ${gas.nonce}`);
      }
      const result = await sendUsdtEvm(node as never, signer, {
        owner: hot, recipient: player.address, amountMicro: payoutMicro, contract, chainId,
        chain: spec.chain, nonce: nonceLock?.nonce,
      });
      sentTxid = result.txid;
      // `reserved → broadcasting` + попытка в `pay_payouts` — боевой путь. Форма
      // `txid` (64 hex без `0x`) проверяется внутри, и это ровно то, на чём
      // ломается сверка, если вставить хеш «как convenient».
      await markBroadcast(db, withdrawalId, { txid: result.txid, attempt: 1 }, Date.now());
      const sameHash = result.txid.toLowerCase() === localHash.slice(2).toLowerCase();
      report('отправка в сеть', sameHash ? 'ok' : 'fail', sameHash
        ? `txid ${result.txid} = keccak256 нашего тела (нода приняла ровно то, что мы собрали), nonce ${result.nonce}, потолок газа ${result.maxCostWei} wei`
        : `txid ${result.txid} ≠ хеш тела ${localHash.slice(2)} — нода приняла не то, что подписано`);
      // Событие «выплата дошла»: в loopback сеть сама включает её в следующий блок.
      loop?.mine(spec.confirmations);
    } catch (e) {
      report('отправка в сеть', 'fail',
        `${e instanceof Error ? e.message : String(e)} — код до сети дошёл, отказ${args.loopback ? ' (на loopback это поломка прогона, а не тестнета)' : ''}`);
    }
    if (nonceLock) await releaseNonce(db, nonceLock.key).catch(() => null);
  }

  // 13. Квитанция и подтверждение заявки — ровно тем кодом, что крутится в cron.
  if (!sentTxid) {
    report('квитанция', 'skip', 'транзакции в сети нет — сверять нечего');
    report('подтверждение заявки', 'skip', 'нет txid: переход sent → confirmed проверить не на чем');
  } else {
    const headNow = await node.blockNumber();
    const receipt = await node.transactionReceipt(sentTxid).catch(() => null);
    const rv = receiptVerdict({ receipt, head: headNow, confirmations: spec.confirmations });
    report('квитанция', rv.status, rv.reason);
    const one = await verifyPayout({ db, rpc: node as never, confirmations: spec.confirmations, withdrawalId, now: Date.now() });
    const queue = await applyEvmPayoutConfirmations(db, node as never, spec.confirmations, Date.now(), spec.chain);
    const statusRow = await db.prepare('SELECT status FROM pay_withdrawals WHERE id = ?').bind(withdrawalId).first<string>('status');
    const okConfirm = statusRow === 'confirmed';
    report('подтверждение заявки', okConfirm ? 'ok' : (one === 'pending' ? 'skip' : 'fail'),
      `verifyPayout → ${one}; очередь: проверено ${queue.checked}, подтверждено ${queue.confirmed}, ревертов ${queue.reverted}, ждём ${queue.pending}; статус заявки ${statusRow}${okConfirm ? ' — путь broadcasting → sent → confirmed пройден целиком' : ''}`);
  }

  // 14. План сбора: что унесём с адресов игроков и чего не хватает на газ.
  const plan = await evmSweepPlan({
    db,
    rpc: node as never,
    contract,
    network,
    chain: spec.chain,
    destination: hot,
    sweepEnabled: true,
    maxFeePerGas: 1_500_000_000n,
  });
  const noGas = plan.rows.filter((r) => r.blocker === 'bnb_missing').length;
  report('план сбора', plan.reason ? 'fail' : plan.totals.sweepableMicro > 0 || noGas > 0 ? 'ok' : 'skip',
    `адресов ${plan.addresses}${plan.truncated ? ' (список обрезан лимитом)' : ''}: к сбору ${formatUsdt(plan.totals.sweepableMicro)} USDT, ниже минимума ${formatUsdt(plan.totals.belowMinMicro)} USDT, без газа ${noGas}, нужно занести ${plan.totals.gasNeededWei} wei ${cfg.gasSymbol}, один перевод ${plan.totals.feePerSweepWei} wei${plan.reason ? `, блокер ${plan.reason}` : ''}`);

  // 15. Учёт: остаток = зачислено − потрачено, цепочка хешей цела.
  const balanceEnd = await payBalanceMicro(db, 'u_player');
  // «Потрачено» — всё, что ушло из журнала: покупка и резерв заявки. Отправка в
  // сеть второй записи не добавляет: резерв списывает деньги в `pay_ledger`
  // заранее, сеть лишь подтверждает, что они ушли.
  const spent = (balanceAfterDeposit - balanceBeforePayout) + reservedMicro;
  const ledger = await verifyPayLedger(db);
  reportChecks('учёт', ledgerVerdict({
    beforeMicro: 0,
    depositedMicro: balanceAfterDeposit,
    paidOutMicro: spent,
    afterMicro: balanceEnd,
    ledgerOk: ledger.ok,
  }).checks);
  report('реестр', ledger.brokenAt ? 'fail' : 'ok', `записей ${ledger.rows}, разрывов ${ledger.brokenAt ?? 'нет'}, сверок баланса с журналом: расхождений ${ledger.mismatches.length}`);

  return finish(cfg.gasSymbol);
}

function finish(gasSymbol = 'BNB'): number {
  const summary = summarize(results);
  const notOk = results.filter((r) => r.status !== 'ok');
  if (notOk.length) {
    console.log('');
    console.log('Что не пройдено и почему:');
    for (const r of notOk) console.log(`  ${r.status === 'skip' ? 'ПРОПУСК' : 'ПРОВАЛ'} — ${r.step}: ${r.reason}`);
  }
  console.log('');
  console.log(summary.headline);
  console.log(`Газ — монета своей сети (${gasSymbol}); USDT — токен сети, а не нативка.`);
  console.log('Путь целиком: адрес игрока → перевод USDT в сети → eth_getLogs → pay_chain_events → зачисление в pay_ledger → покупка → заявка → подпись → eth_sendRawTransaction → квитанция → confirmed.');
  const sent = results.find((r) => r.step === 'отправка в сеть');
  console.log(`Отправка в сеть: ${sent?.status === 'ok' ? 'была' : 'не была'}. Этот прогон не включает PAYOUTS_ENABLED/SWEEP_ENABLED и не платит реальные деньги: решение о флагах остаётся за владельцем.`);
  if (summary.skipped > 0) {
    console.log('Непроверенное ногами (сеть/контракт/газ) не становится «OK» от того, что скрипт зелёный. Полный ответ — только в тестнете с задеплоенным токеном, тестовыми USDT у игрока и тестовой нативкой (BNB или POL) у кошелька.');
  }
  return summary.exitCode;
}

main().then((code) => {
  process.exitCode = code;
}).catch((e: unknown) => {
  console.error('Прогон упал:', e instanceof Error ? e.stack ?? e.message : String(e));
  process.exitCode = 1;
});
