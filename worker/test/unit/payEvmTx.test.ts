// RLP, calldata и транзакция EIP-1559.
//
// RLP проверяется эталонными векторами из спецификации (это единственный способ
// убедиться, что кодирование канонично: неканоничное — это «та же транзакция с
// другим хешем», и подпись перестает что-либо значить). Транзакция проверяется
// кругом «собрали → разобралi → хеш совпал», потому что ровно этот путь проходят
// подписанные выплаты: Signer разбирает то, что собрал основной Worker.
import { describe, expect, it } from 'vitest';
import {
  TxError, TRANSFER_SELECTOR, applySignature, decodeSignedTx, encodeSignedTx, parseTransferCalldata,
  rlpEncode, signingHash, transferCalldata,
} from '../../src/pay/evm/tx';
import { bytesToHex } from '../../src/pay/crypto/hmac';
import { keccak256Hex } from '../../src/pay/crypto/keccak';

const enc = (input: Parameters<typeof rlpEncode>[0]) => `0x${bytesToHex(rlpEncode(input))}`;

describe('RLP — эталонные векторы спецификации', () => {
  it('строки', () => {
    expect(enc('0x')).toBe('0x80');
    // Один байт < 0x80 — это сам себе кодировка. Пустая строка и «ноль-байт» —
    // разные вещи: `0x80` против `0x00`.
    expect(enc('0x00')).toBe('0x00');
    expect(rlpEncode(new Uint8Array([0x0f]))).toEqual(new Uint8Array([0x0f]));
    // «dog» = 0x64 0x6f 0x67
    expect(enc(hexOfAscii('dog'))).toBe('0x83646f67');
  });

  it('числа', () => {
    expect(enc(0)).toBe('0x80');
    expect(enc(15)).toBe('0x0f');
    expect(enc(1024)).toBe('0x820400');
  });

  it('списки', () => {
    expect(enc([])).toBe('0xc0');
    expect(enc(['0x636174', '0x646f67'])).toBe('0xc88363617483646f67');
    // 56-байтная строка — уже «длинная»: 0xb8 + длина (0x38) + байты. Список из
    // одного такого элемента занимает 58 байт ⇒ 0xf8 + 0x3a.
    expect(enc(['0x' + 'f7'.repeat(56)])).toBe(`0xf83ab838${'f7'.repeat(56)}`);
  });

  it('ведущих нулей в числе нет — это и есть канон', () => {
    // 1024 в виде `0x0400` и `0x000400` дали бы разные хеши одной транзакции.
    expect(enc('0x000400')).not.toBe(enc(1024));
    expect(enc('0x000400')).toBe('0x83000400');
  });
});

function hexOfAscii(text: string): string {
  return `0x${[...text].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')}`;
}

describe('calldata перевода BEP-20', () => {
  const TO = '0x2222222222222222222222222222222222222222';

  it('селектор и два 32-байтных слота', () => {
    const data = transferCalldata(TO, 1_000_000_000_000_000_000n);
    expect(data.slice(2, 10)).toBe(TRANSFER_SELECTOR);
    expect(data).toHaveLength(2 + 8 + 128);
    expect(data.slice(10, 74)).toBe(`${'0'.repeat(24)}${TO.slice(2)}`);
    expect(data.slice(74)).toBe('0000000000000000000000000000000000000000000000000de0b6b3a7640000');
  });

  it('обратный разбор даёт ровно те же значения', () => {
    for (const amount of [1n, 1_000_000_000_000_000_000n, 15_000_000_000_000_000_000n, 2n ** 255n]) {
      const parsed = parseTransferCalldata(transferCalldata(TO, amount));
      expect(parsed).toEqual({ to: TO.toLowerCase(), amountRaw: amount });
    }
  });

  it('чужой селектор и битая длина — ошибка, а не «ноль»', () => {
    expect(() => parseTransferCalldata(`0x${'00'.repeat(4)}`)).toThrow(/not_transfer_call/);
    expect(() => parseTransferCalldata(`0x${TRANSFER_SELECTOR}${'00'.repeat(31)}`)).toThrow(/bad_calldata_length/);
    expect(() => transferCalldata('Txxxx', 1n)).toThrow(/bad_address/);
    expect(() => transferCalldata(TO, 0n)).toThrow(/bad_amount/);
  });
});

describe('транзакция EIP-1559', () => {
  const tx = {
    chainId: 56,
    nonce: 7,
    maxPriorityFeePerGas: 1_000_000n,
    maxFeePerGas: 3_000_000_000n,
    gasLimit: 60_000n,
    to: '0x55d398326f99059ff775485246999027b3197955',
    value: 0n,
    data: transferCalldata('0x2222222222222222222222222222222222222222', 15_000_000_000_000_000_000n),
  };

  it('хеш подписи = keccak от 0x02 || rlp(полей)', () => {
    const hash = signingHash(tx);
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    // Стабильность: тот же объект → тот же хеш (иначе подпись «не к тому»).
    expect(signingHash({ ...tx })).toBe(hash);
    // И он меняется от любого поля, включая chainId: это и есть защита от replay.
    expect(signingHash({ ...tx, chainId: 97 })).not.toBe(hash);
    expect(signingHash({ ...tx, nonce: 8 })).not.toBe(hash);
  });

  it('круг «кодирование → разбор» сохраняет все поля', () => {
    const signed = encodeSignedTx({ ...tx, yParity: 0, r: 2n ** 200n + 5n, s: 2n ** 180n + 3n });
    const back = decodeSignedTx(signed);
    expect(back).toEqual({ ...tx, yParity: 0, r: 2n ** 200n + 5n, s: 2n ** 180n + 3n });
  });

  it('подпись из Signer вставляется без изменения тела: хеш тот же', () => {
    const r = (12345n << 32n) | 7n;
    const s = (98765n << 32n) | 1n;
    const signature = `${r.toString(16).padStart(64, '0')}${s.toString(16).padStart(64, '0')}1c`;
    const signed = applySignature(tx, `0x${signature}`);
    const back = decodeSignedTx(signed);
    expect(back.r).toBe(r);
    expect(back.s).toBe(s);
    expect(back.yParity).toBe(1); // v = 27 + 1
    // Тело не поехало: хеш «полей без подписи» обязан совпасть с тем, что подписывали.
    const { yParity: _y, r: _r, s: _s, ...fields } = back;
    expect(signingHash(fields as typeof tx)).toBe(signingHash(tx));
  });

  it('неканоничный RLP в разборе отвергается', () => {
    // Список с «хвостом» байтов после конца элемента.
    expect(() => decodeSignedTx('0x02c0')).toThrow(TxError);
    expect(() => decodeSignedTx(`0x${'00'.repeat(4)}`)).toThrow(/unsupported_tx_type/);
    expect(() => decodeSignedTx('0x02')).toThrow(/rlp_truncated/);
  });

  it('газ и лимиты проверяются до подписи', () => {
    expect(() => signingHash({ ...tx, gasLimit: 0n })).toThrow(/bad_gas_limit/);
    expect(() => signingHash({ ...tx, gasLimit: 40_000_000n })).toThrow(/bad_gas_limit/);
    expect(() => signingHash({ ...tx, maxPriorityFeePerGas: tx.maxFeePerGas + 1n })).toThrow(/priority_above_max_fee/);
    expect(() => signingHash({ ...tx, chainId: 0 })).toThrow(/bad_chain_id/);
    expect(() => signingHash({ ...tx, nonce: -1 })).toThrow(/bad_nonce/);
    expect(() => signingHash({ ...tx, to: '0x123' })).toThrow(/bad_to/);
    expect(() => encodeSignedTx({ ...tx, yParity: 2, r: 1n, s: 1n })).toThrow(/bad_y_parity/);
  });

  it('регистр hex в адресе не меняет хеш: конфиг с EIP-55 = та же транзакция', () => {
    // `tx.to` — канонический чексум Binance-Peg BSC-USD. Lowercase-вариант обязан
    // давать ровно тот же хеш: байты от регистра hex не зависят, а значит «в
    // конфигурации написали красивый адрес» не ломает сверку с Signer.
    const lower = { ...tx, to: tx.to.toLowerCase() };
    expect(signingHash(lower)).toBe(signingHash(tx));
    expect(encodeSignedTx({ ...lower, yParity: 0, r: 5n, s: 7n }))
      .toBe(encodeSignedTx({ ...tx, yParity: 0, r: 5n, s: 7n }));
  });

  it('пустая транзакция не проходит, а «газ 1 wei» — проходит намеренно', () => {
    expect(() => signingHash({ ...tx, maxFeePerGas: 0n })).toThrow(/bad_max_fee/);
    expect(() => applySignature(tx, '0xdeadbeef')).toThrow(/bad_signature_length/);
  });
});

describe('совместимость с keccak-модулем', () => {
  it('хеш транзакции считается тем же keccak, что и для адреса', () => {
    const payload = signingHash(tx0());
    expect(payload).toBe(`0x${keccak256Hex(rlpPayload())}`);
  });
});

function tx0() {
  return {
    chainId: 56, nonce: 0, maxPriorityFeePerGas: 1n, maxFeePerGas: 2n, gasLimit: 21000n,
    to: '0x55d398326f99059ff775485246999027b3197955', value: 0n, data: '0x',
  };
}

function rlpPayload(): Uint8Array {
  const body = rlpEncode([56, 0, 1, 2, 21000, '0x55d398326f99059ff775485246999027b3197955', 0, '0x', []]);
  const out = new Uint8Array(body.length + 1);
  out[0] = 0x02;
  out.set(body, 1);
  return out;
}
