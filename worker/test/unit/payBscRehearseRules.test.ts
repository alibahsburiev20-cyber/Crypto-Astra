// Правила, по которым сквозной прогон BSC говорит «сошлось» или «нет».
//
// Сам прогон требует живой ноды, а эти решения — нет, поэтому они вынесены в
// чистый файл и проверяются здесь. Важно это вот почему: у «непроверенного
// шага» и у «проверенного шага» в отчёте должен быть разный статус, иначе
// недельная сверка превращается в «скрипт зелёный, а денег нет».
import { describe, expect, it } from 'vitest';
import {
  checkChainEnv,
  depositVerdict,
  formatUsdt,
  idempotencyVerdict,
  ledgerVerdict,
  microToRaw,
  parseTransferData,
  payoutTxCheck,
  receiptVerdict,
  signerGuardsCheck,
  summarize,
} from '../../../scripts/lib/rehearse';

const CONTRACT = '0x' + '11'.repeat(20);
const PLAYER = '0x' + '22'.repeat(20);

describe('прогон: конфигурация', () => {
  it('без PAY_CHAIN="bsc" прогон не начинается', () => {
    const v = checkChainEnv({ PAY_CHAIN: 'tron' });
    expect(v.fatal).toBe(true);
    expect(v.checks[0].status).toBe('fail');
  });

  it('пустой контракт — fatal: приём сам выключается', () => {
    const v = checkChainEnv({ PAY_CHAIN: 'bsc', PAY_NETWORK: 'testnet', PAY_EVM_CONTRACT: '' });
    expect(v.fatal).toBe(true);
    expect(v.checks.some((c) => c.step === 'контракт' && c.status === 'fail')).toBe(true);
  });

  it('PAY_HOT_ADDRESS в форме TRON — fatal: деньги уйдут в никуда', () => {
    const v = checkChainEnv({
      PAY_CHAIN: 'bsc',
      PAY_NETWORK: 'testnet',
      PAY_EVM_CONTRACT: CONTRACT,
      PAY_EVM_RPC: 'https://example.com',
      PAY_EVM_CONFIRMATIONS: '3',
      PAY_HOT_ADDRESS: 'TAzT9Qz1zaK5bJiLTNA8yPq1i7VJkXjnPB',
    });
    expect(v.checks.some((c) => c.step === 'кошелёк' && c.status === 'fail')).toBe(true);
  });

  it('полная тестовая конфигурация проходит, а боевые флаги не мешают', () => {
    const v = checkChainEnv({
      PAY_CHAIN: 'bsc',
      PAY_NETWORK: 'testnet',
      PAY_EVM_CONTRACT: CONTRACT,
      PAY_EVM_RPC: 'https://example.com',
      PAY_EVM_CONFIRMATIONS: '3',
      PAY_HOT_ADDRESS: '0x' + '33'.repeat(20),
    });
    expect(v.fatal).toBe(false);
    expect(v.checks.every((c) => c.status !== 'fail')).toBe(true);
  });

  it('Polygon — тот же прогон, другие числа: 6 знаков, 80002, POL-переменные', () => {
    const v = checkChainEnv({
      PAY_CHAIN: 'polygon',
      PAY_NETWORK: 'testnet',
      PAY_EVM_CHAINS: 'polygon',
      PAY_EVM_CONTRACT_POL: CONTRACT,
      PAY_EVM_RPC_POL: 'https://amoy.example/rpc',
      PAY_EVM_CONFIRMATIONS_POL: '12',
      PAY_HOT_ADDRESS: '0x' + '33'.repeat(20),
    });
    expect(v.fatal).toBe(false);
    expect(v.chain).toBe('polygon');
    expect(v.decimals).toBe(6);
    expect(v.expectedChainId).toBe(80002);
    expect(v.gasSymbol).toBe('POL');
  });

  it('Polygon без `PAY_EVM_CHAINS` — fatal: адреса выдаём, а сканер смотрит BNB', () => {
    // Ровно та тишина, из-за которой теряют пополнения на второй сети: воркер по
    // умолчанию сканирует только BNB, и «прогон зелёный» ничего не проверяет.
    const v = checkChainEnv({
      PAY_CHAIN: 'polygon',
      PAY_NETWORK: 'testnet',
      PAY_EVM_CONTRACT_POL: CONTRACT,
      PAY_EVM_RPC_POL: 'https://amoy.example/rpc',
      PAY_HOT_ADDRESS: '0x' + '33'.repeat(20),
    });
    expect(v.fatal).toBe(true);
    expect(v.checks.some((c) => c.step === 'список сетей' && /PAY_EVM_CHAINS=bnb,polygon/.test(c.reason))).toBe(true);
  });

  it('Polygon, у которого контракт задан общей переменной — fatal, а не «подставили BNB»', () => {
    const v = checkChainEnv({
      PAY_CHAIN: 'polygon',
      PAY_NETWORK: 'testnet',
      PAY_EVM_CHAINS: 'polygon',
      PAY_EVM_CONTRACT: CONTRACT,
      PAY_EVM_RPC_POL: 'https://amoy.example/rpc',
      PAY_HOT_ADDRESS: '0x' + '33'.repeat(20),
    });
    expect(v.checks.some((c) => c.step === 'контракт' && /PAY_EVM_CONTRACT_POL/.test(c.reason))).toBe(true);
  });

  it('1 подтверждение на тестнете — не fatal, но и на проде мало', () => {
    const base = {
      PAY_CHAIN: 'bsc',
      PAY_EVM_CONTRACT: CONTRACT,
      PAY_EVM_RPC: 'https://example.com',
      PAY_HOT_ADDRESS: '0x' + '33'.repeat(20),
    };
    expect(checkChainEnv({ ...base, PAY_NETWORK: 'testnet', PAY_EVM_CONFIRMATIONS: '0' }).fatal).toBe(true);
    expect(checkChainEnv({ ...base, PAY_NETWORK: 'mainnet', PAY_EVM_CONFIRMATIONS: '3' }).fatal).toBe(true);
    expect(checkChainEnv({ ...base, PAY_NETWORK: 'mainnet', PAY_EVM_CONFIRMATIONS: '15' }).fatal).toBe(false);
  });
});

describe('прогон: зачисление', () => {
  it('шкала 18 знаков: 1 USDT = 1e18 raw', () => {
    expect(microToRaw(1_000_000, 18)).toBe(10n ** 18n);
    expect(microToRaw(5_000_000, 18)).toBe(5n * 10n ** 18n);
  });

  it('нет событий — skip с подсказкой, а не «ок»', () => {
    const v = depositVerdict({ expectedMicro: 5_000_000, creditedMicro: 0, events: 0 });
    expect(v.status).toBe('skip');
    expect(v.hint).toContain('--wait');
  });

  it('зачисленный цент не тот, что отправлен — fail', () => {
    const v = depositVerdict({ expectedMicro: 5_000_000, creditedMicro: 5_000_001, events: 1 });
    expect(v.status).toBe('fail');
    expect(v.reason).toContain('разница');
  });

  it('события есть, зачислено 0 — fail (orphan), а не skip', () => {
    expect(depositVerdict({ expectedMicro: 5_000_000, creditedMicro: 0, events: 2 }).status).toBe('fail');
  });

  it('ровно та сумма — ok', () => {
    const v = depositVerdict({ expectedMicro: 5_000_000, creditedMicro: 5_000_000, events: 1, cursor: 123 });
    expect(v.status).toBe('ok');
    expect(v.reason).toContain('5.0 USDT');
  });

  it('повторный проход не двигает баланс', () => {
    expect(idempotencyVerdict({ secondCredited: 0, balanceAfterSecond: 100, balanceAfterFirst: 100 }).status).toBe('ok');
    expect(idempotencyVerdict({ secondCredited: 1, balanceAfterSecond: 200, balanceAfterFirst: 100 }).status).toBe('fail');
  });
});

describe('прогон: подписанная транзакция', () => {
  const data = `0xa9059cbb${PLAYER.slice(2).padStart(64, '0')}${(10n ** 19n).toString(16).padStart(64, '0')}`;

  it('каллдейт разбирается: получатель и сумма', () => {
    const dec = parseTransferData(data)!;
    expect(dec.to).toBe(PLAYER);
    expect(dec.amountRaw).toBe(10n ** 19n);
  });

  it('не наш каллдейт — fail, а не тихий пропуск', () => {
    const v = payoutTxCheck({ got: { to: CONTRACT, chainId: 97, nonce: 1, gasLimit: 80000n, value: 0n, data: '0xdead' }, want: { contract: CONTRACT, chainId: 97, nonce: 1, recipient: PLAYER, amountMicro: 10_000_000 } });
    expect(v.status).toBe('fail');
    expect(v.checks.some((c) => c.step === 'каллдейт' && c.status === 'fail')).toBe(true);
  });

  it('получатель не тот — fail (это потеря денег)', () => {
    const v = payoutTxCheck({
      got: { to: CONTRACT, chainId: 97, nonce: 1, gasLimit: 80000n, value: 0n, data },
      want: { contract: CONTRACT, chainId: 97, nonce: 1, recipient: '0x' + '44'.repeat(20), amountMicro: 10_000_000 },
    });
    expect(v.status).toBe('fail');
    expect(v.checks.some((c) => c.step === 'получатель' && c.status === 'fail')).toBe(true);
  });

  it('всё сходится — ok, в том числе value = 0', () => {
    const v = payoutTxCheck({
      got: { to: CONTRACT, chainId: 97, nonce: 1, gasLimit: 80000n, value: 0n, data },
      want: { contract: CONTRACT, chainId: 97, nonce: 1, recipient: PLAYER, amountMicro: 10_000_000 },
    });
    expect(v.status).toBe('ok');
  });
});

describe('прогон: квитанция', () => {
  it('квитанции нет — skip: транзакция может лежать в мемпуле', () => {
    expect(receiptVerdict({ receipt: null, head: 10, confirmations: 3 }).status).toBe('skip');
  });

  it('реверт — fail', () => {
    expect(receiptVerdict({ receipt: { status: 0 }, head: 10, confirmations: 3 }).status).toBe('fail');
  });

  it('глубины мало — skip, cron догонит', () => {
    const v = receiptVerdict({ receipt: { status: 1, blockNumber: 9 }, head: 10, confirmations: 3 });
    expect(v.status).toBe('skip');
    expect(v.reason).toContain('2 из 3');
  });

  it('подтверждений достаточно — ok', () => {
    expect(receiptVerdict({ receipt: { status: 1, blockNumber: 5, logs: [{}] }, head: 10, confirmations: 3 }).status).toBe('ok');
  });
});

describe('прогон: учёт и границы подписанта', () => {
  it('остаток = зачислено − выплачено', () => {
    const v = ledgerVerdict({ beforeMicro: 0, depositedMicro: 5_000_000, paidOutMicro: 5_000_000, afterMicro: 0, ledgerOk: true });
    expect(v.status).toBe('ok');
  });

  it('расхождение на единицу — fail', () => {
    expect(ledgerVerdict({ beforeMicro: 0, depositedMicro: 5_000_000, paidOutMicro: 5_000_000, afterMicro: 1, ledgerOk: true }).status).toBe('fail');
  });

  it('разрыв цепочки хешей — fail даже при верном балансе', () => {
    const v = ledgerVerdict({ beforeMicro: 0, depositedMicro: 1, paidOutMicro: 0, afterMicro: 1, ledgerOk: false });
    expect(v.checks.some((c) => c.step === 'реестр' && c.status === 'fail')).toBe(true);
    expect(v.status).toBe('fail');
  });

  it('без SIGNER_PRIVATE_KEY шаг помечается skip, а не ok', () => {
    const v = signerGuardsCheck({ env: {}, contract: CONTRACT, chainId: 97, amountMicro: 1 });
    expect(v.checks[0].status).toBe('skip');
  });

  it('allowlist контракта расходится с PAY_EVM_CONTRACT — fail', () => {
    const v = signerGuardsCheck({ env: { SIGNER_PRIVATE_KEY: 'x', SIGNER_EVM_CONTRACT: '0x' + '99'.repeat(20) }, contract: CONTRACT, chainId: 97, amountMicro: 1 });
    expect(v.status).toBe('fail');
  });

  it('сумма выше SIGNER_MAX_TX_MICRO — fail', () => {
    const v = signerGuardsCheck({ env: { SIGNER_MAX_TX_MICRO: '100' }, contract: CONTRACT, chainId: 97, amountMicro: 101 });
    expect(v.checks.some((c) => c.step === 'потолок суммы' && c.status === 'fail')).toBe(true);
  });
});

describe('прогон: итог', () => {
  it('непроверенные шаги не дают «полностью зелёно»', () => {
    const s = summarize([{ step: 'a', status: 'ok' }, { step: 'b', status: 'skip' }]);
    expect(s.passed).toBe(true);
    expect(s.exitCode).toBe(2);
    expect(s.headline).toContain('не тронули');
  });

  it('любой fail — выход 1', () => {
    const s = summarize([{ step: 'адрес', status: 'fail' }, { step: 'a', status: 'ok' }]);
    expect(s.passed).toBe(false);
    expect(s.exitCode).toBe(1);
    expect(s.headline).toContain('адрес');
  });

  it('формат USDT режет хвостовые нули', () => {
    expect(formatUsdt(5_000_000n)).toBe('5.0');
    expect(formatUsdt(5_500_000n)).toBe('5.5');
    expect(formatUsdt(0)).toBe('0.0');
    expect(formatUsdt(1)).toBe('0.000001');
  });
});
