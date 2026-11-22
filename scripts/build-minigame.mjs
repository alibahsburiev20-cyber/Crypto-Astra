// Сборка общего модуля мини-игры в браузерный файл.
//
// Расчёт поля и проверка трассы живут в одном месте — worker/src/shared/minigame.ts.
// Браузеру нужен тот же код (иначе он нарисует одно, а сервер посчитает другое),
// поэтому транспилируем TS в обычный ES-модуль. Тест minigameClient.test.ts
// сверяет файл со свежей сборкой: забыть пересобрать нельзя.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const sourceUrl = new URL('../worker/src/shared/minigame.ts', import.meta.url);
const targetUrl = new URL('../client/minigame-sim.js', import.meta.url);

const BANNER = '// Сгенерировано scripts/build-minigame.mjs из worker/src/shared/minigame.ts.\n'
  + '// Руками не править: сервер и браузер должны считать одинаково.\n';

export function renderMinigameClient() {
  const source = readFileSync(sourceUrl, 'utf8');
  const out = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      removeComments: true,
      newLine: ts.NewLineKind.LineFeed,
    },
    fileName: 'minigame.ts',
  });
  return `${BANNER}${out.outputText}`;
}

const isMain = process.argv[1] && pathToFileURL(fileURLToPath(pathToFileURL(process.argv[1]))).href === import.meta.url;
if (isMain) {
  writeFileSync(targetUrl, renderMinigameClient());
  console.log('client/minigame-sim.js обновлён');
}
