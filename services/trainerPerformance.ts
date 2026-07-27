import type { TrainerSession } from "@/types";
import { getKoreaToday, addDaysToDateKey } from "@/lib/utils";

// 트레이너 실적은 "원본 저장 + 조회 시 계산" 구조다.
// trainerSessions(branchId + date + trainerId 문서 1개)만 원본으로 저장하고,
// 누적·순위·매출 합계는 어디에도 저장하지 않고 이 파일의 함수로 매번 계산한다.
// → 같은 날 같은 트레이너가 여러 지점에서 근무해도 지점별로 문서가 따로 생기고,
//    합계는 조회 시 합산되므로 이중 누적이 발생하지 않는다.

// ── 필드 접근자 ────────────────────────────────────────────────────────────────
// 기존 문서에는 매출 필드가 없다 → 항상 0으로 취급한다 (마이그레이션 없음).

export const ptOf = (r: TrainerSession) => r.ptSessionCount ?? 0;
export const otOf = (r: TrainerSession) => r.otSessionCount ?? 0;
export const groupOf = (r: TrainerSession) => r.groupSessionCount ?? 0;
export const otherOf = (r: TrainerSession) => r.otherSessionCount ?? 0;
export const totalSessionOf = (r: TrainerSession) => r.totalSessionCount ?? 0;

export const walkInRegOf = (r: TrainerSession) => r.walkInRegistrationCount ?? 0;
export const walkInSalesOf = (r: TrainerSession) => r.walkInSalesAmount ?? 0;
export const personalRegOf = (r: TrainerSession) => r.personalRegistrationCount ?? 0;
export const personalSalesOf = (r: TrainerSession) => r.personalSalesAmount ?? 0;

// 총계 필드가 없는 기존 문서는 구성 요소로 되계산한다.
export const totalRegOf = (r: TrainerSession) =>
  r.totalRegistrationCount ?? walkInRegOf(r) + personalRegOf(r);
export const totalSalesOf = (r: TrainerSession) =>
  r.totalSalesAmount ?? walkInSalesOf(r) + personalSalesOf(r);

// ── 기간 프리셋 ────────────────────────────────────────────────────────────────

export type PeriodPreset = "today" | "thisWeek" | "thisMonth" | "lastMonth" | "custom";

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  today: "오늘",
  thisWeek: "이번주",
  thisMonth: "이번달",
  lastMonth: "지난달",
  custom: "직접선택",
};

// 이번주 = 월요일 시작 (KST 기준 문자열 계산만 사용, UTC 변환으로 날짜가 밀지 않는다)
function startOfKoreaWeek(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=일 … 6=토
  const backToMonday = dow === 0 ? 6 : dow - 1;
  return addDaysToDateKey(dateKey, -backToMonday);
}

function monthBounds(yearMonth: string): { from: string; to: string } {
  const [y, m] = yearMonth.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${yearMonth}-01`, to: `${yearMonth}-${String(lastDay).padStart(2, "0")}` };
}

export function resolvePeriod(
  preset: PeriodPreset,
  customFrom?: string,
  customTo?: string
): { from: string; to: string } {
  const today = getKoreaToday();
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "thisWeek":
      return { from: startOfKoreaWeek(today), to: today };
    case "thisMonth":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "lastMonth": {
      const firstOfThisMonth = `${today.slice(0, 7)}-01`;
      const lastMonthKey = addDaysToDateKey(firstOfThisMonth, -1).slice(0, 7);
      return monthBounds(lastMonthKey);
    }
    case "custom": {
      const f = customFrom ?? today;
      const t = customTo ?? today;
      return f <= t ? { from: f, to: t } : { from: t, to: f };
    }
  }
}

// ── 집계 ───────────────────────────────────────────────────────────────────────

export interface PerformanceTotals {
  pt: number;
  ot: number;
  group: number;
  other: number;
  totalSessions: number;
  walkInReg: number;
  walkInSales: number;
  personalReg: number;
  personalSales: number;
  totalReg: number;
  totalSales: number;
}

export const EMPTY_TOTALS: PerformanceTotals = {
  pt: 0, ot: 0, group: 0, other: 0, totalSessions: 0,
  walkInReg: 0, walkInSales: 0, personalReg: 0, personalSales: 0,
  totalReg: 0, totalSales: 0,
};

export function sumSessions(sessions: TrainerSession[]): PerformanceTotals {
  return sessions.reduce<PerformanceTotals>(
    (a, r) => ({
      pt: a.pt + ptOf(r),
      ot: a.ot + otOf(r),
      group: a.group + groupOf(r),
      other: a.other + otherOf(r),
      totalSessions: a.totalSessions + totalSessionOf(r),
      walkInReg: a.walkInReg + walkInRegOf(r),
      walkInSales: a.walkInSales + walkInSalesOf(r),
      personalReg: a.personalReg + personalRegOf(r),
      personalSales: a.personalSales + personalSalesOf(r),
      totalReg: a.totalReg + totalRegOf(r),
      totalSales: a.totalSales + totalSalesOf(r),
    }),
    { ...EMPTY_TOTALS }
  );
}

export interface TrainerPerformanceRow extends PerformanceTotals {
  trainerId: string;
  trainerName: string;
  branchIds: string[];   // 기간 내 실제 활동한 지점 (trainerSessions에서 계산 — Master에 저장하지 않음)
  branchCount: number;
  dayCount: number;
  avgSessionsPerDay: number | null;
}

export function aggregateByTrainer(
  sessions: TrainerSession[],
  nameOf: (r: TrainerSession) => string
): TrainerPerformanceRow[] {
  const map = new Map<
    string,
    Omit<TrainerPerformanceRow, "branchCount" | "avgSessionsPerDay" | "dayCount"> & {
      days: Set<string>;
      branches: Set<string>;
    }
  >();

  for (const r of sessions) {
    let agg = map.get(r.trainerId);
    if (!agg) {
      agg = {
        trainerId: r.trainerId,
        trainerName: nameOf(r),
        branchIds: [],
        days: new Set<string>(),
        branches: new Set<string>(),
        ...EMPTY_TOTALS,
      };
      map.set(r.trainerId, agg);
    }
    agg.pt += ptOf(r);
    agg.ot += otOf(r);
    agg.group += groupOf(r);
    agg.other += otherOf(r);
    agg.totalSessions += totalSessionOf(r);
    agg.walkInReg += walkInRegOf(r);
    agg.walkInSales += walkInSalesOf(r);
    agg.personalReg += personalRegOf(r);
    agg.personalSales += personalSalesOf(r);
    agg.totalReg += totalRegOf(r);
    agg.totalSales += totalSalesOf(r);
    agg.days.add(r.date);
    agg.branches.add(r.branchId);
  }

  return Array.from(map.values()).map(({ days, branches, ...rest }) => ({
    ...rest,
    branchIds: Array.from(branches),
    branchCount: branches.size,
    dayCount: days.size,
    avgSessionsPerDay: days.size === 0 ? null : rest.totalSessions / days.size,
  }));
}

export interface BranchPerformanceRow extends PerformanceTotals {
  branchId: string;
  trainerCount: number;
}

export function aggregateByBranch(sessions: TrainerSession[]): BranchPerformanceRow[] {
  const map = new Map<string, BranchPerformanceRow & { trainerIds: Set<string> }>();
  for (const r of sessions) {
    let agg = map.get(r.branchId);
    if (!agg) {
      agg = {
        branchId: r.branchId,
        trainerCount: 0,
        trainerIds: new Set<string>(),
        ...EMPTY_TOTALS,
      };
      map.set(r.branchId, agg);
    }
    agg.pt += ptOf(r);
    agg.ot += otOf(r);
    agg.group += groupOf(r);
    agg.other += otherOf(r);
    agg.totalSessions += totalSessionOf(r);
    agg.walkInReg += walkInRegOf(r);
    agg.walkInSales += walkInSalesOf(r);
    agg.personalReg += personalRegOf(r);
    agg.personalSales += personalSalesOf(r);
    agg.totalReg += totalRegOf(r);
    agg.totalSales += totalSalesOf(r);
    agg.trainerIds.add(r.trainerId);
  }
  return Array.from(map.values())
    .map(({ trainerIds, ...rest }) => ({ ...rest, trainerCount: trainerIds.size }))
    .sort((a, b) => b.totalSessions - a.totalSessions);
}

// ── 순위 ───────────────────────────────────────────────────────────────────────

export type RankMetric = "totalSessions" | "totalSales" | "walkInSales" | "personalSales";

export const RANK_TABS: { key: RankMetric; label: string }[] = [
  { key: "totalSessions", label: "세션순위" },
  { key: "totalSales", label: "총매출순위" },
  { key: "walkInSales", label: "워크인매출순위" },
  { key: "personalSales", label: "개인매출순위" },
];

export interface RankedRow<T> {
  rank: number;
  row: T;
}

/**
 * 공동순위(competition ranking) — 동점이면 같은 순위를 주고 다음 순위를 건너뛴다.
 * 예) 값이 [10, 8, 8, 5] 이면 순위는 1, 2, 2, 4.
 * 동점 그룹 안에서는 이름 오름차순으로 안정 정렬한다.
 */
export function rankWithTies<T extends { trainerName: string }>(
  rows: T[],
  valueOf: (row: T) => number
): RankedRow<T>[] {
  const sorted = [...rows].sort((a, b) => {
    const diff = valueOf(b) - valueOf(a);
    if (diff !== 0) return diff;
    return a.trainerName.localeCompare(b.trainerName, "ko");
  });

  const result: RankedRow<T>[] = [];
  let lastValue: number | null = null;
  let lastRank = 0;

  sorted.forEach((row, index) => {
    const value = valueOf(row);
    // 앞 항목과 값이 같으면 순위를 유지, 다르면 현재 위치(index+1)가 새 순위가 된다.
    const rank = lastValue !== null && value === lastValue ? lastRank : index + 1;
    lastValue = value;
    lastRank = rank;
    result.push({ rank, row });
  });

  return result;
}
