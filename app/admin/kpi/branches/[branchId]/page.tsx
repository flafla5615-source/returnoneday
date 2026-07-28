"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { getBranchesByIds } from "@/services/branches";
import { getReportsByBranch } from "@/services/reports";
import { getTrainerSessionsByPeriod } from "@/services/trainerSessions";
import { getAllIssues } from "@/services/issues";
import { getPromotionsByBranchAndMonth } from "@/services/promotions";
import { getAllTrainers } from "@/services/trainers";
import { getBranchTargetsByMonth, ACHIEVEMENT_LABEL } from "@/services/branchTargets";
import {
  resolveKpiPeriod, buildBranchKpis, buildAchievements, buildDailyTrend,
  buildPromotionKpis, isOperationalReport,
  type KpiPeriod,
} from "@/services/kpi";
import { aggregateByTrainer } from "@/services/trainerPerformance";
import LoadingState from "@/components/common/LoadingState";
import PrintHeader from "@/components/print/PrintHeader";
import { ReportStatusBadge } from "@/components/common/StatusBadge";
import { cn, formatNumber, formatDate } from "@/lib/utils";
import type { Branch, DailyReport, Issue, Promotion, TrainerSession, BranchMonthlyTarget } from "@/types";
import { ChevronLeftIcon } from "lucide-react";

const won = (v: number) => `${formatNumber(v)}원`;
const pct = (v: number | null, d = 1) => (v === null ? "-" : `${v.toFixed(d)}%`);

export default function BranchKpiDetailPage() {
  const { branchId } = useParams<{ branchId: string }>();
  const searchParams = useSearchParams();
  const { profile } = useAuth();

  // 목록 화면에서 넘어온 기간 query를 그대로 유지한다
  const preset = (searchParams?.get("period") ?? "thisMonth") as KpiPeriod;
  const start = searchParams?.get("start") ?? undefined;
  const end = searchParams?.get("end") ?? undefined;
  const { from, to } = useMemo(
    () => (start && end ? { from: start, to: end } : resolveKpiPeriod(preset, start, end)),
    [preset, start, end]
  );
  const yearMonth = from.slice(0, 7);

  const [branch, setBranch] = useState<Branch | null>(null);
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [sessions, setSessions] = useState<TrainerSession[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [targets, setTargets] = useState<BranchMonthlyTarget[]>([]);
  const [trainerNames, setTrainerNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile || !branchId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [bs, rs, ss, iss, ps, ts, trs] = await Promise.all([
          getBranchesByIds([branchId]),
          getReportsByBranch(branchId, from, to),
          getTrainerSessionsByPeriod(branchId, from, to),
          getAllIssues({ branchId, fromDate: from, toDate: to }),
          getPromotionsByBranchAndMonth(branchId, yearMonth),
          getBranchTargetsByMonth(yearMonth),
          getAllTrainers(),
        ]);
        if (cancelled) return;
        setBranch(bs[0] ?? null);
        setReports(rs);
        setSessions(ss);
        setIssues(iss);
        setPromotions(ps);
        setTargets(ts.filter((t) => t.branchId === branchId));
        setTrainerNames(new Map(trs.map((t) => [t.id, t.name])));
      } catch (err) {
        if (cancelled) return;
        console.error("[BranchKpi] load failed", err);
        setError("지점 KPI를 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [profile, branchId, from, to, yearMonth]);

  const kpi = useMemo(() => {
    if (!branch) return null;
    return buildBranchKpis({
      branches: [branch], reports, sessions, promotions, issues, from, to,
    })[0];
  }, [branch, reports, sessions, promotions, issues, from, to]);

  const achievement = useMemo(
    () => (kpi ? buildAchievements([kpi], targets)[0] : null),
    [kpi, targets]
  );
  const trend = useMemo(() => buildDailyTrend(from, to, reports, sessions), [from, to, reports, sessions]);
  const trainerRows = useMemo(
    () => aggregateByTrainer(
      sessions.filter((s) => !s.isTestData),
      (r) => trainerNames.get(r.trainerId) ?? r.trainerName
    ).sort((a, b) => b.totalSales - a.totalSales),
    [sessions, trainerNames]
  );
  const promotionRows = useMemo(
    () => buildPromotionKpis(promotions, reports, () => branch?.name ?? branchId),
    [promotions, reports, branch, branchId]
  );
  const operationalReports = useMemo(
    () => reports.filter(isOperationalReport).sort((a, b) => b.reportDate.localeCompare(a.reportDate)),
    [reports]
  );
  const openIssues = useMemo(() => issues.filter((i) => i.status !== "resolved"), [issues]);

  const backHref = `/admin/kpi?period=${preset}&start=${from}&end=${to}`;

  if (loading) return <LoadingState />;
  if (!branch || !kpi) {
    return <div className="p-6 text-gray-500">지점을 찾을 수 없습니다.</div>;
  }

  return (
    <div className="space-y-5">
      <PrintHeader title={`${branch.name} KPI`} subtitle={`${formatDate(from)} ~ ${formatDate(to)}`} />

      <div className="flex items-center gap-3">
        <Link href={backHref} className="p-1.5 rounded-lg hover:bg-gray-100 no-print">
          <ChevronLeftIcon className="w-5 h-5 text-gray-600" />
        </Link>
        <div>
          <h1 className="text-base font-bold text-gray-900">{branch.name}</h1>
          <p className="text-xs text-gray-500">
            {branch.brand} · {branch.region} · {formatDate(from)} ~ {formatDate(to)}
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* 선택 기간 KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {[
          { l: "총매출", v: won(kpi.totalSales) },
          { l: "문의", v: `${formatNumber(kpi.inquiries)}건` },
          { l: "등록", v: `${formatNumber(kpi.ptRegistrations)}건` },
          { l: "전환율", v: pct(kpi.conversionRate, 0) },
          { l: "유효회원", v: kpi.latestActiveMembers === null ? "-" : `${formatNumber(kpi.latestActiveMembers)}명` },
          { l: "재등록", v: `${formatNumber(kpi.reRegistrations)}명` },
          { l: "컴백", v: `${formatNumber(kpi.comebackMembers)}명` },
          { l: "제출률", v: pct(kpi.submissionRate, 0) },
          { l: "트레이너 세션", v: `${formatNumber(kpi.trainerSessions)}회` },
          { l: "트레이너 매출", v: won(kpi.trainerTotalSales) },
          { l: "홍보비", v: won(kpi.promotionTotalCost) },
          { l: "긴급 이슈", v: `${kpi.criticalIssueCount}건` },
        ].map((c) => (
          <div key={c.l} className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3">
            <p className="text-xs text-gray-500">{c.l}</p>
            <p className="text-sm font-bold text-gray-900 mt-1">{c.v}</p>
          </div>
        ))}
      </div>

      {/* 목표 달성률 */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <p className="text-sm font-semibold text-gray-800 mb-2">목표 달성률 ({yearMonth})</p>
        {achievement && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {([
              ["매출", achievement.sales], ["재등록", achievement.renewals],
              ["컴백", achievement.comebacks], ["등록", achievement.registrations],
              ["문의", achievement.inquiries], ["트레이너 매출", achievement.trainerSales],
            ] as const).map(([label, a]) => (
              <div key={label} className="rounded-lg border border-gray-100 px-3 py-2">
                <p className="text-[11px] text-gray-500">{label}</p>
                <p className={cn("text-sm font-bold",
                  a.status === "achieved" ? "text-green-600" :
                  a.status === "warning" ? "text-amber-600" :
                  a.status === "behind" ? "text-red-600" : "text-gray-400")}>
                  {a.rate === null ? "미설정" : `${a.rate.toFixed(0)}%`}
                </p>
                <p className="text-[10px] text-gray-400">{ACHIEVEMENT_LABEL[a.status]}</p>
                {a.target !== null && (
                  <p className="text-[10px] text-gray-400">
                    {formatNumber(a.actual)} / {formatNumber(a.target)}
                  </p>
                )}
              </div>
            ))}
            <div className="rounded-lg border border-dashed border-gray-200 px-3 py-2">
              <p className="text-[11px] text-gray-500">신규회원</p>
              <p className="text-sm font-bold text-gray-400">데이터 없음</p>
              <p className="text-[10px] text-gray-400">원본 필드 없음</p>
            </div>
          </div>
        )}
      </div>

      {/* 일별 추이 */}
      <Section title="일별 추이">
        {trend.length === 0 ? <Empty text="기간 데이터가 없습니다." /> : (
          <TableWrap minWidth={760}>
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {["날짜","총매출","문의","등록","트레이너 세션","트레이너 매출","프로모션 비용","프로모션 매출"].map((h) => (
                  <th key={h} className="px-2 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {trend.map((p) => (
                <tr key={p.date} className="hover:bg-gray-50 text-xs">
                  <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{p.date}</td>
                  <td className="px-2 py-1.5 font-medium text-gray-800 whitespace-nowrap">{won(p.totalSales)}</td>
                  <td className="px-2 py-1.5 text-gray-600">{p.inquiries}</td>
                  <td className="px-2 py-1.5 text-gray-600">{p.registrations}</td>
                  <td className="px-2 py-1.5 text-gray-600">{p.trainerSessions}</td>
                  <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{won(p.trainerSales)}</td>
                  <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{won(p.promotionCost)}</td>
                  <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{won(p.promotionSales)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>

      {/* 트레이너 실적 */}
      <Section title="트레이너 실적">
        {trainerRows.length === 0 ? <Empty text="기간 내 트레이너 실적이 없습니다." /> : (
          <TableWrap minWidth={700}>
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {["트레이너","총 세션","워크인 매출","개인 매출","총매출","등록 건수"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {trainerRows.map((t) => (
                <tr key={t.trainerId} className="hover:bg-gray-50 text-sm">
                  <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">{t.trainerName}</td>
                  <td className="px-3 py-2 text-gray-700">{formatNumber(t.totalSessions)}회</td>
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{won(t.walkInSales)}</td>
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{won(t.personalSales)}</td>
                  <td className="px-3 py-2 font-semibold text-gray-900 whitespace-nowrap">{won(t.totalSales)}</td>
                  <td className="px-3 py-2 text-gray-700">{formatNumber(t.totalReg)}건</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>

      {/* 프로모션 실적 */}
      <Section title={`프로모션 실적 (${yearMonth})`}>
        {promotionRows.length === 0 ? <Empty text="등록된 프로모션이 없습니다." /> : (
          <TableWrap minWidth={860}>
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {["프로모션명","기간","총 홍보비","문의","등록","매출","전환율","광고비 대비 매출"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {promotionRows.map((p) => (
                <tr key={p.promotionId} className="hover:bg-gray-50 text-sm">
                  <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">{p.promotionName}</td>
                  <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{p.startDate} ~ {p.endDate}</td>
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{won(p.totalCost)}</td>
                  <td className="px-3 py-2 text-gray-700">{p.inquiries}</td>
                  <td className="px-3 py-2 text-gray-700">{p.registrations}</td>
                  <td className="px-3 py-2 font-semibold text-gray-900 whitespace-nowrap">{won(p.sales)}</td>
                  <td className="px-3 py-2 text-gray-700">{pct(p.conversionRate, 0)}</td>
                  <td className="px-3 py-2 text-gray-700">{p.roas === null ? "-" : `${p.roas.toFixed(2)}배`}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>

      {/* 운영 이슈 */}
      <Section title={`운영 이슈 (미해결 ${openIssues.length}건)`}>
        {openIssues.length === 0 ? <Empty text="미해결 운영 이슈가 없습니다." /> : (
          <div className="space-y-2">
            {openIssues.map((i) => (
              <div key={i.id} className="border border-gray-100 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-gray-600">
                    {i.type === "claim" ? "클레임" : i.type === "staff" ? "인력" : "시설"}
                  </span>
                  <span className={cn("text-[11px] px-1.5 py-0.5 rounded-full",
                    i.severity === "critical" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600")}>
                    {i.severity}
                  </span>
                  <span className="text-[11px] text-gray-400">{i.reportDate}</span>
                </div>
                <p className="text-sm text-gray-800">{i.description}</p>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 보고서 제출 현황 + 목록 */}
      <Section title={`보고서 제출 현황 (${kpi.reportCount} / ${kpi.expectedReportCount}일)`}>
        {operationalReports.length === 0 ? (
          <Empty text="기간 내 제출 완료된 보고서가 없습니다." />
        ) : (
          <div className="space-y-1">
            {operationalReports.map((r) => (
              <Link key={r.id} href={`/admin/reports/${r.id}`}
                className="flex items-center justify-between py-2 px-2 -mx-2 rounded hover:bg-gray-50">
                <span className="text-sm text-gray-700">{formatDate(r.reportDate)}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400">
                    문의 {r.inquiries ?? "-"} · 등록 {r.ptRegistrations ?? "-"}
                  </span>
                  <ReportStatusBadge status={r.status} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <p className="text-sm font-semibold text-gray-800 mb-2">{title}</p>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-xs text-gray-400 py-4">{text}</p>;
}

function TableWrap({ minWidth, children }: { minWidth: number; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full" style={{ minWidth }}>{children}</table>
    </div>
  );
}
