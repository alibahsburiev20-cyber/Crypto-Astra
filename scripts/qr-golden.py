#!/usr/bin/env python3
# Генератор эталонных матриц QR для `worker/test/fixtures/payQr.json`.
#
# Нужен только при изменении кодировщика `worker/src/pay/qr.ts`:
#   pip install segno && python3 scripts/qr-golden.py
#
# Почему эталон внешний: сверять свой QR-код с самим собой бессмысленно —
# ошибка в таблице блоков, в чередовании или в раскладке информации о формате
# даёт «правдоподобную» картинку, которую сканер просто не прочитает. `segno` —
# независимая реализация со своим набором тестов, она и решает, каким должен быть
# ответ.
#
# Матрицы упакованы поточно: каждый ряд — это биты, уложенные в байты, и всё
# это в base64. Иначе JSON теста раздулся бы вчетверо ради 33×33 нулей и единиц.

import base64
import json
import pathlib

import segno

# Те же строки, что реально кодирует витрина: адрес TRON (34), адрес EVM (42),
# и короткие случаи (проверка выбора версии, а не только «влезло»).
PAYLOADS = [
    'TMVQGm1qAQYVdetCeGRRkTWYYrLXuHK2HC',
    '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf',
    'HELLO',
    'A' * 62,
]

CASES = []
for text in PAYLOADS:
    # `boost_error=False` обязателен: по умолчанию segno повышает уровень
    # коррекции, если он влезает в ту же версию, а наш кодировщик держит M.
    # Версию подсказывает первый проход с маскированием по умолчанию.
    # `micro=False`: иначе segno для коротких строк выбирает Micro QR, а наш
    # кодировщик работает с обычными символами (у витрины нет задачи экономить
    # версию любой ценой).
    # `mode='byte'`: витрина кодирует адрес как есть, байтовым режимом. Без этого
    # segno для 'HELLO'/'AAAA' выбрал бы alphanumeric и дал бы другую матрицу —
    # обе корректны, но сверять надо с тем же режимом.
    auto = segno.make(text, error='m', mode='byte', boost_error=False, micro=False)
    # `QRCode.version` у segno — обозначение («M1», «2»…), а нам нужен номер:
    # он однозначно восстанавливается из стороны матрицы (size = 4v + 17).
    version = (len(auto.matrix) - 17) // 4
    for mask in range(8):
        qr = segno.make(text, error='m', version=version, mask=mask, mode='byte', boost_error=False, micro=False)
        matrix = [[1 if bit else 0 for bit in row] for row in qr.matrix]
        rows = []
        for row in matrix:
            packed = bytearray()
            for start in range(0, len(row), 8):
                chunk = row[start:start + 8]
                byte = 0
                for bit in chunk:
                    byte = (byte << 1) | bit
                # Хвостовой ряд неполный (29 mod 8 = 5) — биты держим левее,
                # иначе чтение «по 8 бит» съест сдвиг и последние символы строки
                # окажутся не там (на этом тест чуть не прошла молча).
                byte <<= 8 - len(chunk)
                packed.append(byte)
            rows.append(base64.b64encode(bytes(packed)).decode('ascii'))
        CASES.append({
            'text': text,
            'mask': mask,
            'version': qr.version,
            'size': len(rows),
            'rows': rows,
        })

out = pathlib.Path(__file__).resolve().parents[1] / 'worker' / 'test' / 'fixtures' / 'payQr.json'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps({
    'note': 'Сгенерировано scripts/qr-golden.py (segno ' + segno.__version__ + '). Не править руками.',
    'cases': CASES,
}, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
print(f'{out}: {len(CASES)} случаев')
