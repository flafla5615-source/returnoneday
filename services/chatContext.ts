import type { BranchKpi, KpiTotals } from "@/services/kpi";
import { UNAVAILABLE_KPIS } from "@/services/kpi";
import type { TrainerPerformanceRow } from "@/services/trainerPerformance";

/* ══════════════════════════════════════════════════════════════
   챗봇에 넘길 데이터 스냅샷
   ──────────────────────────────────────────────────────────────
   이 프로젝트에는 서비스 계정 키가 없어서 서버(Route Handler)가 Firestore를
   직접 읽을 수 없다. 대신 이미 화면에서 사용자 권한으로 조회·계산해 둔 값을
   그대로 넘긴다.

   이 방식의 장점:
   - Firestore 보안 규칙이 그대로 적용된다 (admin은 전체, 지점장은 본인 지점만).
     서버가 사용자보다 넓은 권한을 갖는 일이 생기지 않는다.
   - 화면 숫자와 챗봇 답변이 100% 같은 값에서 나온다 (재계산 불일치 없음).
   ══════════════════════════════════════════════════════════════ */

export interface ChatContext {
  period: { from: string; to: string; label: string };
  scope: string; // 예: "전 지점" / "어반요가"
  totals: KpiTotals;
  branches: BranchKpi[];
  trainers: TrainerPerformanceRow[];
  promotions: {
    promotionName: string;
    branchName: string;
    totalCost: number;
    registrations: number;
    sales: number;
    roas: number | null;
  }[];
}

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const num = (n: number) => n.toLocaleString("ko-KR");
const pct = (v: number | null) => (v === null ? "데이터 없음(분모 0)" : `${v.toFixed(1)}%`);

// 컨텍스트가 지나치게 길어지면 비용·지연이 커지므로 상위 항목만 넘긴다
const MAX_BRANCHES = 30;
const MAX_TRAINERS = 30;
const MAX_PROMOTIONS = 20;

function totalsBlock(t: KpiTotals): string {
  return [
    `활성 지점 수: ${num(t.activeBranchCount)}개`,
    `보고서 제출: ${num(t.reportCount)}건 / 기대 ${num(t.expectedReportCount)}건 (제출률 ${pct(t.submissionRate)})`,
    `미제출 지점 수: ${num(t.notSubmittedBranchCount)}개`,
    `운영 이슈(미해결): ${num(t.openIssueCount)}건, 이 중 긴급 ${num(t.criticalIssueCount)}건`,
    `유효회원 합계: ${num(t.activeMembers)}명 (지점별 기간 마지막 보고 기준 — 날짜별 합산이 아님)`,
    `재등록: ${num(t.reRegistrations)}명 / 컴백회원: ${num(t.comebackMembers)}명`,
    `문의: ${num(t.inquiries)}건 / 상담: ${num(t.ptConsultations)}건 / 등록: ${num(t.ptRegistrations)}건`,
    `문의 대비 등록 전환율: ${pct(t.conversionRate)}`,
    `총매출: ${won(t.totalSales)} (트레이너 워크인+개인 매출 합계. 일일보고에는 매출 필드가 없음)`,
    `객단가: ${t.avgTicket === null ? "데이터 없음(등록 0건)" : won(Math.round(t.avgTicket))}`,
    `활동 트레이너 수: ${num(t.activeTrainerCount)}명 / 총 세션: ${num(t.trainerSessions)}회`,
    `트레이너 워크인 매출: ${won(t.trainerWalkInSales)} / 개인 매출: ${won(t.trainerPersonalSales)}`,
    `프로모션 ${num(t.promotionCount)}개 / 총 홍보비 ${won(t.promotionTotalCost)} / 프로모션 매출 ${won(t.promotionSales)}`,
    `광고비 대비 매출(ROAS): ${t.roas === null ? "데이터 없음(홍보비 0원)" : `${t.roas.toFixed(2)}배`}`,
  ].join("\n");
}

function branchBlock(rows: BranchKpi[]): string {
  if (rows.length === 0) return "표시할 지점 데이터가 없습니다.";
  const sorted = [...rows].sort((a, b) => b.totalSales - a.totalSales).slice(0, MAX_BRANCHES);
  const lines = sorted.map((b) =>
    [
      `* ${b.branchName} (${b.brand} / ${b.region})`,
      `  총매출 ${won(b.totalSales)} | 문의 ${num(b.inquiries)} | 등록 ${num(b.ptRegistrations)} | 전환율 ${pct(b.conversionRate)}`,
      `  재등록 ${num(b.reRegistrations)} | 컴백 ${num(b.comebackMembers)} | 유효회원 ${b.latestActiveMembers === null ? "보고 없음" : num(b.latestActiveMembers) + "명"}`,
      `  트레이너 세션 ${num(b.trainerSessions)}회 | 트레이너 매출 ${won(b.trainerTotalSales)} | 활동 트레이너 ${num(b.activeTrainerCount)}명`,
      `  홍보비 ${won(b.promotionTotalCost)} | 프로모션 매출 ${won(b.promotionSales)} | 프로모션 ${num(b.promotionCount)}개`,
      `  보고서 ${num(b.reportCount)}/${num(b.expectedReportCount)}건 (제출률 ${pct(b.submissionRate)}) | 미해결 이슈 ${num(b.openIssueCount)}건(긴급 ${num(b.criticalIssueCount)})`,
    ].join("\n")
  );
  const omitted = rows.length - sorted.length;
  return [...lines, omitted > 0 ? `(매출 하위 ${omitted}개 지점은 생략됨)` : ""].filter(Boolean).join("\n");
}

function trainerBlock(rows: TrainerPerformanceRow[]): string {
  if (rows.length === 0) return "기간 내 트레이너 실적이 없습니다.";
  const sorted = [...rows].sort((a, b) => b.totalSales - a.totalSales).slice(0, MAX_TRAINERS);
  const lines = sorted.map(
    (t) =>
      `- ${t.trainerName}: 세션 ${num(t.totalSessions)}회 | 총매출 ${won(t.totalSales)} ` +
      `(워크인 ${won(t.walkInSales)} / 개인 ${won(t.personalSales)}) | 등록 ${num(t.totalReg)}건 | 활동 지점 ${t.branchCount}곳`
  );
  const omitted = rows.length - sorted.length;
  return [
    "트레이너는 전 지점 공용이며 아래 수치는 trainerId 기준 전 지점 합산입니다.",
    ...lines,
    omitted > 0 ? `(매출 하위 ${omitted}명은 생략됨)` : "",
  ].filter(Boolean).join("\n");
}

function promotionBlock(rows: ChatContext["promotions"]): string {
  if (rows.length === 0) return "해당 월에 등록된 프로모션이 없습니다.";
  return [...rows]
    .sort((a, b) => b.sales - a.sales)
    .slice(0, MAX_PROMOTIONS)
    .map(
      (p) =>
        `- ${p.branchName} / ${p.promotionName}: 홍보비 ${won(p.totalCost)} | 등록 ${num(p.registrations)}건 | ` +
        `매출 ${won(p.sales)} | ROAS ${p.roas === null ? "데이터 없음(홍보비 0원)" : `${p.roas.toFixed(2)}배`}`
    )
    .join("\n");
}

/** 모델에게 넘길 사실 스냅샷. 여기에 없는 값은 "모르는 값"으로 취급한다. */
export function buildContextText(ctx: ChatContext): string {
  return [
    `조회 기간: ${ctx.period.from} ~ ${ctx.period.to} (${ctx.period.label})`,
    `조회 범위: ${ctx.scope}`,
    "",
    "════ 전체 합계 ════",
    totalsBlock(ctx.totals),
    "",
    "════ 지점별 실적 ════",
    branchBlock(ctx.branches),
    "",
    "════ 트레이너 실적 ════",
    trainerBlock(ctx.trainers),
    "",
    "════ 프로모션 실적 ════",
    promotionBlock(ctx.promotions),
    "",
    "════ 이 시스템에 존재하지 않는 지표 ════",
    ...UNAVAILABLE_KPIS.map((k) => `- ${k.label}: ${k.reason}. 절대 추정값을 만들지 말 것.`),
  ].join("\n");
}
