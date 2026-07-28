"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { getAllBranches } from "@/services/branches";
import { getAllReports } from "@/services/reports";
import { getAllTrainerSessionsByPeriod } from "@/services/trainerSessions";
import { getAllIssues } from "@/services/issues";
import { getPromotionsByMonth } from "@/services/promotions";
import { getAllTrainers } from "@/services/trainers";
import {
  getBranchTargetsByMonth, upsertBranchTarget, ACHIEVEMENT_LABEL,
  type BranchTargetInput,
} from "@/services/branchTargets";
import {
  resolveKpiPeriod, KPI_PERIOD_LABELS, buildBranchKpis, buildTotals,
  rankBranches, BRANCH_RANK_TABS, buildPromotionKpis, rankPromotions,
  PROMOTION_RANK_TABS, buildAchievements, findExcellentBranches,
  findWarningBranches, buildMvpCandidates, buildDailyTrend, MVP_WEIGHTS,
  UNAVAILABLE_KPIS,
  type KpiPeriod, type BranchRankMetric, type PromotionRankMetric,
} from "@/services/kpi";
import {
  aggregateByTrainer, rankWithTies, RANK_TABS as TRAINER_RANK_TABS,
  type RankMetric as TrainerRankMetric,
} from "@/services/trainerPerformance";
import LoadingState from "@/components/common/LoadingState";
import PrintHeader from "@/components/print/PrintHeader";
import { cn, formatNumber, formatDate, getKoreaToday } from "@/lib/utils";
import type { Branch, DailyReport, Issue, Promotion, TrainerSession, BranchMonthlyTarget } from "@/types";
import {
  DownloadIcon, TargetIcon, TrophyIcon, AlertTriangleIcon, XIcon, ChevronRightIcon,
} from "lucide-react";

const PERIODS: KpiPeriod[] = ["today", "thisWeek", "thisMonth", "lastMonth", "thisQuarter", "custom"];

const pct = (v: number | null, digits = 1) => (v === null ? "-" : `${v.toFixed(digits)}%`);
const won = (v: number) => `${formatNumber(v)}원`;
const ratio = (v: number | null) => (v === null ? "-" : `${v.toFixed(2)}배`);

export default function AdminKpiPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile } = useAuth();
  const today = getKoreaToday();

  const urlPreset = (searchParams?.get("period") ?? "thisMonth") as KpiPeriod;
  const preset: KpiPeriod = PERIODS.includes(urlPreset) ? urlPreset : "thisMonth";
  const urlStart = searchParams?.get("start") ?? `${today.slice(0, 7)}-01`;
  const urlEnd = searchParams?.get("end") ?? today;

  const { from, to } = useMemo(
    () => resolveKpiPeriod(preset, urlStart, urlEnd),
    [preset, urlStart, urlEnd]
  );

  const [branches, setBranches] = useState<Branch[]>([]);
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [sessions, setSessions] = useState<TrainerSession[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [targets, setTargets] = useState<BranchMonthlyTarget[]>([]);
  const [trainerNames, setTrainerNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const [brandFilter, setBrandFilter] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);

  const [branchMetric, setBranchMetric] = useState<BranchRankMetric>("totalSales");
  const [trainerMetric, setTrainerMetric] = useState<TrainerRankMetric>("totalSales");
  const [promoMetric, setPromoMetric] = useState<PromotionRankMetric>("sales");
  const [tab, setTab] = useState<"branch" | "trainer" | "promotion" | "target">("branch");

  // 목표 편집
  const [targetModal, setTargetModal] = useState<{ branchId: string; branchName: string } | null>(null);
  const [targetForm, setTargetForm] = useState<Record<string, string>>({});
  const [savingTarget, setSavingTarget] = useState(false);

  // 목표는 월 단위 → 기간 시작월 기준으로 조회한다
  const targetYearMonth = from.slice(0, 7);

  function updateUrl(next: Partial<{ period: KpiPeriod; start: string; end: string }>) {
    const p = new URLSearchParams();
    p.set("period", next.period ?? preset);
    p.set("start", next.start ?? urlStart);
    p.set("end", next.end ?? urlEnd);
    router.push(`/admin/kpi?${p.toString()}`);
  }

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [bs, rs, ss, iss, ps, ts, trs] = await Promise.all([
          getAllBranches(),
          getAllReports(from, to),
          getAllTrainerSessionsByPeriod(from, to),
          getAllIssues({ fromDate: from, toDate: to }),
          getPromotionsByMonth(targetYearMonth),
          getBranchTargetsByMonth(targetYearMonth),
          getAllTrainers(),
        ]);
        if (cancelled) return;
        setBranches(bs);
        setReports(rs);
        setSessions(ss);
        setIssues(iss);
        setPromotions(ps);
        setTargets(ts);
        setTrainerNames(new Map(trs.map((t) => [t.id, t.name])));
      } catch (err) {
        if (cancelled) return;
        console.error("[KPI] load failed", err);
        const code = (err as { code?: string })?.code ?? "unknown";
        setError(
          code === "permission-denied"
            ? "KPI 데이터 접근 권한이 없습니다."
            : `데이터 로드 오류: ${code}`
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [profile, from, to, targetYearMonth]);

  const brands = useMemo(
    () => Array.from(new Set(branches.map((b) => b.brand).filter(Boolean))).sort(),
    [branches]
  );
  const regions = useMemo(
    () => Array.from(new Set(branches.map((b) => b.region).filter(Boolean))).sort(),
    [branches]
  );

  const filteredBranches = useMemo(
    () =>
      branches.filter((b) => {
        if (activeOnly && !b.active) return false;
        if (brandFilter && b.brand !== brandFilter) return false;
        if (regionFilter && b.region !== regionFilter) return false;
        if (branchFilter && b.id !== branchFilter) return false;
        return true;
      }),
    [branches, activeOnly, brandFilter, regionFilter, branchFilter]
  );

  const branchIdSet = useMemo(() => new Set(filteredBranches.map((b) => b.id)), [filteredBranches]);
  const scopedReports = useMemo(() => reports.filter((r) => branchIdSet.has(r.branchId)), [reports, branchIdSet]);
  const scopedSessions = useMemo(() => sessions.filter((s) => branchIdSet.has(s.branchId)), [sessions, branchIdSet]);
  const scopedIssues = useMemo(() => issues.filter((i) => branchIdSet.has(i.branchId)), [issues, branchIdSet]);
  const scopedPromotions = useMemo(
    () => promotions.filter((p) => branchIdSet.has(p.branchId)),
    [promotions, branchIdSet]
  );

  // 모든 수치는 원본을 기간별로 합산해 계산한다 (누적 문서 없음)
  const branchKpis = useMemo(
    () => buildBranchKpis({
      branches: filteredBranches, reports: scopedReports, sessions: scopedSessions,
      promotions: scopedPromotions, issues: scopedIssues, from, to,
    }),
    [filteredBranches, scopedReports, scopedSessions, scopedPromotions, scopedIssues, from, to]
  );
  const totals = useMemo(
    () => buildTotals(branchKpis, scopedSessions, scopedPromotions),
    [branchKpis, scopedSessions, scopedPromotions]
  );
  const achievements = useMemo(() => buildAchievements(branchKpis, targets), [branchKpis, targets]);
  const excellent = useMemo(() => findExcellentBranches(branchKpis, achievements), [branchKpis, achievements]);
  const warnings = useMemo(() => findWarningBranches(branchKpis, achievements), [branchKpis, achievements]);
  const mvps = useMemo(() => buildMvpCandidates(branchKpis, achievements), [branchKpis, achievements]);
  const trend = useMemo(
    () => buildDailyTrend(from, to, scopedReports, scopedSessions),
    [from, to, scopedReports, scopedSessions]
  );

  const branchNameOf = useMemo(() => {
    const m = new Map(branches.map((b) => [b.id, b.name]));
    return (id: string) => m.get(id) ?? id;
  }, [branches]);

  const branchRank = useMemo(() => rankBranches(branchKpis, branchMetric), [branchKpis, branchMetric]);

  // 트레이너는 trainerId 기준 전 지점 합산 (지점별로 나누지 않는다)
  const trainerRows = useMemo(
    () => aggregateByTrainer(
      scopedSessions.filter((s) => !s.isTestData),
      (r) => trainerNames.get(r.trainerId) ?? r.trainerName
    ),
    [scopedSessions, trainerNames]
  );
  const trainerRank = useMemo(
    () => rankWithTies(trainerRows, (r) => r[trainerMetric]),
    [trainerRows, trainerMetric]
  );

  const promotionKpis = useMemo(
    () => buildPromotionKpis(scopedPromotions, scopedReports, branchNameOf),
    [scopedPromotions, scopedReports, branchNameOf]
  );
  const promoRank = useMemo(() => rankPromotions(promotionKpis, promoMetric), [promotionKpis, promoMetric]);

  // 트레이너 MVP 후보 — 각 순위와 사유를 함께 보여준다 (종합점수 없음)
  const trainerMvps = useMemo(() => {
    const metrics: { key: TrainerRankMetric; label: string }[] = TRAINER_RANK_TABS.map((t) => ({
      key: t.key, label: t.label.replace("순위", ""),
    }));
    const rankMaps = metrics.map((m) => ({
      label: m.label,
      map: new Map(rankWithTies(trainerRows, (r) => r[m.key]).map((x) => [x.row.trainerId, x.rank])),
    }));
    return trainerRows
      .map((row) => {
        const reasons = rankMaps
          .map(({ label, map }) => ({ label, rank: map.get(row.trainerId) ?? 999 }))
          .filter((x) => x.rank <= 3)
          .sort((a, b) => a.rank - b.rank)
          .map((x) => `${label(x.label)} ${x.rank}위`);
        return { row, reasons, best: Math.min(...rankMaps.map((m) => m.map.get(row.trainerId) ?? 999)) };
      })
      .filter((c) => c.reasons.length > 0)
      .sort((a, b) => a.best - b.best)
      .slice(0, 5);
    function label(s: string) { return s; }
  }, [trainerRows]);

  function openTargetModal(branchId: string, branchName: string) {
    const t = targets.find((x) => x.branchId === branchId);
    setTargetForm({
      targetSalesAmount: t?.targetSalesAmount?.toString() ?? "",
      targetNewMembers: t?.targetNewMembers?.toString() ?? "",
      targetRenewals: t?.targetRenewals?.toString() ?? "",
      targetComebacks: t?.targetComebacks?.toString() ?? "",
      targetRegistrations: t?.targetRegistrations?.toString() ?? "",
      targetInquiries: t?.targetInquiries?.toString() ?? "",
      targetPtSalesAmount: t?.targetPtSalesAmount?.toString() ?? "",
      targetTrainerSalesAmount: t?.targetTrainerSalesAmount?.toString() ?? "",
    });
    setTargetModal({ branchId, branchName });
  }

  async function saveTarget() {
    if (!targetModal || !profile) return;
    setSavingTarget(true);
    try {
      const input: BranchTargetInput = {};
      for (const [k, v] of Object.entries(targetForm)) {
        const trimmed = v.trim();
        (input as Record<string, number | null>)[k] = trimmed === "" ? null : parseInt(trimmed, 10);
      }
      await upsertBranchTarget(targetModal.branchId, targetYearMonth, input, profile.uid);
      setTargets(await getBranchTargetsByMonth(targetYearMonth));
      setTargetModal(null);
    } catch (err) {
      console.error("[KPI] target save failed", err);
      setError("목표 저장에 실패했습니다.");
    } finally {
      setSavingTarget(false);
    }
  }

  async function downloadExcel() {
    setDownloading(true);
    try {
      const { Workbook } = await import("exceljs");
      const wb = new Workbook();
      wb.creator = "RETURN LIFE";
      wb.created = new Date();
      const style = (sheet: import("exceljs").Worksheet) => {
        const h = sheet.getRow(1);
        h.font = { bold: true, color: { argb: "FFFFFFFF" } };
        h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
        h.alignment = { vertical: "middle", horizontal: "center" };
        sheet.views = [{ state: "frozen", ySplit: 1 }];
      };

      // 1. 전체 KPI 요약 — 숫자는 문자열이 아니라 숫자 형식으로 저장
      const s1 = wb.addWorksheet("전체 KPI 요약");
      s1.columns = [
        { header: "지표", key: "label", width: 28 },
        { header: "값", key: "value", width: 20 },
        { header: "비고", key: "note", width: 36 },
      ];
      const summaryRows: [string, number | string, string][] = [
        ["조회 기간", `${from} ~ ${to}`, "reportDate / date 기준"],
        ["활성 지점 수", totals.activeBranchCount, ""],
        ["보고서 제출 수", totals.reportCount, `기대 ${totals.expectedReportCount}건`],
        ["보고서 제출률(%)", totals.submissionRate ?? "-", ""],
        ["미제출 지점 수", totals.notSubmittedBranchCount, ""],
        ["운영 이슈 수", totals.openIssueCount, "미해결 기준"],
        ["긴급 이슈 수", totals.criticalIssueCount, ""],
        ["유효회원 합계", totals.activeMembers, "지점별 기간 마지막 보고 기준"],
        ["재등록 수", totals.reRegistrations, ""],
        ["컴백회원 수", totals.comebackMembers, ""],
        ["총 문의 수", totals.inquiries, ""],
        ["총 상담 수", totals.ptConsultations, ""],
        ["총 등록 수", totals.ptRegistrations, ""],
        ["총매출(원)", totals.totalSales, "트레이너 워크인+개인 매출"],
        ["문의 대비 등록 전환율(%)", totals.conversionRate ?? "-", ""],
        ["객단가(원)", totals.avgTicket === null ? "-" : Math.round(totals.avgTicket), "총매출/트레이너 등록건수"],
        ["활동 트레이너 수", totals.activeTrainerCount, "trainerId 고유"],
        ["총 세션", totals.trainerSessions, ""],
        ["워크인 매출(원)", totals.trainerWalkInSales, ""],
        ["개인 매출(원)", totals.trainerPersonalSales, ""],
        ["트레이너 총매출(원)", totals.trainerTotalSales, ""],
        ["프로모션 수", totals.promotionCount, ""],
        ["온라인 홍보비(원)", totals.promotionOnlineCost, ""],
        ["오프라인 홍보비(원)", totals.promotionOfflineCost, ""],
        ["총 홍보비(원)", totals.promotionTotalCost, ""],
        ["프로모션 문의", totals.promotionInquiries, ""],
        ["프로모션 등록", totals.promotionRegistrations, ""],
        ["프로모션 매출(원)", totals.promotionSales, ""],
        ["광고비 대비 매출(배)", totals.roas === null ? "-" : Number(totals.roas.toFixed(2)), ""],
        ...UNAVAILABLE_KPIS.map((k) => [k.label, "데이터 없음", k.reason] as [string, string, string]),
      ];
      summaryRows.forEach(([label, value, note]) => s1.addRow({ label, value, note }));
      style(s1);

      // 2. 지점 순위
      const s2 = wb.addWorksheet("지점 순위");
      s2.columns = [
        { header: "순위", key: "rank", width: 8 },
        { header: "지점", key: "branchName", width: 20 },
        { header: "브랜드", key: "brand", width: 16 },
        { header: "총매출", key: "totalSales", width: 16 },
        { header: "재등록", key: "reRegistrations", width: 10 },
        { header: "컴백", key: "comebackMembers", width: 10 },
        { header: "문의", key: "inquiries", width: 10 },
        { header: "등록", key: "ptRegistrations", width: 10 },
        { header: "전환율(%)", key: "conversionRate", width: 12 },
        { header: "유효회원", key: "activeMembers", width: 12 },
        { header: "트레이너 세션", key: "trainerSessions", width: 14 },
        { header: "트레이너 매출", key: "trainerTotalSales", width: 16 },
        { header: "홍보비", key: "promotionTotalCost", width: 14 },
        { header: "프로모션 매출", key: "promotionSales", width: 16 },
        { header: "제출률(%)", key: "submissionRate", width: 12 },
      ];
      branchRank.ranked.forEach(({ rank, row }) =>
        s2.addRow({
          rank, branchName: row.branchName, brand: row.brand,
          totalSales: row.totalSales, reRegistrations: row.reRegistrations,
          comebackMembers: row.comebackMembers, inquiries: row.inquiries,
          ptRegistrations: row.ptRegistrations,
          conversionRate: row.conversionRate === null ? "-" : Number(row.conversionRate.toFixed(1)),
          activeMembers: row.latestActiveMembers ?? "-",
          trainerSessions: row.trainerSessions, trainerTotalSales: row.trainerTotalSales,
          promotionTotalCost: row.promotionTotalCost, promotionSales: row.promotionSales,
          submissionRate: row.submissionRate === null ? "-" : Number(row.submissionRate.toFixed(1)),
        })
      );
      style(s2);

      // 3. 트레이너 순위
      const s3 = wb.addWorksheet("트레이너 순위");
      s3.columns = [
        { header: "순위", key: "rank", width: 8 },
        { header: "트레이너", key: "trainerName", width: 18 },
        { header: "총 세션", key: "totalSessions", width: 12 },
        { header: "워크인 매출", key: "walkInSales", width: 16 },
        { header: "개인 매출", key: "personalSales", width: 16 },
        { header: "총매출", key: "totalSales", width: 16 },
        { header: "등록 건수", key: "totalReg", width: 12 },
        { header: "활동 지점 수", key: "branchCount", width: 12 },
      ];
      trainerRank.forEach(({ rank, row }) =>
        s3.addRow({
          rank, trainerName: row.trainerName, totalSessions: row.totalSessions,
          walkInSales: row.walkInSales, personalSales: row.personalSales,
          totalSales: row.totalSales, totalReg: row.totalReg, branchCount: row.branchCount,
        })
      );
      style(s3);

      // 4. 프로모션 순위
      const s4 = wb.addWorksheet("프로모션 순위");
      s4.columns = [
        { header: "순위", key: "rank", width: 8 },
        { header: "지점", key: "branchName", width: 20 },
        { header: "프로모션명", key: "promotionName", width: 24 },
        { header: "기간", key: "period", width: 24 },
        { header: "총 홍보비", key: "totalCost", width: 14 },
        { header: "온라인 비용", key: "onlineCost", width: 14 },
        { header: "오프라인 비용", key: "offlineCost", width: 14 },
        { header: "문의", key: "inquiries", width: 10 },
        { header: "방문", key: "visits", width: 10 },
        { header: "등록", key: "registrations", width: 10 },
        { header: "매출", key: "sales", width: 16 },
        { header: "등록 전환율(%)", key: "conversionRate", width: 14 },
        { header: "등록 1건당 비용", key: "costPerRegistration", width: 16 },
        { header: "광고비 대비 매출(배)", key: "roas", width: 18 },
      ];
      promoRank.ranked.forEach(({ rank, row }) =>
        s4.addRow({
          rank, branchName: row.branchName, promotionName: row.promotionName,
          period: `${row.startDate} ~ ${row.endDate}`,
          totalCost: row.totalCost, onlineCost: row.onlineCost, offlineCost: row.offlineCost,
          inquiries: row.inquiries, visits: row.visits, registrations: row.registrations,
          sales: row.sales,
          conversionRate: row.conversionRate === null ? "-" : Number(row.conversionRate.toFixed(1)),
          costPerRegistration: row.costPerRegistration === null ? "-" : Math.round(row.costPerRegistration),
          roas: row.roas === null ? "-" : Number(row.roas.toFixed(2)),
        })
      );
      style(s4);

      // 5. 목표 달성률
      const s5 = wb.addWorksheet("목표 달성률");
      s5.columns = [
        { header: "지점", key: "branchName", width: 20 },
        { header: "기준 월", key: "yearMonth", width: 12 },
        { header: "항목", key: "item", width: 18 },
        { header: "목표", key: "target", width: 16 },
        { header: "실적", key: "actual", width: 16 },
        { header: "달성률(%)", key: "rate", width: 12 },
        { header: "상태", key: "status", width: 14 },
      ];
      achievements.forEach((a) => {
        const items: [string, typeof a.sales][] = [
          ["매출", a.sales], ["재등록", a.renewals], ["컴백", a.comebacks],
          ["등록", a.registrations], ["문의", a.inquiries], ["트레이너 매출", a.trainerSales],
        ];
        items.forEach(([item, ach]) =>
          s5.addRow({
            branchName: a.branchName, yearMonth: targetYearMonth, item,
            target: ach.target ?? "미설정", actual: ach.actual,
            rate: ach.rate === null ? "-" : Number(ach.rate.toFixed(1)),
            status: ACHIEVEMENT_LABEL[ach.status],
          })
        );
        s5.addRow({
          branchName: a.branchName, yearMonth: targetYearMonth, item: "신규회원",
          target: "-", actual: "데이터 없음", rate: "-", status: "원본 필드 없음",
        });
      });
      style(s5);

      // 6. 일별 추이
      const s6 = wb.addWorksheet("일별 추이");
      s6.columns = [
        { header: "날짜", key: "date", width: 14 },
        { header: "총매출", key: "totalSales", width: 16 },
        { header: "문의", key: "inquiries", width: 10 },
        { header: "등록", key: "registrations", width: 10 },
        { header: "트레이너 세션", key: "trainerSessions", width: 14 },
        { header: "트레이너 매출", key: "trainerSales", width: 16 },
        { header: "프로모션 비용", key: "promotionCost", width: 16 },
        { header: "프로모션 매출", key: "promotionSales", width: 16 },
      ];
      trend.forEach((p) => s6.addRow(p));
      style(s6);

      // 7. 미제출 및 운영 이슈
      const s7 = wb.addWorksheet("미제출 및 운영 이슈");
      s7.columns = [
        { header: "구분", key: "kind", width: 14 },
        { header: "지점", key: "branchName", width: 20 },
        { header: "내용", key: "detail", width: 50 },
        { header: "심각도", key: "severity", width: 12 },
        { header: "상태", key: "status", width: 12 },
        { header: "날짜", key: "date", width: 14 },
      ];
      branchKpis.filter((r) => r.reportCount === 0).forEach((r) =>
        s7.addRow({ kind: "미제출", branchName: r.branchName, detail: "기간 내 제출된 보고서 없음", severity: "-", status: "-", date: `${from} ~ ${to}` })
      );
      scopedIssues.filter((i) => i.status !== "resolved").forEach((i) =>
        s7.addRow({
          kind: "운영 이슈", branchName: branchNameOf(i.branchId), detail: i.description,
          severity: i.severity, status: i.status, date: i.reportDate,
        })
      );
      style(s7);

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `리턴라이프_KPI_${from}_${to}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[KPI] excel failed", err);
      setError("엑셀 다운로드에 실패했습니다.");
    } finally {
      setDownloading(false);
    }
  }

  if (loading) return <LoadingState />;

  const branchHref = (id: string) =>
    `/admin/kpi/branches/${id}?period=${preset}&start=${from}&end=${to}`;

  return (
    <div className="space-y-5">
      <PrintHeader title="본사 통합 KPI" subtitle={`${formatDate(from)} ~ ${formatDate(to)}`} />

      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-base font-bold text-gray-900">통합 KPI</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {formatDate(from)} ~ {formatDate(to)} · 원본 데이터 기간 합산 (reportDate / date 기준)
          </p>
        </div>
        <button
          onClick={downloadExcel}
          disabled={downloading}
          className="no-print flex items-center gap-1.5 px-3 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304f] disabled:opacity-40"
        >
          <DownloadIcon className="w-4 h-4" />
          {downloading ? "생성 중..." : "엑셀 다운로드"}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* 필터 */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3 no-print">
        <div className="flex flex-wrap gap-2">
          {PERIODS.map((k) => (
            <button
              key={k}
              onClick={() => updateUrl({ period: k })}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs border transition-colors",
                preset === k ? "bg-[#1e3a5f] text-white border-[#1e3a5f]" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
              )}
            >
              {KPI_PERIOD_LABELS[k]}
            </button>
          ))}
          {preset === "custom" && (
            <div className="flex items-center gap-1.5">
              <input type="date" value={urlStart} max={today}
                onChange={(e) => updateUrl({ period: "custom", start: e.target.value })}
                className="border border-gray-300 rounded-lg px-2 py-1 text-xs" />
              <span className="text-xs text-gray-400">~</span>
              <input type="date" value={urlEnd} max={today}
                onChange={(e) => updateUrl({ period: "custom", end: e.target.value })}
                className="border border-gray-300 rounded-lg px-2 py-1 text-xs" />
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={brandFilter} onChange={(e) => { setBrandFilter(e.target.value); setBranchFilter(""); }}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white">
            <option value="">전체 브랜드</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={regionFilter} onChange={(e) => { setRegionFilter(e.target.value); setBranchFilter(""); }}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white">
            <option value="">전체 지역</option>
            {regions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white">
            <option value="">전체 지점</option>
            {branches
              .filter((b) => (!brandFilter || b.brand === brandFilter) && (!regionFilter || b.region === regionFilter))
              .map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
            <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} className="rounded" />
            운영 중인 지점만
          </label>
        </div>
      </div>

      {/* 모바일 우선 요약 */}
      <div className="md:hidden bg-white rounded-xl border border-[#1e3a5f]/30 shadow-sm p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-800">핵심 요약</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { l: "총매출", v: won(totals.totalSales) },
            { l: "등록 전환율", v: pct(totals.conversionRate) },
            { l: "미제출 지점", v: `${totals.notSubmittedBranchCount}개` },
            { l: "긴급 이슈", v: `${totals.criticalIssueCount}건` },
          ].map((c) => (
            <div key={c.l} className="bg-gray-50 rounded-lg px-3 py-2">
              <p className="text-[11px] text-gray-500">{c.l}</p>
              <p className="text-sm font-bold text-gray-900">{c.v}</p>
            </div>
          ))}
        </div>
        <div>
          <p className="text-xs font-medium text-gray-600 mb-1">지점 TOP 3</p>
          {branchRank.ranked.slice(0, 3).map(({ rank, row }) => (
            <Link key={row.branchId} href={branchHref(row.branchId)}
              className="flex items-center justify-between py-1 text-xs">
              <span className="text-gray-700">{rank}. {row.branchName}</span>
              <span className="font-medium text-gray-900">{won(row.totalSales)}</span>
            </Link>
          ))}
        </div>
        <div>
          <p className="text-xs font-medium text-gray-600 mb-1">트레이너 TOP 3</p>
          {trainerRank.slice(0, 3).map(({ rank, row }) => (
            <div key={row.trainerId} className="flex items-center justify-between py-1 text-xs">
              <span className="text-gray-700">{rank}. {row.trainerName}</span>
              <span className="font-medium text-gray-900">{won(row.totalSales)}</span>
            </div>
          ))}
        </div>
        {warnings.length > 0 && (
          <div>
            <p className="text-xs font-medium text-red-600 mb-1">주의 지점 {warnings.length}곳</p>
            {warnings.slice(0, 3).map((w) => (
              <p key={w.branchId} className="text-[11px] text-gray-600 py-0.5">
                {w.branchName} — {w.reasons[0]}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* KPI 카드 */}
      <KpiGroup title="운영" cards={[
        { label: "활성 지점 수", value: `${totals.activeBranchCount}개` },
        { label: "보고서 제출률", value: pct(totals.submissionRate) },
        { label: "미제출 지점 수", value: `${totals.notSubmittedBranchCount}개` },
        { label: "운영 이슈 수", value: `${totals.openIssueCount}건` },
        { label: "긴급 이슈 수", value: `${totals.criticalIssueCount}건` },
      ]} />

      <KpiGroup title="회원" cards={[
        { label: "유효회원 합계", value: `${formatNumber(totals.activeMembers)}명`, note: "기간 마지막 보고 기준" },
        { label: "신규회원 수", value: "데이터 없음", unavailable: true },
        { label: "재등록 수", value: `${formatNumber(totals.reRegistrations)}명` },
        { label: "컴백회원 수", value: `${formatNumber(totals.comebackMembers)}명` },
        { label: "탈퇴·환불 수", value: "데이터 없음", unavailable: true },
      ]} />

      <KpiGroup title="영업" cards={[
        { label: "총 문의 수", value: `${formatNumber(totals.inquiries)}건` },
        { label: "총 상담 수", value: `${formatNumber(totals.ptConsultations)}건` },
        { label: "총 등록 수", value: `${formatNumber(totals.ptRegistrations)}건` },
        { label: "총매출", value: won(totals.totalSales), note: "트레이너 워크인+개인" },
        { label: "문의 대비 등록 전환율", value: pct(totals.conversionRate) },
        { label: "객단가", value: totals.avgTicket === null ? "-" : won(Math.round(totals.avgTicket)) },
      ]} />

      <KpiGroup title="트레이너" cards={[
        { label: "활동 트레이너 수", value: `${totals.activeTrainerCount}명` },
        { label: "총 세션", value: `${formatNumber(totals.trainerSessions)}회` },
        { label: "워크인 매출", value: won(totals.trainerWalkInSales) },
        { label: "개인 매출", value: won(totals.trainerPersonalSales) },
        { label: "트레이너 총매출", value: won(totals.trainerTotalSales) },
      ]} />

      <KpiGroup title="프로모션" cards={[
        { label: "프로모션 수", value: `${totals.promotionCount}개` },
        { label: "온라인 홍보비", value: won(totals.promotionOnlineCost) },
        { label: "오프라인 홍보비", value: won(totals.promotionOfflineCost) },
        { label: "총 홍보비", value: won(totals.promotionTotalCost) },
        { label: "프로모션 문의", value: `${formatNumber(totals.promotionInquiries)}건` },
        { label: "프로모션 등록", value: `${formatNumber(totals.promotionRegistrations)}건` },
        { label: "프로모션 매출", value: won(totals.promotionSales) },
        { label: "광고비 대비 매출", value: ratio(totals.roas) },
      ]} />

      {/* 우수 / 주의 / MVP */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <FlagCard title="우수 지점" icon={<TrophyIcon className="w-4 h-4 text-green-600" />}
          flags={excellent} tone="green" emptyText="조건을 충족한 지점이 아직 없습니다." branchHref={branchHref} />
        <FlagCard title="주의 지점" icon={<AlertTriangleIcon className="w-4 h-4 text-red-500" />}
          flags={warnings} tone="red" emptyText="주의가 필요한 지점이 없습니다." branchHref={branchHref} />
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <TrophyIcon className="w-4 h-4 text-amber-500" />
            <p className="text-sm font-semibold text-gray-800">MVP 후보 (지점)</p>
          </div>
          <p className="text-[11px] text-gray-400 mb-2">
            자동 확정이 아닌 후보입니다. 최종 선정은 관리자 승인 후 확정하세요.
          </p>
          {mvps.length === 0 ? (
            <p className="text-xs text-gray-400">데이터가 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {mvps.slice(0, 3).map((m, i) => (
                <div key={m.branchId} className="border border-gray-100 rounded-lg p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-800">{i + 1}. {m.branchName}</span>
                    <span className="text-xs font-bold text-amber-600">{m.score.toFixed(1)}점</span>
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {m.breakdown.map((b) => (
                      <p key={b.label} className="text-[11px] text-gray-500">
                        {b.label}: {b.value} ({b.points.toFixed(1)}점)
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-gray-400 mt-2">
            기본 가중치 — 매출 {MVP_WEIGHTS.salesAchievement} / 신규회원 {MVP_WEIGHTS.newMemberAchievement} /
            전환율 {MVP_WEIGHTS.conversionRate} / 프로모션 {MVP_WEIGHTS.promotionEfficiency} /
            제출률 {MVP_WEIGHTS.submissionRate} / 이슈 {MVP_WEIGHTS.issueManagement}
          </p>
        </div>
      </div>

      {/* MVP 트레이너 후보 */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <p className="text-sm font-semibold text-gray-800 mb-1">MVP 후보 (트레이너)</p>
        <p className="text-[11px] text-gray-400 mb-2">각 순위와 후보 사유를 함께 표시합니다. 최종 선정은 관리자 수동 확정.</p>
        {trainerMvps.length === 0 ? (
          <p className="text-xs text-gray-400">기간 내 트레이너 실적이 없습니다.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {trainerMvps.map((c) => (
              <div key={c.row.trainerId} className="border border-gray-100 rounded-lg p-2">
                <p className="text-xs font-medium text-gray-800">{c.row.trainerName}</p>
                <ul className="mt-1 space-y-0.5">
                  {c.reasons.map((r) => (
                    <li key={r} className="text-[11px] text-gray-500">· {r}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 순위 탭 */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap gap-1.5 no-print">
          {([
            ["branch", "지점 순위"], ["trainer", "트레이너 순위"],
            ["promotion", "프로모션 순위"], ["target", "목표 달성률"],
          ] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={cn("px-3 py-1.5 rounded-lg text-xs border",
                tab === k ? "bg-[#1e3a5f] text-white border-[#1e3a5f]" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50")}>
              {label}
            </button>
          ))}
        </div>

        {tab === "branch" && (
          <div className="p-4 space-y-3">
            <div className="flex flex-wrap gap-1.5 no-print">
              {BRANCH_RANK_TABS.map((t) => (
                <button key={t.key} onClick={() => setBranchMetric(t.key)}
                  className={cn("px-2.5 py-1 rounded-full text-[11px] border",
                    branchMetric === t.key ? "bg-gray-800 text-white border-gray-800" : "bg-white text-gray-600 border-gray-300")}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[1200px]">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {["순위","지점","브랜드","총매출","재등록","컴백","문의","등록","전환율","유효회원","트레이너 세션","트레이너 매출","홍보비","프로모션 매출","제출률"].map((h) => (
                      <th key={h} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {branchRank.ranked.map(({ rank, row }) => (
                    <tr key={row.branchId} className="hover:bg-gray-50">
                      <td className="px-3 py-2.5 font-semibold text-gray-600">{rank}</td>
                      <td className="px-3 py-2.5">
                        <Link href={branchHref(row.branchId)} className="font-medium text-blue-600 hover:underline inline-flex items-center gap-0.5">
                          {row.branchName}<ChevronRightIcon className="w-3 h-3" />
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-gray-500">{row.brand}</td>
                      <td className="px-3 py-2.5 font-semibold text-gray-900 whitespace-nowrap">{won(row.totalSales)}</td>
                      <td className="px-3 py-2.5 text-gray-700">{row.reRegistrations}</td>
                      <td className="px-3 py-2.5 text-gray-700">{row.comebackMembers}</td>
                      <td className="px-3 py-2.5 text-gray-700">{row.inquiries}</td>
                      <td className="px-3 py-2.5 text-gray-700">{row.ptRegistrations}</td>
                      <td className="px-3 py-2.5 text-gray-700">{pct(row.conversionRate, 0)}</td>
                      <td className="px-3 py-2.5 text-gray-700">{row.latestActiveMembers ?? "-"}</td>
                      <td className="px-3 py-2.5 text-gray-700">{row.trainerSessions}</td>
                      <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{won(row.trainerTotalSales)}</td>
                      <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{won(row.promotionTotalCost)}</td>
                      <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{won(row.promotionSales)}</td>
                      <td className="px-3 py-2.5 text-gray-700">{pct(row.submissionRate, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {branchRank.excluded.length > 0 && (
              <p className="text-xs text-gray-400">
                순위 제외 ({BRANCH_RANK_TABS.find((t) => t.key === branchMetric)?.label} 분모 0):{" "}
                {branchRank.excluded.map((r) => r.branchName).join(", ")}
              </p>
            )}
          </div>
        )}

        {tab === "trainer" && (
          <div className="p-4 space-y-3">
            <div className="flex flex-wrap gap-1.5 no-print">
              {TRAINER_RANK_TABS.map((t) => (
                <button key={t.key} onClick={() => setTrainerMetric(t.key)}
                  className={cn("px-2.5 py-1 rounded-full text-[11px] border",
                    trainerMetric === t.key ? "bg-gray-800 text-white border-gray-800" : "bg-white text-gray-600 border-gray-300")}>
                  {t.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-400">trainerId 기준 전 지점 합산 — 같은 트레이너를 지점별로 나누지 않습니다.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[860px]">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {["순위","트레이너","총 세션","워크인 매출","개인 매출","총매출","등록 건수","활동 지점 수"].map((h) => (
                      <th key={h} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {trainerRank.map(({ rank, row }) => (
                    <tr key={row.trainerId} className="hover:bg-gray-50">
                      <td className="px-3 py-2.5 font-semibold text-gray-600">{rank}</td>
                      <td className="px-3 py-2.5">
                        <Link href="/admin/trainers" className="font-medium text-blue-600 hover:underline">
                          {row.trainerName}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-gray-700">{formatNumber(row.totalSessions)}회</td>
                      <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{won(row.walkInSales)}</td>
                      <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{won(row.personalSales)}</td>
                      <td className="px-3 py-2.5 font-semibold text-gray-900 whitespace-nowrap">{won(row.totalSales)}</td>
                      <td className="px-3 py-2.5 text-gray-700">{formatNumber(row.totalReg)}건</td>
                      <td className="px-3 py-2.5 text-gray-700">{row.branchCount}곳</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "promotion" && (
          <div className="p-4 space-y-3">
            <div className="flex flex-wrap gap-1.5 no-print">
              {PROMOTION_RANK_TABS.map((t) => (
                <button key={t.key} onClick={() => setPromoMetric(t.key)}
                  className={cn("px-2.5 py-1 rounded-full text-[11px] border",
                    promoMetric === t.key ? "bg-gray-800 text-white border-gray-800" : "bg-white text-gray-600 border-gray-300")}>
                  {t.label}
                </button>
              ))}
            </div>
            {promotionKpis.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">{targetYearMonth}에 등록된 프로모션이 없습니다.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[1200px]">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        {["순위","지점","프로모션명","기간","총 홍보비","온라인","오프라인","문의","방문","등록","매출","등록 전환율","등록 1건당 비용","광고비 대비 매출"].map((h) => (
                          <th key={h} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {promoRank.ranked.map(({ rank, row }) => (
                        <tr key={row.promotionId} className="hover:bg-gray-50">
                          <td className="px-3 py-2.5 font-semibold text-gray-600">{rank}</td>
                          <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{row.branchName}</td>
                          <td className="px-3 py-2.5 font-medium text-gray-900 whitespace-nowrap">{row.promotionName}</td>
                          <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">{row.startDate} ~ {row.endDate}</td>
                          <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{won(row.totalCost)}</td>
                          <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{won(row.onlineCost)}</td>
                          <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{won(row.offlineCost)}</td>
                          <td className="px-3 py-2.5 text-gray-700">{row.inquiries}</td>
                          <td className="px-3 py-2.5 text-gray-700">{row.visits}</td>
                          <td className="px-3 py-2.5 text-gray-700">{row.registrations}</td>
                          <td className="px-3 py-2.5 font-semibold text-gray-900 whitespace-nowrap">{won(row.sales)}</td>
                          <td className="px-3 py-2.5 text-gray-700">{pct(row.conversionRate, 0)}</td>
                          <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">
                            {row.costPerRegistration === null ? "-" : won(Math.round(row.costPerRegistration))}
                          </td>
                          <td className="px-3 py-2.5 text-gray-700">{ratio(row.roas)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {promoRank.excluded.length > 0 && (
                  <p className="text-xs text-gray-400">
                    순위 제외 (분모 0): {promoRank.excluded.map((r) => r.promotionName).join(", ")}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {tab === "target" && (
          <div className="p-4 space-y-3">
            <p className="text-xs text-gray-400">
              기준 월 {targetYearMonth} · 목표 미입력 항목은 0%가 아니라 &ldquo;목표 미설정&rdquo;으로 표시됩니다.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {["지점","매출","재등록","컴백","등록","문의","트레이너 매출","신규회원",""].map((h, i) => (
                      <th key={`${h}-${i}`} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {achievements.map((a) => (
                    <tr key={a.branchId} className="hover:bg-gray-50">
                      <td className="px-3 py-2.5 font-medium text-gray-900 whitespace-nowrap">{a.branchName}</td>
                      {[a.sales, a.renewals, a.comebacks, a.registrations, a.inquiries, a.trainerSales].map((ach, i) => (
                        <td key={i} className="px-3 py-2.5 whitespace-nowrap">
                          <span className={cn("text-xs font-medium",
                            ach.status === "achieved" ? "text-green-600" :
                            ach.status === "warning" ? "text-amber-600" :
                            ach.status === "behind" ? "text-red-600" : "text-gray-400")}>
                            {ach.rate === null ? "목표 미설정" : `${ach.rate.toFixed(0)}%`}
                          </span>
                          <span className="block text-[10px] text-gray-400">{ACHIEVEMENT_LABEL[ach.status]}</span>
                        </td>
                      ))}
                      <td className="px-3 py-2.5 text-[11px] text-gray-400 whitespace-nowrap">데이터 없음</td>
                      <td className="px-3 py-2.5 no-print">
                        <button onClick={() => openTargetModal(a.branchId, a.branchName)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">
                          <TargetIcon className="w-3 h-3" />목표 설정
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 일별 추이 */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <p className="text-sm font-semibold text-gray-800 mb-2">일별 추이</p>
        {trend.length === 0 ? (
          <p className="text-xs text-gray-400">기간 데이터가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[860px]">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {["날짜","총매출","문의","등록","트레이너 세션","트레이너 매출","프로모션 비용","프로모션 매출"].map((h) => (
                    <th key={h} className="px-2 py-2 text-left font-medium text-gray-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {trend.map((p) => (
                  <tr key={p.date} className="hover:bg-gray-50">
                    <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{p.date}</td>
                    <td className="px-2 py-1.5 text-gray-800 font-medium whitespace-nowrap">{won(p.totalSales)}</td>
                    <td className="px-2 py-1.5 text-gray-600">{p.inquiries}</td>
                    <td className="px-2 py-1.5 text-gray-600">{p.registrations}</td>
                    <td className="px-2 py-1.5 text-gray-600">{p.trainerSessions}</td>
                    <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{won(p.trainerSales)}</td>
                    <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{won(p.promotionCost)}</td>
                    <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{won(p.promotionSales)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 데이터 없는 KPI 안내 */}
      <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
        <p className="text-sm font-semibold text-gray-700 mb-1">현재 원본 데이터가 없는 지표</p>
        <ul className="space-y-0.5">
          {UNAVAILABLE_KPIS.map((k) => (
            <li key={k.key} className="text-xs text-gray-500">· {k.label} — {k.reason}</li>
          ))}
        </ul>
        <p className="text-[11px] text-gray-400 mt-1">
          0으로 채우지 않고 &ldquo;데이터 없음&rdquo;으로 표시합니다. 입력 필드를 추가하면 자동으로 집계됩니다.
        </p>
      </div>

      {/* 목표 설정 모달 */}
      {targetModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-6 px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setTargetModal(null)} />
          <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-lg space-y-4 my-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">{targetModal.branchName} 월 목표</h3>
                <p className="text-xs text-gray-400">{targetYearMonth} · 비워두면 목표 미설정</p>
              </div>
              <button onClick={() => setTargetModal(null)} className="text-gray-400 hover:text-gray-600">
                <XIcon className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {([
                ["targetSalesAmount", "매출 목표 (원)"],
                ["targetNewMembers", "신규회원 목표 (명)"],
                ["targetRenewals", "재등록 목표 (명)"],
                ["targetComebacks", "컴백 목표 (명)"],
                ["targetRegistrations", "등록 목표 (건)"],
                ["targetInquiries", "문의 목표 (건)"],
                ["targetPtSalesAmount", "PT 매출 목표 (원)"],
                ["targetTrainerSalesAmount", "트레이너 매출 목표 (원)"],
              ] as const).map(([key, label]) => (
                <div key={key}>
                  <label className="text-xs text-gray-600 block mb-1">{label}</label>
                  <input type="number" min={0} value={targetForm[key] ?? ""}
                    onChange={(e) => setTargetForm((f) => ({ ...f, [key]: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
              ))}
            </div>
            <p className="text-[11px] text-gray-400">
              신규회원 목표는 저장되지만, 실적 원본 필드가 없어 현재 달성률은 계산되지 않습니다.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setTargetModal(null)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">취소</button>
              <button onClick={saveTarget} disabled={savingTarget}
                className="px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304f] disabled:opacity-50">
                {savingTarget ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400">
        모든 수치는 dailyReports(reportDate) / trainerSessions(date) / promotions / issues 원본을
        기간별로 합산해 계산합니다. 누적 문서를 따로 저장하지 않으므로 같은 날짜 보고서를 수정해도
        이중 집계되지 않습니다. 제출 완료(submitted/locked) 보고서만 집계합니다.
      </p>
    </div>
  );
}

// ── 보조 컴포넌트 ─────────────────────────────────────────────────────────────

function KpiGroup({
  title,
  cards,
}: {
  title: string;
  cards: { label: string; value: string; note?: string; unavailable?: boolean }[];
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 mb-2">{title}</p>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {cards.map((c) => (
          <div key={c.label}
            className={cn("bg-white rounded-xl border shadow-sm px-4 py-3",
              c.unavailable ? "border-dashed border-gray-300" : "border-gray-200")}>
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className={cn("text-sm font-bold mt-1", c.unavailable ? "text-gray-400" : "text-gray-900")}>
              {c.value}
            </p>
            {c.note && <p className="text-[10px] text-gray-400 mt-0.5">{c.note}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function FlagCard({
  title, icon, flags, tone, emptyText, branchHref,
}: {
  title: string;
  icon: React.ReactNode;
  flags: { branchId: string; branchName: string; reasons: string[] }[];
  tone: "green" | "red";
  emptyText: string;
  branchHref: (id: string) => string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <p className="text-sm font-semibold text-gray-800">{title}</p>
        <span className="text-xs text-gray-400">{flags.length}곳</span>
      </div>
      {flags.length === 0 ? (
        <p className="text-xs text-gray-400">{emptyText}</p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {flags.map((f) => (
            <div key={f.branchId} className={cn("rounded-lg border p-2",
              tone === "green" ? "border-green-100 bg-green-50/40" : "border-red-100 bg-red-50/40")}>
              <Link href={branchHref(f.branchId)} className="text-xs font-medium text-gray-800 hover:underline">
                {f.branchName}
              </Link>
              <ul className="mt-0.5 space-y-0.5">
                {f.reasons.map((r) => (
                  <li key={r} className="text-[11px] text-gray-600">· {r}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
