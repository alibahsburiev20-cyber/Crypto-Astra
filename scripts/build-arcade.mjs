// Сборка общего модуля аркады в браузерный файл.
//
// Правила десяти мини-игр живут в одном месте — worker/src/shared/arcade.ts.
// Браузер обязан считать ровно так же, иначе клиент нарисует одно, а сервер
// засчитает другое, поэтому транспилируем TS в обычный ES-модуль. Тест
// arcadeClient.test.ts сверяет файл со свежей сборкой: забыть пересобрать нельзя.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const sourceUrl = new URL('../worker/src/shared/arcade.ts', import.meta.url);
const targetUrl = new URL('../client/arcade-sim.js', import.meta.url);

const BANNER = '// Сгенерировано scripts/build-arcade.mjs из worker/src/shared/arcade.ts.\n'
  + '// Руками не править: сервер и браузер должны считать одинаково.\n';

export function renderArcadeClient() {
  const source = readFileSync(sourceUrl, 'utf8');
  const out = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      removeComments: true,
      newLine: ts.NewLineKind.LineFeed,
    },
    fileName: 'arcade.ts',
  });
  return `${BANNER}${out.outputText}`;
}

const isMain = process.argv[1] && pathToFileURL(fileURLToPath(pathToFileURL(process.argv[1]))).href === import.meta.url;
if (isMain) {
  writeFileSync(targetUrl, renderArcadeClient());
  console.log('client/arcade-sim.js обновлён');
}
