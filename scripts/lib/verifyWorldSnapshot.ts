import { seasonRewardFor } from '../../worker/src/world/modules/season';

// Проверка снимка мира, скачанного из R2 или D1. Снимок — это отчёт о состоянии
// мира на момент экспорта, поэтому проверяем не «красивость», а сходимость:
// число строк Ledger против головы цепочки, неотрицательные суммы и то, что
// призы в итогах сезона совпадают с таблицей наград в коде.

export interface SnapshotStanding {
  rank: number;
  playerId: string;
  points: number;
  level: number;
  xp: number;
  reward: number;
}

export interface WorldSnapshotFile {
  v?: number;
  kind?: string;
  created_at?: number;
  season?: { id: string; number: number; startsAt: number; endsAt: number; status: string; closedAt: number | null } | null;
  totals?: {
    players?: number; astra?: number; fuel?: number; points?: number;
    resources?: Record<string, number>; ships?: number; durability?: number; marketLots?: number;
  };
  ledger?: { rows?: number; headSeq?: number | null; headHash?: string | null; verifyOk?: boolean; brokenAtSeq?: number | null };
  standings?: SnapshotStanding[];
}

export interface SnapshotCheck {
  ok: boolean;
  problems: string[];
  kind: string;
  players: number;
  astra: number;
  points: number;
  ledgerRows: number;
  head: string;
  season: string;
  standings: number;
}

const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
const isNonNegative = (value: unknown): value is number => isInt(value) && value >= 0;

export function verifyWorldSnapshot(snapshot: WorldSnapshotFile): SnapshotCheck {
  const problems: string[] = [];
  const totals = snapshot.totals ?? {};
  const ledger = snapshot.ledger ?? {};

  if (snapshot.v !== 1) problems.push(`версия снимка ${String(snapshot.v)} неизвестна, ожидается 1`);
  if (snapshot.kind !== 'weekly' && snapshot.kind !== 'season_close') {
    problems.push(`неизвестный вид снимка: ${String(snapshot.kind)}`);
  }
  if (!isInt(snapshot.created_at) || snapshot.created_at <= 0) problems.push('created_at отсутствует или не число');

  if (!isNonNegative(totals.players)) problems.push('totals.players должен быть неотрицательным целым');
  if (!isNonNegative(totals.astra)) problems.push('totals.astra должен быть неотрицательным целым');
  if (!isNonNegative(totals.points)) problems.push('totals.points должен быть неотрицательным целым');
  if (!isNonNegative(totals.ships)) problems.push('totals.ships должен быть неотрицательным целым');
  if (!isNonNegative(totals.durability)) problems.push('totals.durability должен быть неотрицательным целым');
  for (const [name, amount] of Object.entries(totals.resources ?? {})) {
    if (!isNonNegative(amount)) problems.push(`ресурс ${name}: сумма не число или отрицательна`);
  }

  const rows = isNonNegative(ledger.rows) ? ledger.rows : 0;
  if (!isNonNegative(ledger.rows)) problems.push('ledger.rows должен быть неотрицательным целым');
  const headSeq = ledger.headSeq ?? null;
  const headHash = ledger.headHash ?? null;
  if ((headSeq === null) !== (headHash === null)) problems.push('голова цепочки заполнена наполовину: нужны и seq, и hash');
  if (headSeq !== null && !isNonNegative(headSeq)) problems.push('ledger.headSeq должен быть целым');
  if (headHash !== null && !/^[0-9a-f]{64}$/.test(String(headHash))) problems.push('ledger.headHash не похож на SHA-256');
  if (rows === 0 && headSeq !== null) problems.push('в Ledger нет строк, но голова цепочки указана');
  if (rows > 0 && headSeq === null) problems.push('в Ledger есть строки, но голова цепочки пуста');
  // seq — AUTOINCREMENT: после откатов транзакций номера идут с пропусками,
  // поэтому headSeq может быть больше числа строк. Меньше единицы — не может.
  if (isInt(headSeq) && headSeq < 1) problems.push('ledger.headSeq должен быть не меньше 1');
  if (typeof ledger.verifyOk !== 'boolean') problems.push('ledger.verifyOk должен быть true или false');

  if (snapshot.kind === 'season_close') {
    if (!Array.isArray(snapshot.standings)) {
      problems.push('у снимка закрытия сезона нет итоговой таблицы');
    } else {
      const standings = snapshot.standings;
      let expectedRank = 1;
      for (const row of standings) {
        if (row.rank !== expectedRank) problems.push(`нарушен порядок мест: ожидалось ${expectedRank}, получено ${row.rank}`);
        if (!isNonNegative(row.points)) problems.push(`место ${row.rank}: очки не число`);
        const reward = seasonRewardFor(row.rank, row.points);
        if (row.reward !== reward) problems.push(`место ${row.rank}: приз ${row.reward}, а по правилам ${reward}`);
        expectedRank += 1;
      }
      if (new Set(standings.map((s) => s.playerId)).size !== standings.length) {
        problems.push('в итогах сезона один игрок встречается дважды');
      }
      const standingsPoints = standings.reduce((sum, s) => sum + (Number.isFinite(s.points) ? s.points : 0), 0);
      if (isNonNegative(totals.points) && standingsPoints !== totals.points) {
        problems.push(`сумма очков в итогах (${standingsPoints}) не совпадает с totals.points (${totals.points})`);
      }
    }
    if (!snapshot.season) problems.push('у снимка закрытия сезона нет данных сезона');
  }

  const standings = snapshot.standings ?? [];
  return {
    ok: problems.length === 0,
    problems,
    kind: String(snapshot.kind ?? '—'),
    players: Number(totals.players ?? 0),
    astra: Number(totals.astra ?? 0),
    points: Number(totals.points ?? 0),
    ledgerRows: Number(rows ?? 0),
    head: headSeq === null ? 'пусто' : `#${headSeq} ${String(headHash).slice(0, 12)}…`,
    season: snapshot.season ? `#${snapshot.season.number} (${snapshot.season.status})` : '—',
    standings: standings.length,
  };
}
