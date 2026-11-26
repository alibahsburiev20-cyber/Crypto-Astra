// Решения сквозной проверки BSC-тестнета (`scripts/pay-bsc-rehearsal.ts`).
//
// Здесь нет ни сети, ни базы: только ответы на вопросы «готово ли окружение к
// прогону», «зачислилось ли ровно то, что пришло», «ту ли транзакцию мы
// подписали», «можно ли сверять квитанцию» и «сошёлся ли баланс». Вынесено в
// отдельный чистый файл, потому что решение должно проверяроваться без живой
// ноды: сам прогон требует доступа к сети, а эти правила работают в любой
// песочнице и в CI (см. `payBscRehearseRules.test.ts`).
//
// Каждый вердикт — `{ status: 'ok' | 'skip' | 'fail', reason }`. `skip`
// означает «этот шаг сейчас не проверяем, и мы знаем почему». Тихого «всё
// хорошо» вместо непроверенного шага здесь нет намеренно: ровно на этом
// расхождении «зелёный скрипт / пустой кошелёк» ловят не тесты, а неделю
// поддержки.

/** Статус шага прогона. */
export type VerdictStatus = 'ok' | 'skip' | 'fail';

export interface RehearseCheck {
  step: string;
  status: VerdictStatus;
  reason: string;
  /** Провал этого шага делает дальнейший прогон бессмысленным. */
  fatal?: boolean;
}

export interface RehearseEnv {
  PAY_CHAIN?: string;
  PAY_NETWORK?: string;
  PAY_EVM_CONTRACT?: string;
  PAY_EVM_RPC?: string;
  PAY_EVM_CONFIRMATIONS?: string;
  PAY_HOT_ADDRESS?: string;
  PAYOUTS_ENABLED?: string;
  SWEEP_ENABLED?: string;
  POOL_ENABLED?: string;
  SIGNER_PRIVATE_KEY?: string;
  SIGNER_EVM_CONTRACT?: string;
  SIGNER_EVM_CHAIN_IDS?: string;
  SIGNER_MAX_TX_MICRO?: string;
  [key: string]: string | undefined;
}

/** Милли-единицы USDT (6 знаков) в «raw» сети с `decimals` знаками. */
export function microToRaw(micro: number, decimals = 18): bigint {
  const m = BigInt(Math.trunc(Number(micro) || 0));
  return m * 10n ** BigInt(decimals - 6);
}

/**
 * Шаг 1: что говорит конфигурация.
 *
 * Порядок проверок — от «деньги вообще выключены» к «включены, но не туда»:
 * незнакомая сеть и пустой контракт выключают приём сами (см. `pay/chain.ts`),
 * и прогон в такой конфигурации не проверяет ничего.
 */
export function checkChainEnv(env: RehearseEnv): { fatal: boolean; checks: RehearseCheck[]; chain: string; network: string; contract: string } {
  const chain = String(env.PAY_CHAIN ?? 'tron').trim().toLowerCase();
  const network = String(env.PAY_NETWORK ?? 'mainnet').trim().toLowerCase();
  const out: RehearseCheck[] = [];
  const push = (step: string, status: VerdictStatus, reason: string, extra: Partial<RehearseCheck> = {}): void => {
    out.push({ step, status, reason, ...extra });
  };
  const result = (fatal: boolean): { fatal: boolean; checks: RehearseCheck[]; chain: string; network: string; contract: string } => ({
    fatal,
    checks: out,
    chain,
    network,
    contract: String(env.PAY_EVM_CONTRACT ?? '').trim().toLowerCase(),
  });

  if (chain !== 'bsc') {
    push('сеть', 'fail', `PAY_CHAIN="${chain}" — рельс USDT BEP-20 не активен, прогонять нечего`, { fatal: true });
    return result(true);
  }
  push('сеть', 'ok', 'PAY_CHAIN="bsc" — активен рельс USDT BEP-20');

  if (network !== 'testnet' && network !== 'mainnet') {
    push('среды', 'fail', `PAY_NETWORK="${network}" — неизвестное значение, деньги выключены`, { fatal: true });
    return result(true);
  }
  push('среды', 'ok', network === 'testnet'
    ? 'PAY_NETWORK="testnet" — сеть 97, боевые настройки на неё не действуют'
    : 'PAY_NETWORK="mainnet" — прогон не отправит ни одной транзакции (см. --send)');

  const contract = String(env.PAY_EVM_CONTRACT ?? '').trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(contract)) {
    push('контракт', 'fail', contract
      ? `PAY_EVM_CONTRACT="${contract}" — не адрес`
      : 'PAY_EVM_CONTRACT пуст: приём сам выключается (bsc_contract_missing)', { fatal: true });
    return result(true);
  }
  push('контракт', 'ok', `контракт USDT задан: ${contract}`);

  const rpc = String(env.PAY_EVM_RPC ?? '').trim();
  if (!rpc) {
    push('нода', 'fail', 'PAY_EVM_RPC пуст — читать сеть нечем', { fatal: true });
    return result(true);
  }
  push('нода', 'ok', `PAY_EVM_RPC=${rpc}`);

  const confirmations = Number(env.PAY_EVM_CONFIRMATIONS ?? '');
  if (!Number.isInteger(confirmations) || confirmations < 1) {
    push('подтверждения', 'fail', `PAY_EVM_CONFIRMATIONS="${env.PAY_EVM_CONFIRMATIONS}" — нужно целое число не меньше 1`, { fatal: true });
  } else if (network === 'mainnet' && confirmations < 12) {
    push('подтверждения', 'fail', `${confirmations} подтверждений на проде мало: нужно 12–15`, { fatal: true });
  } else {
    push('подтверждения', 'ok', `${confirmations} подтверждений`);
  }

  const hot = String(env.PAY_HOT_ADDRESS ?? '').trim();
  if (!hot) {
    push('кошелёк', 'fail', 'PAY_HOT_ADDRESS пуст — смотреть баланс и слать выплаты некуда', { fatal: true });
  } else if (hot.startsWith('T')) {
    push('кошелёк', 'fail', 'PAY_HOT_ADDRESS в форме TRON (T…) — в BSC это чужой адрес, USDT уйдут в никуда', { fatal: true });
  } else if (!/^0x[0-9a-fA-F]{40}$/.test(hot)) {
    push('кошелёк', 'fail', `PAY_HOT_ADDRESS="${hot}" — не 0x-адрес`, { fatal: true });
  } else {
    push('кошелёк', 'ok', `PAY_HOT_ADDRESS=${hot}`);
  }

  // Флаги выплат и сбора на тестнете не включают: прогон проверяет код, а не
  // разрешение платить. Отдельное «skip» здесь — чтобы это выглядело решением,
  // а не забытой строкой.
  const on = ['PAYOUTS_ENABLED', 'SWEEP_ENABLED', 'POOL_ENABLED'].filter((f) => String(env[f] ?? '').trim() === 'true');
  if (network === 'testnet' && on.length) {
    push('флаги', 'skip', `включены ${on.join(', ')} — прогон их не отключает и не проверяет: решение о флагах только за владельцем`);
  } else {
    push('флаги', 'ok', 'боевые флаги выплат выключены — прогон ничего не платит сам');
  }

  return result(out.some((c) => c.status === 'fail' && c.fatal));
}

export interface DepositVerdictInput {
  expectedMicro: number;
  creditedMicro: number;
  events: number;
  rejected?: number;
  error?: string | null;
  cursor?: number | null;
}

/**
 * Шаг 4: что нарыл сканер.
 *
 * `expectedMicro` — сколько игрок отправил, `creditedMicro` — сколько зачлось.
 * Сверка идёт в микро-единицах: 18-значная шкала сети и 6-значная шкала баланса
 * игрока обязаны сойтись ровно, до последней единицы.
 */
export function depositVerdict(input: DepositVerdictInput): { status: VerdictStatus; reason: string; hint?: string } {
  if (input.error) return { status: 'fail', reason: `сканер вернул ошибку: ${input.error}` };
  if (input.events === 0) {
    return {
      status: 'skip',
      reason: 'в отсканированном окне переводов на адрес игрока нет',
      hint: 'отправьте USDT тестовой сети на адрес игрока и повторите с --wait',
    };
  }
  const expected = BigInt(Math.trunc(Number(input.expectedMicro) || 0));
  const credited = BigInt(Math.trunc(Number(input.creditedMicro) || 0));
  if (credited === 0n) {
    return { status: 'fail', reason: `событий ${input.events}, а зачислено 0: владелец адреса не найден (orphan) или событию не хватает подтверждений` };
  }
  if (credited !== expected) {
    const diff = credited - expected;
    return {
      status: 'fail',
      reason: `зачислено ${credited} микро, ожидалось ${expected} (разница ${diff > 0n ? '+' : ''}${diff}) — шкала знаков или фильтр адресов врёт`,
    };
  }
  return {
    status: 'ok',
    reason: `зачислено ровно ${expected} микро (${formatUsdt(expected)} USDT) по событий: ${input.events}${input.rejected ? `, отброшено чужих: ${input.rejected}` : ''}`,
  };
}

/** Шаг 5: повторный проход не должен добавлять ни копейки. */
export function idempotencyVerdict(input: {
  secondCredited: number;
  balanceAfterSecond: number;
  balanceAfterFirst: number;
}): { status: VerdictStatus; reason: string } {
  if (input.secondCredited !== 0) {
    return { status: 'fail', reason: `второй проход зачислил ещё ${input.secondCredited} — ключ идемпотентности не работает` };
  }
  if (input.balanceAfterSecond !== input.balanceAfterFirst) {
    return { status: 'fail', reason: `баланс после второго прохода изменился: ${input.balanceAfterFirst} → ${input.balanceAfterSecond}` };
  }
  return { status: 'ok', reason: 'второй проход: зачислено 0, баланс не изменился' };
}

/** Разобрать `transfer(address,uint256)`; не наш формат — null. */
export function parseTransferData(data: string): { to: string; amountRaw: bigint } | null {
  const clean = String(data ?? '').replace(/^0x/i, '').toLowerCase();
  if (!clean.startsWith('a9059cbb') || clean.length < 8 + 128) return null;
  return {
    to: `0x${clean.slice(8 + 24, 8 + 64)}`,
    amountRaw: BigInt(`0x${clean.slice(8 + 64, 8 + 128)}`),
  };
}

export interface PayoutTxWant {
  contract: string;
  chainId: number;
  nonce: number;
  gasLimit?: bigint;
  recipient: string;
  amountMicro: number;
  decimals?: number;
  maxCostWei?: bigint;
}

/**
 * Шаг 6: поля подписанной транзакции против того, что просили.
 *
 * Проверяем то, за что отвечают два независимых контура: сеть (chainId),
 * получатель, сумма, «value = 0 — всё в каллдейте» и потолок газа.
 */
export function payoutTxCheck(input: {
  got: { to?: string; chainId?: number; nonce?: number; gasLimit?: bigint | number; value?: bigint | number; data?: string; maxFeePerGas?: bigint | number };
  want: PayoutTxWant;
}): { status: VerdictStatus; checks: RehearseCheck[] } {
  const got = input.got;
  const want = input.want;
  const out: RehearseCheck[] = [];
  const eq = (step: string, a: unknown, b: unknown): void => {
    const same = String(a).toLowerCase() === String(b).toLowerCase() || BigInt(String(a ?? 0)) === BigInt(String(b ?? 0));
    out.push({
      step,
      status: same ? 'ok' : 'fail',
      reason: same ? `${step}: ${String(a)}` : `${step}: получили ${String(a)}, ожидали ${String(b)}`,
    });
  };
  eq('to', got.to, want.contract);
  eq('chainId', got.chainId, want.chainId);
  eq('nonce', got.nonce, want.nonce);
  eq('gasLimit', got.gasLimit, want.gasLimit ?? 80000n);
  eq('value', got.value, 0n);

  const dec = parseTransferData(String(got.data ?? ''));
  if (!dec) {
    out.push({ step: 'каллдейт', status: 'fail', reason: 'data не разбирается как transfer(address,uint256)' });
  } else {
    const toOk = dec.to.toLowerCase() === want.recipient.toLowerCase();
    out.push({
      step: 'получатель',
      status: toOk ? 'ok' : 'fail',
      reason: toOk ? `получатель в каллдейте: ${dec.to}` : `получатель в каллдейте ${dec.to}, а ждали ${want.recipient}`,
    });
    const expectedRaw = microToRaw(want.amountMicro, want.decimals ?? 18);
    out.push({
      step: 'сумма',
      status: dec.amountRaw === expectedRaw ? 'ok' : 'fail',
      reason: dec.amountRaw === expectedRaw
        ? `сумма в каллдейте: ${dec.amountRaw} raw (${formatUsdt(want.amountMicro)} USDT)`
        : `сумма в каллдейте ${dec.amountRaw}, ожидали ${expectedRaw} (${formatUsdt(want.amountMicro)} USDT) — 6/18 знаков перепутаны`,
    });
  }

  const maxCost = BigInt(got.gasLimit ?? 0) * BigInt(got.maxFeePerGas ?? 0);
  const cap = want.maxCostWei ?? 0n;
  out.push({
    step: 'потолок газа',
    // На тестнете потолок не выставляют: там газ бесплатный и любые числа ок.
    status: cap === 0n ? 'ok' : (maxCost <= cap ? 'ok' : 'fail'),
    reason: cap === 0n
      ? `стоимость газа ${formatEther(maxCost)} BNB (потолок не задан)`
      : `стоимость газа ${formatEther(maxCost)} BNB, потолок ${formatEther(cap)} BNB`,
  });
  return { status: out.some((c) => c.status === 'fail') ? 'fail' : 'ok', checks: out };
}

/**
 * Шаг 7: можно ли сверять квитанцию и что она показала.
 *
 * «Квитанции нет» и «квитанция есть, но глубина мала» — разные состояния, и оба
 * правильные: первая транзакция в мемпуле, вторая ещё не доросла до
 * `confirmations`. Ошибкой считается только реверт.
 */
export function receiptVerdict(input: {
  receipt: { status?: boolean | number; blockNumber?: number | null; logs?: unknown[] } | null;
  head: number;
  confirmations: number;
}): { status: VerdictStatus; reason: string } {
  const receipt = input.receipt;
  if (!receipt) return { status: 'skip', reason: 'квитанции ещё нет — транзакция может лежать в мемпуле, это не ошибка' };
  if (!receipt.status) {
    return { status: 'fail', reason: 'квитанция со status = 0: сеть откатила транзакцию (реверт), заявка уйдёт в failed с возвратом резерва' };
  }
  const block = Number(receipt.blockNumber ?? 0);
  const depth = Number(input.head ?? 0) - block + 1;
  if (depth < Number(input.confirmations)) {
    return { status: 'skip', reason: `глубина ${depth} из ${input.confirmations} подтверждений — сверка догонит на следующем проходе cron` };
  }
  const logs = Array.isArray(receipt.logs) ? receipt.logs.length : 0;
  return { status: 'ok', reason: `квитанция в блоке ${block}, глубина ${depth}, логов ${logs} — выплата подтвердится по этому же пути` };
}

/**
 * Шаг 8: сходимость учёта.
 *
 * Формула одна: `остаток = зачислено − потрачено`. Плюс отдельная проверка
 * цепочки хешей реестра — без неё «баланс сошёлся» может означать «в таблице
 * просто поменяли цифру».
 */
export function ledgerVerdict(input: {
  beforeMicro: number;
  depositedMicro: number;
  paidOutMicro: number;
  afterMicro: number;
  ledgerOk: boolean;
}): { status: VerdictStatus; checks: RehearseCheck[] } {
  const before = BigInt(Math.trunc(Number(input.beforeMicro) || 0));
  const deposited = BigInt(Math.trunc(Number(input.depositedMicro) || 0));
  const paid = BigInt(Math.trunc(Number(input.paidOutMicro) || 0));
  const expected = before + deposited - paid;
  const actual = BigInt(Math.trunc(Number(input.afterMicro) || 0));
  const out: RehearseCheck[] = [{
    step: 'баланс',
    status: expected === actual ? 'ok' : 'fail',
    reason: expected === actual
      ? `${formatUsdt(before)} + ${formatUsdt(deposited)} − ${formatUsdt(paid)} = ${formatUsdt(actual)} USDT`
      : `ожидали ${expected} микро, в балансе ${actual} микро`,
  }];
  out.push({
    step: 'реестр',
    status: input.ledgerOk ? 'ok' : 'fail',
    reason: input.ledgerOk ? 'цепочка хешей pay_ledger цела' : 'цепочка хешей pay_ledger не сходится: запись правили мимо реестра',
  });
  return { status: out.some((c) => c.status === 'fail') ? 'fail' : 'ok', checks: out };
}

/**
 * Проверка локального подписанта — те же границы, что выставлены в Signer.
 *
 * Прогон подписывает тестовым ключом здесь (в бою ключ живёт только в Signer),
 * поэтому его обязанность — показать, что локальный путь проходит ровно те же
 * отсечки: чужой контракт, чужая сеть, сумма больше потолка, ключа нет.
 */
export function signerGuardsCheck(input: {
  env: RehearseEnv;
  contract: string;
  chainId: number;
  amountMicro: number;
}): { status: VerdictStatus; checks: RehearseCheck[] } {
  const env = input.env;
  const out: RehearseCheck[] = [];
  const push = (step: string, status: VerdictStatus, reason: string): void => { out.push({ step, status, reason }); };

  if (!String(env.SIGNER_PRIVATE_KEY ?? '').trim()) {
    push('ключ', 'skip', 'SIGNER_PRIVATE_KEY нет — подпись поднимается локальным тестовым ключом, боковой контур не задействован');
  } else {
    push('ключ', 'ok', 'ключ подписи есть (в прогоне используется только локально, в сеть не передаётся)');
  }

  const allowContract = String(env.SIGNER_EVM_CONTRACT ?? '').trim().toLowerCase();
  if (allowContract && allowContract !== String(input.contract).toLowerCase()) {
    push('allowlist контракта', 'fail', `SIGNER_EVM_CONTRACT=${allowContract}, а прогон шлёт на ${input.contract} — Signer бы отказал (contract_not_allowed)`);
  } else {
    push('allowlist контракта', 'ok', allowContract ? 'allowlist совпадает с PAY_EVM_CONTRACT' : 'SIGNER_EVM_CONTRACT не задан — сверять не с чем, прогон использует свой контракт');
  }

  const allowChains = String(env.SIGNER_EVM_CHAIN_IDS ?? '').split(',').map((s) => Number(s.trim())).filter(Boolean);
  if (allowChains.length && !allowChains.includes(Number(input.chainId))) {
    push('allowlist сети', 'fail', `SIGNER_EVM_CHAIN_IDS=${allowChains.join(',')} — сети ${input.chainId} нет, подпись не выдаётся`);
  } else {
    push('allowlist сети', 'ok', allowChains.length ? `сеть ${input.chainId} в allowlist` : 'SIGNER_EVM_CHAIN_IDS не задан');
  }

  const cap = Number(env.SIGNER_MAX_TX_MICRO ?? 0);
  if (cap > 0 && Number(input.amountMicro) > cap) {
    push('потолок суммы', 'fail', `сумма ${input.amountMicro} микро больше SIGNER_MAX_TX_MICRO=${cap} — подпись не выдаётся`);
  } else {
    push('потолок суммы', 'ok', cap > 0 ? `сумма ${input.amountMicro} микро в потолке ${cap}` : 'потолок не задан');
  }
  return { status: out.some((c) => c.status === 'fail') ? 'fail' : 'ok', checks: out };
}

/** Итог прогона: «всё хорошо» только если непроверенных шагов не осталось. */
export function summarize(steps: { step?: string; status: VerdictStatus }[]): {
  ok: number;
  skipped: number;
  failed: number;
  passed: boolean;
  exitCode: number;
  headline: string;
} {
  const ok = steps.filter((s) => s.status === 'ok').length;
  const skip = steps.filter((s) => s.status === 'skip');
  const fail = steps.filter((s) => s.status === 'fail');
  const passed = fail.length === 0;
  return {
    ok,
    skipped: skip.length,
    failed: fail.length,
    passed,
    // 2 — «сошлось, но не всё»: отдельный код, чтобы cron/CI не путал
    // неполную проверку с полной.
    exitCode: passed ? (skip.length ? 2 : 0) : 1,
    headline: fail.length
      ? `ПРОВАЛ: ${fail.length} шаг(ов) не сошлись — ${fail.map((s) => s.step).join(', ')}`
      : skip.length
        ? `Пройдено ${ok} шагов, ${skip.length} помечены «не тронули»: ${skip.map((s) => s.step).join(', ')}`
        : `Пройдено ${ok} шагов, непроверенных не осталось`,
  };
}

/** Микро-USDT в человекочитаемое число. */
export function formatUsdt(micro: number | bigint): string {
  const v = BigInt(Math.trunc(Number(micro) || 0));
  const sign = v < 0n ? '-' : '';
  const abs = v < 0n ? -v : v;
  const frac = (abs % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${sign}${abs / 1_000_000n}.${frac || '0'}`;
}

/** Wei в BNB с 6 знаками — для строк про газ. */
export function formatEther(wei: number | bigint): string {
  const w = BigInt(wei ?? 0);
  return `${w / 10n ** 18n}.${(w % 10n ** 18n).toString().padStart(18, '0').slice(0, 6)}`;
}
