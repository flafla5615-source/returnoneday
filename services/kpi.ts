import type { Branch, DailyReport, Issue, Promotion, TrainerSession } from "@/types";
import { getKoreaToday, addDaysToDateKey } from "@/lib/utils";
import {
  totalSessionOf, walkInSalesOf, personalSalesOf, totalSalesOf, totalRegOf,
} from "@/services/trainerPerformance";
import { calcAchievement, type Achievement } from "@/services/branchTargets";
import type { BranchMonthlyTarget } from "@/types";

// 본사 통합 KPI — 별도 누적 문서를 만들지 않고 원본을 기간별로 합산한다.
// 원본: dailyReports(reportDate) / trainerSessions(date) / promotions / issues(reportDate)
//       / branchMonthlyTargets
// createdAt은 실적 기간 기준으로 절대 사용하지 않는다.
// 같은 날짜 보고서는 문서 1개(branchId_reportDate)이므로 수정해도 이중 누적되지 않는다.

// ── 데이터가 없는 KPI ─────────────────────────────────────────────────────────
// 아래 지표는 현재 저장 구조에 대응 필드가 없다. 0으로 채워 정상 수치처럼 보이게 하지 않고,
// 화면에서 "데이터 없음"으로 표시하기 위해 명시적으로 선언해 둔다.
export const UNAVAILABLE_KPIS = [
  { key: "newMembers", label: "신규회원 수", reason: "dailyReports에 신규회원 필드가 없음" },
  { key: "churnRefund", label: "탈퇴·환불 수", reason: "dailyReports에 탈퇴·환불 필드가 없음" },
] as const;

// ── 기간 ──────────────────────────────────────────────────────────────────────

export type KpiPeriod = "today" | "thisWeek" | "thisMonth" | "lastMonth" | "thisQuarter" | "custom";

export const KPI_PERIOD_LABELS: Record<KpiPeriod, string> = {
  today: "오늘",
  thisWeek: "이번 주",
  thisMonth: "이번 달",
  lastMonth: "지난달",
  thisQuarter: "이번 분기",
  custom: "직접 선택",
};

function startOfKoreaWeek(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=일
  return addDaysToDateKey(dateKey, dow === 0 ? -6 : -(dow - 1));
}

function monthBounds(yearMonth: string): { from: string; to: string } {
  const [y, m] = yearMonth.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${yearMonth}-01`, to: `${yearMonth}-${String(last).padStart(2, "0")}` };
}

export function resolveKpiPeriod(
  preset: KpiPeriod,
  customStart?: string,
  customEnd?: string
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
      const prev = addDaysToDateKey(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
      return monthBounds(prev);
    }
    case "thisQuarter": {
      const [y, m] = today.split("-").map(Number);
      const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
      return { from: `${y}-${String(qStartMonth).padStart(2, "0")}-01`, to: today };
    }
    case "custom": {
      const f = customStart ?? today;
      const t = customEnd ?? today;
      return f <= t ? { from: f, to: t } : { from: t, to: f };
    }
  }
}

// 기간 안의 모든 날짜 (일별 추이용)
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  // 안전장치 — 최대 400일
  for (let i = 0; cur <= to && i < 400; i++) {
    out.push(cur);
    cur = addDaysToDateKey(cur, 1);
  }
  return out;
}

// ── 보고서 유효성 ──────────────────────────────────────────────────────────────
// 운영 집계에는 제출 완료(submitted/locked) 보고서만 포함한다.

export const isOperationalReport = (r: DailyReport) =>
  !r.isTestData && (r.status === "submitted" || r.status === "locked");

const n = (v: number | null | undefined) => v ?? 0;

// ── 지점별 KPI ────────────────────────────────────────────────────────────────

export interface BranchKpi {
  branchId: string;
  branchName: string;
  brand: string;
  region: string;

  // 보고
  reportCount: number;        // 기간 내 제출 완료 보고 수
  expectedReportCount: number; // 기간 일수 (제출률 분모)
  submissionRate: number | null;

  // 회원 (유효회원은 스냅샷이라 합산하지 않고 기간 마지막 보고값을 쓴다)
  latestActiveMembers: number | null;
  reRegistrations: number;
  comebackMembers: number;

  // 영업
  inquiries: number;
  ptConsultations: number;
  ptRegistrations: number;
  conversionRate: number | null; // 등록/문의 — 분모 0이면 null

  // 트레이너 (trainerSessions 원본 합산)
  trainerSessions: number;
  trainerWalkInSales: number;
  trainerPersonalSales: number;
  trainerTotalSales: number;
  trainerRegistrations: number;
  activeTrainerCount: number;

  // 프로모션 (dailyReports의 프로모션 필드 합산)
  promotionOnlineCost: number;
  promotionOfflineCost: number;
  promotionTotalCost: number;
  promotionInquiries: number;
  promotionVisits: number;
  promotionRegistrations: number;
  promotionSales: number;
  promotionCount: number; // 기간에 걸친 등록 프로모션 수

  // 이슈
  openIssueCount: number;
  criticalIssueCount: number;

  // 파생
  totalSales: number;          // 실매출 원본 = 트레이너 총매출
  avgTicket: number | null;    // 객단가 = 총매출 / 트레이너 등록건수
  roas: number | null;         // 광고비 대비 매출
}

export interface BuildKpiInput {
  branches: Branch[];
  reports: DailyReport[];
  sessions: TrainerSession[];
  promotions: Promotion[];
  issues: Issue[];
  from: string;
  to: string;
}

export function buildBranchKpis(input: BuildKpiInput): BranchKpi[] {
  const { branches, reports, sessions, promotions, issues, from, to } = input;
  const dayCount = eachDate(from, to).length;

  const operational = reports.filter(isOperationalReport);
  const nonTestSessions = sessions.filter((s) => !s.isTestData);

  return branches.map((b) => {
    const branchReports = operational.filter((r) => r.branchId === b.id);
    const branchSessions = nonTestSessions.filter((s) => s.branchId === b.id);
    const branchIssues = issues.filter((i) => i.branchId === b.id);
    const branchPromotions = promotions.filter(
      (p) => p.branchId === b.id && p.startDate <= to && p.endDate >= from
    );

    // 유효회원은 누적이 아니라 스냅샷 → 기간 내 가장 최근 보고서 값을 쓴다.
    const latest = [...branchReports]
      .filter((r) => r.activeMembers !== null && r.activeMembers !== undefined)
      .sort((a, b2) => b2.reportDate.localeCompare(a.reportDate))[0];

    const inquiries = branchReports.reduce((s, r) => s + n(r.inquiries), 0);
    const ptRegistrations = branchReports.reduce((s, r) => s + n(r.ptRegistrations), 0);

    const trainerWalkInSales = branchSessions.reduce((s, r) => s + walkInSalesOf(r), 0);
    const trainerPersonalSales = branchSessions.reduce((s, r) => s + personalSalesOf(r), 0);
    const trainerTotalSales = branchSessions.reduce((s, r) => s + totalSalesOf(r), 0);
    const trainerRegistrations = branchSessions.reduce((s, r) => s + totalRegOf(r), 0);

    const promotionTotalCost = branchReports.reduce((s, r) => s + n(r.totalPromotionCost), 0);
    const promotionSales = branchReports.reduce((s, r) => s + n(r.promotionSalesAmount), 0);

    const openIssues = branchIssues.filter((i) => i.status !== "resolved");

    return {
      branchId: b.id,
      branchName: b.name,
      brand: b.brand,
      region: b.region,

      reportCount: branchReports.length,
      expectedReportCount: dayCount,
      submissionRate: dayCount === 0 ? null : (branchReports.length / dayCount) * 100,

      latestActiveMembers: latest?.activeMembers ?? null,
      reRegistrations: branchReports.reduce((s, r) => s + n(r.reRegistrations), 0),
      comebackMembers: branchReports.reduce((s, r) => s + n(r.comebackMembers), 0),

      inquiries,
      ptConsultations: branchReports.reduce((s, r) => s + n(r.ptConsultations), 0),
      ptRegistrations,
      conversionRate: inquiries === 0 ? null : (ptRegistrations / inquiries) * 100,

      trainerSessions: branchSessions.reduce((s, r) => s + totalSessionOf(r), 0),
      trainerWalkInSales,
      trainerPersonalSales,
      trainerTotalSales,
      trainerRegistrations,
      activeTrainerCount: new Set(branchSessions.map((s) => s.trainerId)).size,

      promotionOnlineCost: branchReports.reduce((s, r) => s + n(r.onlinePromotionCost), 0),
      promotionOfflineCost: branchReports.reduce((s, r) => s + n(r.offlinePromotionCost), 0),
      promotionTotalCost,
      promotionInquiries: branchReports.reduce((s, r) => s + n(r.promotionInquiryCount), 0),
      promotionVisits: branchReports.reduce((s, r) => s + n(r.promotionVisitCount), 0),
      promotionRegistrations: branchReports.reduce((s, r) => s + n(r.promotionRegistrationCount), 0),
      promotionSales,
      promotionCount: branchPromotions.length,

      openIssueCount: openIssues.length,
      criticalIssueCount: openIssues.filter((i) => i.severity === "critical").length,

      totalSales: trainerTotalSales,
      avgTicket: trainerRegistrations === 0 ? null : trainerTotalSales / trainerRegistrations,
      roas: promotionTotalCost === 0 ? null : promotionSales / promotionTotalCost,
    };
  });
}

// ── 전체 합계 ─────────────────────────────────────────────────────────────────

export interface KpiTotals {
  activeBranchCount: number;
  reportCount: number;
  expectedReportCount: number;
  submissionRate: number | null;
  notSubmittedBranchCount: number;
  openIssueCount: number;
  criticalIssueCount: number;

  activeMembers: number;  // 지점별 최신 스냅샷 합
  reRegistrations: number;
  comebackMembers: number;

  inquiries: number;
  ptConsultations: number;
  ptRegistrations: number;
  conversionRate: number | null;
  totalSales: number;
  avgTicket: number | null;

  activeTrainerCount: number;
  trainerSessions: number;
  trainerWalkInSales: number;
  trainerPersonalSales: number;
  trainerTotalSales: number;

  promotionCount: number;
  promotionOnlineCost: number;
  promotionOfflineCost: number;
  promotionTotalCost: number;
  promotionInquiries: number;
  promotionRegistrations: number;
  promotionSales: number;
  roas: number | null;
}

export function buildTotals(
  rows: BranchKpi[],
  sessions: TrainerSession[],
  promotions: Promotion[]
): KpiTotals {
  const sum = (f: (r: BranchKpi) => number) => rows.reduce((s, r) => s + f(r), 0);

  const inquiries = sum((r) => r.inquiries);
  const ptRegistrations = sum((r) => r.ptRegistrations);
  const trainerTotalSales = sum((r) => r.trainerTotalSales);
  const trainerRegistrations = sum((r) => r.trainerRegistrations);
  const promotionTotalCost = sum((r) => r.promotionTotalCost);
  const promotionSales = sum((r) => r.promotionSales);
  const reportCount = sum((r) => r.reportCount);
  const expectedReportCount = sum((r) => r.expectedReportCount);

  return {
    activeBranchCount: rows.length,
    reportCount,
    expectedReportCount,
    submissionRate: expectedReportCount === 0 ? null : (reportCount / expectedReportCount) * 100,
    notSubmittedBranchCount: rows.filter((r) => r.reportCount === 0).length,
    openIssueCount: sum((r) => r.openIssueCount),
    criticalIssueCount: sum((r) => r.criticalIssueCount),

    activeMembers: sum((r) => r.latestActiveMembers ?? 0),
    reRegistrations: sum((r) => r.reRegistrations),
    comebackMembers: sum((r) => r.comebackMembers),

    inquiries,
    ptConsultations: sum((r) => r.ptConsultations),
    ptRegistrations,
    conversionRate: inquiries === 0 ? null : (ptRegistrations / inquiries) * 100,
    totalSales: trainerTotalSales,
    avgTicket: trainerRegistrations === 0 ? null : trainerTotalSales / trainerRegistrations,

    // 트레이너는 전 지점 공용이라 지점별 합이 아니라 trainerId 기준 고유 수로 센다.
    activeTrainerCount: new Set(
      sessions.filter((s) => !s.isTestData).map((s) => s.trainerId)
    ).size,
    trainerSessions: sum((r) => r.trainerSessions),
    trainerWalkInSales: sum((r) => r.trainerWalkInSales),
    trainerPersonalSales: sum((r) => r.trainerPersonalSales),
    trainerTotalSales,

    promotionCount: promotions.length,
    promotionOnlineCost: sum((r) => r.promotionOnlineCost),
    promotionOfflineCost: sum((r) => r.promotionOfflineCost),
    promotionTotalCost,
    promotionInquiries: sum((r) => r.promotionInquiries),
    promotionRegistrations: sum((r) => r.promotionRegistrations),
    promotionSales,
    roas: promotionTotalCost === 0 ? null : promotionSales / promotionTotalCost,
  };
}

// ── 순위 (공동순위 1,2,2,4 / 분모 0인 지표는 제외) ─────────────────────────────

export type BranchRankMetric =
  | "totalSales" | "reRegistrations" | "comebackMembers" | "ptRegistrations"
  | "conversionRate" | "latestActiveMembers" | "trainerSessions"
  | "trainerTotalSales" | "roas" | "submissionRate";

export const BRANCH_RANK_TABS: { key: BranchRankMetric; label: string }[] = [
  { key: "totalSales", label: "총매출" },
  { key: "ptRegistrations", label: "총 등록" },
  { key: "reRegistrations", label: "재등록" },
  { key: "comebackMembers", label: "컴백회원" },
  { key: "conversionRate", label: "문의 전환율" },
  { key: "latestActiveMembers", label: "유효회원" },
  { key: "trainerSessions", label: "트레이너 총세션" },
  { key: "trainerTotalSales", label: "트레이너 총매출" },
  { key: "roas", label: "프로모션 효율" },
  { key: "submissionRate", label: "보고서 제출률" },
];

export interface Ranked<T> {
  rank: number;
  row: T;
}

/**
 * 공동순위: 동점이면 같은 순위, 다음 순위는 건너뛴다 (1,2,2,4).
 * 값이 null인 행(분모 0 등)은 순위 대상에서 제외하고 excluded로 돌려준다.
 */
export function rankBranches(
  rows: BranchKpi[],
  metric: BranchRankMetric
): { ranked: Ranked<BranchKpi>[]; excluded: BranchKpi[] } {
  const valueOf = (r: BranchKpi): number | null => {
    const v = r[metric];
    return typeof v === "number" ? v : null;
  };

  const rankable = rows.filter((r) => valueOf(r) !== null);
  const excluded = rows.filter((r) => valueOf(r) === null);

  const sorted = [...rankable].sort((a, b) => {
    const diff = (valueOf(b) ?? 0) - (valueOf(a) ?? 0);
    if (diff !== 0) return diff;
    return a.branchName.localeCompare(b.branchName, "ko");
  });

  const ranked: Ranked<BranchKpi>[] = [];
  let lastValue: number | null = null;
  let lastRank = 0;
  sorted.forEach((row, i) => {
    const v = valueOf(row) ?? 0;
    const rank = lastValue !== null && v === lastValue ? lastRank : i + 1;
    lastValue = v;
    lastRank = rank;
    ranked.push({ rank, row });
  });

  return { ranked, excluded };
}

// ── 프로모션 순위 ─────────────────────────────────────────────────────────────

export interface PromotionKpi {
  promotionId: string;
  promotionName: string;
  branchId: string;
  branchName: string;
  startDate: string;
  endDate: string;
  onlineCost: number;
  offlineCost: number;
  totalCost: number;
  inquiries: number;
  visits: number;
  registrations: number;
  sales: number;
  conversionRate: number | null;   // 등록/문의
  costPerRegistration: number | null; // 총비용/등록
  roas: number | null;             // 매출/총비용
}

export function buildPromotionKpis(
  promotions: Promotion[],
  reports: DailyReport[],
  branchNameOf: (id: string) => string
): PromotionKpi[] {
  const operational = reports.filter(isOperationalReport);
  return promotions.map((p) => {
    const linked = operational.filter((r) => r.promotionId === p.id);
    const onlineCost = linked.reduce((s, r) => s + n(r.onlinePromotionCost), 0);
    const offlineCost = linked.reduce((s, r) => s + n(r.offlinePromotionCost), 0);
    const totalCost = linked.reduce((s, r) => s + n(r.totalPromotionCost), 0);
    const inquiries = linked.reduce((s, r) => s + n(r.promotionInquiryCount), 0);
    const registrations = linked.reduce((s, r) => s + n(r.promotionRegistrationCount), 0);
    const sales = linked.reduce((s, r) => s + n(r.promotionSalesAmount), 0);
    return {
      promotionId: p.id,
      promotionName: p.name,
      branchId: p.branchId,
      branchName: branchNameOf(p.branchId),
      startDate: p.startDate,
      endDate: p.endDate,
      onlineCost,
      offlineCost,
      totalCost,
      inquiries,
      visits: linked.reduce((s, r) => s + n(r.promotionVisitCount), 0),
      registrations,
      sales,
      conversionRate: inquiries === 0 ? null : (registrations / inquiries) * 100,
      costPerRegistration: registrations === 0 ? null : totalCost / registrations,
      roas: totalCost === 0 ? null : sales / totalCost,
    };
  });
}

export type PromotionRankMetric =
  | "sales" | "registrations" | "inquiries" | "conversionRate" | "roas" | "costPerRegistration";

export const PROMOTION_RANK_TABS: { key: PromotionRankMetric; label: string }[] = [
  { key: "sales", label: "매출" },
  { key: "registrations", label: "등록 수" },
  { key: "inquiries", label: "문의 수" },
  { key: "conversionRate", label: "등록 전환율" },
  { key: "roas", label: "광고비 대비 매출" },
  { key: "costPerRegistration", label: "등록 1건당 비용" },
];

export function rankPromotions(
  rows: PromotionKpi[],
  metric: PromotionRankMetric
): { ranked: Ranked<PromotionKpi>[]; excluded: PromotionKpi[] } {
  // 등록 1건당 비용은 낮을수록 좋다 → 오름차순
  const ascending = metric === "costPerRegistration";
  const rankable = rows.filter((r) => r[metric] !== null);
  const excluded = rows.filter((r) => r[metric] === null);

  const sorted = [...rankable].sort((a, b) => {
    const av = (a[metric] as number) ?? 0;
    const bv = (b[metric] as number) ?? 0;
    const diff = ascending ? av - bv : bv - av;
    if (diff !== 0) return diff;
    return a.promotionName.localeCompare(b.promotionName, "ko");
  });

  const ranked: Ranked<PromotionKpi>[] = [];
  let lastValue: number | null = null;
  let lastRank = 0;
  sorted.forEach((row, i) => {
    const v = (row[metric] as number) ?? 0;
    const rank = lastValue !== null && v === lastValue ? lastRank : i + 1;
    lastValue = v;
    lastRank = rank;
    ranked.push({ rank, row });
  });
  return { ranked, excluded };
}

// ── 목표 달성률 ───────────────────────────────────────────────────────────────

export interface BranchAchievements {
  branchId: string;
  branchName: string;
  sales: Achievement;
  newMembers: Achievement | null; // 데이터 없음 → null
  renewals: Achievement;
  comebacks: Achievement;
  registrations: Achievement;
  inquiries: Achievement;
  trainerSales: Achievement;
}

export function buildAchievements(
  rows: BranchKpi[],
  targets: BranchMonthlyTarget[]
): BranchAchievements[] {
  const targetOf = new Map(targets.map((t) => [t.branchId, t]));
  return rows.map((r) => {
    const t = targetOf.get(r.branchId);
    return {
      branchId: r.branchId,
      branchName: r.branchName,
      sales: calcAchievement(t?.targetSalesAmount, r.totalSales),
      // 신규회원 실적 원본이 없으므로 달성률을 계산하지 않는다 (0%로 표시 금지)
      newMembers: null,
      renewals: calcAchievement(t?.targetRenewals, r.reRegistrations),
      comebacks: calcAchievement(t?.targetComebacks, r.comebackMembers),
      registrations: calcAchievement(t?.targetRegistrations, r.ptRegistrations),
      inquiries: calcAchievement(t?.targetInquiries, r.inquiries),
      trainerSales: calcAchievement(t?.targetTrainerSalesAmount, r.trainerTotalSales),
    };
  });
}

// ── 우수 지점 / 주의 지점 ─────────────────────────────────────────────────────

export interface BranchFlag {
  branchId: string;
  branchName: string;
  reasons: string[];
}

export function findExcellentBranches(
  rows: BranchKpi[],
  achievements: BranchAchievements[]
): BranchFlag[] {
  const achOf = new Map(achievements.map((a) => [a.branchId, a]));
  const out: BranchFlag[] = [];
  for (const r of rows) {
    const reasons: string[] = [];
    const a = achOf.get(r.branchId);
    if (a?.sales.status === "achieved") reasons.push(`매출 목표 달성 (${a.sales.rate!.toFixed(0)}%)`);
    if (r.submissionRate !== null && r.submissionRate >= 100) reasons.push("보고서 제출률 100%");
    if (r.criticalIssueCount === 0 && r.reportCount > 0) reasons.push("긴급 이슈 0건");
    if (r.conversionRate !== null && r.conversionRate >= 30) {
      reasons.push(`문의 전환율 ${r.conversionRate.toFixed(0)}%`);
    }
    if (reasons.length >= 2) out.push({ branchId: r.branchId, branchName: r.branchName, reasons });
  }
  return out;
}

/**
 * 주의 지점은 "순위가 낮다"는 이유로는 표시하지 않는다.
 * 미제출 / 목표 미달 / 이슈 / 광고비만 쓰고 등록 0 등 원본 근거가 있을 때만 표시한다.
 */
export function findWarningBranches(
  rows: BranchKpi[],
  achievements: BranchAchievements[]
): BranchFlag[] {
  const achOf = new Map(achievements.map((a) => [a.branchId, a]));
  const out: BranchFlag[] = [];
  for (const r of rows) {
    const reasons: string[] = [];
    const a = achOf.get(r.branchId);

    if (r.reportCount === 0) reasons.push("기간 내 제출된 보고서 없음");
    else if (r.submissionRate !== null && r.submissionRate < 50) {
      reasons.push(`보고서 제출률 ${r.submissionRate.toFixed(0)}%`);
    }
    if (a?.sales.status === "behind") reasons.push(`매출 목표 ${a.sales.rate!.toFixed(0)}% (80% 미만)`);
    if (r.criticalIssueCount > 0) reasons.push(`긴급 이슈 ${r.criticalIssueCount}건`);
    if (r.openIssueCount >= 3) reasons.push(`미해결 운영 이슈 ${r.openIssueCount}건`);
    // 문의는 많은데 전환이 낮은 경우 (표본이 있을 때만)
    if (r.inquiries >= 10 && r.conversionRate !== null && r.conversionRate < 10) {
      reasons.push(`문의 ${r.inquiries}건 대비 전환율 ${r.conversionRate.toFixed(0)}%`);
    }
    if (r.promotionCount === 0 && r.reportCount > 0) reasons.push("당월 등록된 프로모션 없음");
    if (r.promotionTotalCost > 0 && r.promotionRegistrations === 0) {
      reasons.push("홍보비 집행했으나 프로모션 등록 0건");
    }
    if (reasons.length > 0) out.push({ branchId: r.branchId, branchName: r.branchName, reasons });
  }
  return out;
}

// ── MVP 후보 ──────────────────────────────────────────────────────────────────
// 가중치는 상수로 분리한다 (설정 UI는 후속 작업).

export const MVP_WEIGHTS = {
  salesAchievement: 35,
  newMemberAchievement: 20, // 신규회원 원본이 없어 현재 점수에 반영되지 않음
  conversionRate: 15,
  promotionEfficiency: 15,
  submissionRate: 10,
  issueManagement: 5,
} as const;

export interface MvpCandidate {
  branchId: string;
  branchName: string;
  score: number;
  breakdown: { label: string; value: string; points: number }[];
}

export function buildMvpCandidates(
  rows: BranchKpi[],
  achievements: BranchAchievements[]
): MvpCandidate[] {
  const achOf = new Map(achievements.map((a) => [a.branchId, a]));
  const maxRoas = Math.max(0, ...rows.map((r) => r.roas ?? 0));

  const candidates = rows.map((r) => {
    const a = achOf.get(r.branchId);
    const breakdown: { label: string; value: string; points: number }[] = [];

    // 매출 목표 달성률 (목표 미설정이면 0점 — 근거를 breakdown에 명시)
    const salesRate = a?.sales.rate ?? null;
    const salesPoints =
      salesRate === null ? 0 : (Math.min(salesRate, 120) / 120) * MVP_WEIGHTS.salesAchievement;
    breakdown.push({
      label: "매출 목표 달성률",
      value: salesRate === null ? "목표 미설정" : `${salesRate.toFixed(0)}%`,
      points: salesPoints,
    });

    // 신규회원 달성률 — 원본 없음 → 0점, 사유 표시
    breakdown.push({ label: "신규회원 목표 달성률", value: "데이터 없음", points: 0 });

    const conv = r.conversionRate;
    const convPoints = conv === null ? 0 : (Math.min(conv, 50) / 50) * MVP_WEIGHTS.conversionRate;
    breakdown.push({
      label: "문의 전환율",
      value: conv === null ? "문의 없음" : `${conv.toFixed(0)}%`,
      points: convPoints,
    });

    const roasPoints =
      r.roas === null || maxRoas === 0 ? 0 : (r.roas / maxRoas) * MVP_WEIGHTS.promotionEfficiency;
    breakdown.push({
      label: "프로모션 효율",
      value: r.roas === null ? "홍보비 없음" : `${r.roas.toFixed(2)}배`,
      points: roasPoints,
    });

    const subPoints =
      r.submissionRate === null
        ? 0
        : (Math.min(r.submissionRate, 100) / 100) * MVP_WEIGHTS.submissionRate;
    breakdown.push({
      label: "보고서 제출률",
      value: r.submissionRate === null ? "-" : `${r.submissionRate.toFixed(0)}%`,
      points: subPoints,
    });

    const issuePoints = r.criticalIssueCount === 0 ? MVP_WEIGHTS.issueManagement : 0;
    breakdown.push({
      label: "운영 이슈 관리",
      value: r.criticalIssueCount === 0 ? "긴급 이슈 없음" : `긴급 ${r.criticalIssueCount}건`,
      points: issuePoints,
    });

    const score = breakdown.reduce((s, b) => s + b.points, 0);
    return { branchId: r.branchId, branchName: r.branchName, score, breakdown };
  });

  return candidates.sort((a, b) => b.score - a.score);
}

// ── 일별 추이 ─────────────────────────────────────────────────────────────────

export interface DailyTrendPoint {
  date: string;
  totalSales: number;
  inquiries: number;
  registrations: number;
  trainerSessions: number;
  trainerSales: number;
  promotionCost: number;
  promotionSales: number;
}

export function buildDailyTrend(
  from: string,
  to: string,
  reports: DailyReport[],
  sessions: TrainerSession[]
): DailyTrendPoint[] {
  const operational = reports.filter(isOperationalReport);
  const nonTest = sessions.filter((s) => !s.isTestData);

  return eachDate(from, to).map((date) => {
    const dayReports = operational.filter((r) => r.reportDate === date);
    const daySessions = nonTest.filter((s) => s.date === date);
    const trainerSales = daySessions.reduce((s, r) => s + totalSalesOf(r), 0);
    return {
      date,
      totalSales: trainerSales,
      inquiries: dayReports.reduce((s, r) => s + n(r.inquiries), 0),
      registrations: dayReports.reduce((s, r) => s + n(r.ptRegistrations), 0),
      trainerSessions: daySessions.reduce((s, r) => s + totalSessionOf(r), 0),
      trainerSales,
      promotionCost: dayReports.reduce((s, r) => s + n(r.totalPromotionCost), 0),
      promotionSales: dayReports.reduce((s, r) => s + n(r.promotionSalesAmount), 0),
    };
  });
}
