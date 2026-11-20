import { describe, expect, it } from 'vitest';
import {
  addressFromPublicKeyHash, addressToHex, base58Decode, base58Encode, hexToBase58,
  isValidAddress, normalizeAddress, TronAddressError,
} from '../../src/pay/tron/address';
import {
  AmountError, formatMicroUsdt, microFromChainValue, parseUsdtToMicro,
} from '../../src/pay/tron/amount';
import {
  TRANSFER_TOPIC, parseAccountTransfer, parseContractLog, isIncomingTransfer, TransferError,
} from '../../src/pay/tron/transfer';

// Векторы взяты из настоящей сети: контракт USDT в mainnet.
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const USDT_HEX = '41a614f803b6fd780986a42c78ec9c7f77e6ded13c';
const ALICE = hexToBase58('41' + '11'.repeat(20));
const BOB = hexToBase58('41' + '22'.repeat(20));

describe('base58 и адреса TRON', () => {
  it('контракт USDT кодируется в свой настоящий адрес', () => {
    expect(hexToBase58(USDT_HEX)).toBe(USDT_CONTRACT);
    expect(addressToHex(USDT_CONTRACT)).toBe(USDT_HEX);
  });

  it('20 байт без префикса тоже принимаются', () => {
    expect(hexToBase58(USDT_HEX.slice(2))).toBe(USDT_CONTRACT);
  });

  it('base58 туда-обратно сохраняет байты, включая ведущие нули', () => {
    for (const hex of ['00', '0001', 'ff', '00deadbeef00', '41' + 'ab'.repeat(20)]) {
      const bytes = new Uint8Array(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
      const text = base58Encode(bytes);
      expect(Buffer.from(base58Decode(text))).toEqual(Buffer.from(bytes));
    }
  });

  it('испорченная контрольная сумма отвергается', () => {
    const broken = `${USDT_CONTRACT.slice(0, -1)}x`;
    expect(() => addressToHex(broken)).toThrow(TronAddressError);
    expect(isValidAddress(broken)).toBe(false);
    expect(isValidAddress(USDT_CONTRACT)).toBe(true);
  });

  it('чужой префикс, длина и символы отвергаются', () => {
    expect(() => addressToHex('0'.repeat(34))).toThrow(/bad_address/);
    expect(() => addressToHex(`${USDT_CONTRACT}1`)).toThrow(/bad_address/);
    expect(() => hexToBase58('42' + '11'.repeat(20))).toThrow(/bad_prefix/);
    expect(() => hexToBase58('41zz')).toThrow(/hex_charset/);
    // Символ, которого нет в алфавите base58 (0, O, I, l).
    const withZero = `${USDT_CONTRACT.slice(0, 10)}0${USDT_CONTRACT.slice(11)}`;
    expect(() => addressToHex(withZero)).toThrow(/base58_charset/);
  });

  it('normalizeAddress возвращает канонический вид', () => {
    expect(normalizeAddress(USDT_CONTRACT)).toBe(USDT_CONTRACT);
    expect(normalizeAddress(USDT_HEX)).toBe(USDT_CONTRACT);
  });

  it('адрес собирается из 20 байт открытого ключа', () => {
    expect(addressFromPublicKeyHash('11'.repeat(20))).toBe(ALICE);
  });
});

describe('суммы USDT', () => {
  it('1 USDT = 1 000 000 микро', () => {
    expect(parseUsdtToMicro('1')).toBe(1_000_000);
    expect(parseUsdtToMicro('1.5')).toBe(1_500_000);
    expect(parseUsdtToMicro('0.000001')).toBe(1);
    expect(parseUsdtToMicro('123.456789')).toBe(123_456_789);
  });

  it('лишние знаки, минус, экспонента и пробелы внутри отвергаются', () => {
    for (const bad of ['1.1234567', '-1', '1e6', '1 000', '', ' ', '0', '.5', '1.']) {
      expect(() => parseUsdtToMicro(bad)).toThrow(AmountError);
    }
  });

  it('форматирование не теряет и не добавляет микро', () => {
    expect(formatMicroUsdt(1_500_000)).toBe('1.50');
    expect(formatMicroUsdt(1)).toBe('0.000001');
    expect(formatMicroUsdt(1_000_000)).toBe('1.00');
    expect(formatMicroUsdt(0)).toBe('0.00');
    expect(formatMicroUsdt(-2_500_000)).toBe('-2.50');
    expect(() => formatMicroUsdt(1.5)).toThrow(/not_integer/);
  });

  it('значение из сети принимается только целым и положительным', () => {
    expect(microFromChainValue('1000000')).toBe(1_000_000);
    expect(microFromChainValue(1000000)).toBe(1_000_000);
    for (const bad of ['0', '-1', '1.5', '', 'abc', '99999999999999999999']) {
      expect(() => microFromChainValue(bad)).toThrow(AmountError);
    }
  });
});

const opts = { contracts: [USDT_CONTRACT] };

function accountRow(patch: Record<string, unknown> = {}) {
  return {
    transaction_id: 'a'.repeat(64),
    token_info: { symbol: 'USDT', address: USDT_CONTRACT, decimals: 6, name: 'Tether USD' },
    block_timestamp: 1_700_000_000_000,
    from: ALICE,
    to: BOB,
    type: 'Transfer',
    value: '2500000',
    ...patch,
  };
}

describe('разбор перевода TRC-20', () => {
  it('нормальный перевод разбирается полностью', () => {
    const t = parseAccountTransfer(accountRow(), opts);
    expect(t).toMatchObject({
      txid: 'a'.repeat(64), eventIndex: 0, from: ALICE, to: BOB,
      contract: USDT_CONTRACT, amountMicro: 2_500_000, success: true,
    });
    expect(t.blockTime).toBe(1_700_000_000_000);
    expect(t.raw).toContain('transaction_id');
  });

  it('чужой контракт — не деньги', () => {
    const row = accountRow({ token_info: { address: 'TXYZ', decimals: 6 } });
    expect(() => parseAccountTransfer(row, opts)).toThrow(/wrong_contract/);
    // Пустой allowlist не пропускает ничего.
    expect(() => parseAccountTransfer(accountRow(), { contracts: [] })).toThrow(/wrong_contract/);
  });

  it('неверные десятичные знаки отвергаются: иначе сумма изменится в миллион раз', () => {
    const row = accountRow({ token_info: { address: USDT_CONTRACT, decimals: 18 } });
    expect(() => parseAccountTransfer(row, opts)).toThrow(/wrong_decimals/);
  });

  it('неуспешная транзакция не считается платежом', () => {
    expect(() => parseAccountTransfer(accountRow({ contractRet: 'REVERT' }), opts)).toThrow(/not_success/);
    expect(parseAccountTransfer(accountRow({ contractRet: 'SUCCESS' }), opts).success).toBe(true);
  });

  it('ноль, мусор и отсутствие txid отвергаются', () => {
    expect(() => parseAccountTransfer(accountRow({ value: '0' }), opts)).toThrow(/bad_amount/);
    expect(() => parseAccountTransfer(accountRow({ value: 'много' }), opts)).toThrow(/bad_amount/);
    expect(() => parseAccountTransfer(accountRow({ transaction_id: '' }), opts)).toThrow(/bad_txid/);
    expect(() => parseAccountTransfer(accountRow({ block_timestamp: 0 }), opts)).toThrow(/bad_block_time/);
  });

  it('адрес с испорченной суммой не проходит', () => {
    const broken = `${BOB.slice(0, -1)}y`;
    expect(() => parseAccountTransfer(accountRow({ to: broken }), opts)).toThrow(/bad_to/);
  });

  it('индекс события из ответа сохраняется, если он есть', () => {
    expect(parseAccountTransfer(accountRow({ event_index: 3 }), opts).eventIndex).toBe(3);
  });

  it('наш только тот перевод, что пришёл на наш адрес', () => {
    const t = parseAccountTransfer(accountRow(), opts);
    expect(isIncomingTransfer(t, [BOB])).toBe(true);
    expect(isIncomingTransfer(t, [ALICE])).toBe(false);
  });
});

describe('лог контракта из полного узла', () => {
  const tx = { txid: 'b'.repeat(64), blockNumber: 60_000_000, blockTime: 1_700_000_000_000, ret: 'SUCCESS' };

  function log(amountHex = '1e8480', patch: Record<string, unknown> = {}) {
    return {
      address: USDT_HEX,
      topics: [
        TRANSFER_TOPIC,
        `000000000000000000000000${addressToHex(ALICE).slice(2)}`,
        `000000000000000000000000${addressToHex(BOB).slice(2)}`,
      ],
      data: amountHex,
      event_index: 2,
      ...patch,
    };
  }

  it('адреса и сумма восстанавливаются из topics и data', () => {
    const t = parseContractLog(log(), tx, opts);
    expect(t).toMatchObject({
      txid: 'b'.repeat(64), eventIndex: 2, from: ALICE, to: BOB,
      contract: USDT_CONTRACT, amountMicro: 2_000_000, blockHeight: 60_000_000,
    });
  });

  it('без темы перевода или с чужой темой — не перевод', () => {
    expect(() => parseContractLog(log('1', { topics: [TRANSFER_TOPIC] }), tx, opts)).toThrow(/bad_topics/);
    const wrongTopic = log('1', {
      topics: ['ab'.repeat(32), `0x${'00'.repeat(31)}11`, `0x${'00'.repeat(31)}22`],
    });
    expect(() => parseContractLog(wrongTopic, tx, opts)).toThrow(/not_transfer/);
  });

  it('чужой контракт отвергается, свой в allowlist проходит', () => {
    const other = hexToBase58('41' + '33'.repeat(20));
    const otherHex = addressToHex(other);
    expect(() => parseContractLog(log('1', { address: otherHex }), tx, opts)).toThrow(/wrong_contract/);
    expect(parseContractLog(log('1', { address: otherHex }), tx, { contracts: [other] }).contract).toBe(other);
  });

  it('неуспешная транзакция не даёт перевода', () => {
    expect(() => parseContractLog(log(), { ...tx, ret: 'OUT_OF_ENERGY' }, opts)).toThrow(/not_success/);
  });
});
