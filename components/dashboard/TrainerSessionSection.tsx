"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { format, startOfMonth } from "date-fns";
import { getAllBranchesIncludingInactive } from "@/services/branches";
import { getAllTrainers } from "@/services/trainers";
import { getAllTrainerDailyReportsByPeriod } from "@/services/trainerDailyReports";
import { getAllReports } from "@/services/reports";
import KpiCard from "@/components/dashboard/KpiCard";
import { cn, todayYMD, formatDate } from "@/lib/utils";
import type { Branch, Trainer, TrainerDailyReport } from "@/types";
import { ChevronDownIcon, ChevronRightIcon, XIcon } from "lucide-react";

const ptOf = (r: TrainerDailyReport) => r.ptSessionCount ?? 0;
const otOf = (r: TrainerDailyReport) => r.otSessionCount ?? 0;
const groupOf = (r: TrainerDailyReport) => r.groupSessionCount ?? 0;
const otherOf = (r: TrainerDailyReport) => r.otherSessionCount ?? 0;
const totalOf = (r: TrainerDailyReport) => r.totalSessionCount ?? 0;

function sumSessions(reports: TrainerDailyReport[]) {
  let pt = 0, ot = 0, group = 0, other = 0, total = 0;
  for (const r of reports) {
    pt += ptOf(r);
    ot += otOf(r);
    group += groupOf(r);
    other += otherOf(r);
    total += totalOf(r);
  }
  return { pt, ot, group, other, total };
}

type Scope = "today" | "month";

export default function TrainerSessionSection() {
  const today = todayYMD();
  const monthFrom = format(startOfMonth(new Date()), "yyyy-MM-dd");
  const monthLabel = format(new Date(), "M월");

  const [branches, setBranches] = useState<Branch[]>([]);
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [reports, setReports] = useState<TrainerDailyReport[]>([]);
  const [loading, setLoading] = useState(true);

  // Drilldown: card → scope, branch row → trainers, trainer row → dates
  const [openScope, setOpenScope] = useState<Scope | null>(null);
  const [openBranchId, setOpenBranchId] = useState<string | null>(null);
  const [openTrainerId, setOpenTrainerId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [bs, ts, trainerReports, dailyReports] = await Promise.all([
          getAllBranchesIncludingInactive(),
          getAllTrainers(),
          getAllTrainerDailyReportsByPeriod(monthFrom, today),
          getAllReports(monthFrom, today),
        ]);
        if (cancelled) return;
        const activeBranchIds = new Set(bs.filter((b) => b.active).map((b) => b.id));
        // 운영 집계: 테스트 제외 + submitted/locked 보고 연결 + 활성 지점만
        const validKeys = new Set(
          dailyReports
            .filter(
              (r) => !r.isTestData && (r.status === "submitted" || r.status === "locked")
            )
            .map((r) => `${r.branchId}_${r.reportDate}`)
        );
        setBranches(bs);
        setTrainers(ts);
        setReports(
          trainerReports.filter(
            (r) =>
              !r.isTestData &&
              validKeys.has(`${r.branchId}_${r.reportDate}`) &&
              activeBranchIds.has(r.branchId)
          )
        );
      } catch (err) {
        console.error("[TrainerSessionSection] load failed", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [monthFrom, today]);

  const branchNameOf = useMemo(() => {
    const m = new Map(branches.map((b) => [b.id, b.name]));
    return (id: string) => m.get(id) ?? id;
  }, [branches]);

  const branchBrandOf = useMemo(() => {
    const m = new Map(branches.map((b) => [b.id, b.brand]));
    return (id: string) => m.get(id) ?? "-";
  }, [branches]);

  const trainerNameOf = useMemo(() => {
    const m = new Map(trainers.map((t) => [t.id, t.name]));
    return (r: TrainerDailyReport) => m.get(r.trainerId) ?? r.trainerName;
  }, [trainers]);

  const todayReports = useMemo(
    () => reports.filter((r) => r.reportDate === today),
    [reports, today]
  );

  const todaySum = useMemo(() => sumSessions(todayReports), [todayReports]);
  const monthSum = useMemo(() => sumSessions(reports), [reports]);

  // Drilldown source data follows the clicked card's scope
  const scopeReports = openScope === "today" ? todayReports : reports;
  const scopeSum = openScope === "today" ? todaySum : monthSum;

  const branchRows = useMemo(() => {
    const map = new Map<string, { branchId: string; pt: number; ot: number; group: number; other: number; total: number }>();
    for (const r of scopeReports) {
      let agg = map.get(r.branchId);
      if (!agg) {
        agg = { branchId: r.branchId, pt: 0, ot: 0, group: 0, other: 0, total: 0 };
        map.set(r.branchId, agg);
      }
      agg.pt += ptOf(r);
      agg.ot += otOf(r);
      agg.group += groupOf(r);
      agg.other += otherOf(r);
      agg.total += totalOf(r);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [scopeReports]);

  const trainerRows = useMemo(() => {
    if (!openBranchId) return [];
    const map = new Map<string, { trainerId: string; trainerName: string; pt: number; ot: number; group: number; other: number; total: number }>();
    for (const r of scopeReports) {
      if (r.branchId !== openBranchId) continue;
      let agg = map.get(r.trainerId);
      if (!agg) {
        agg = { trainerId: r.trainerId, trainerName: trainerNameOf(r), pt: 0, ot: 0, group: 0, other: 0, total: 0 };
        map.set(r.trainerId, agg);
      }
      agg.pt += ptOf(r);
      agg.ot += otOf(r);
      agg.group += groupOf(r);
      agg.other += otherOf(r);
      agg.total += totalOf(r);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [scopeReports, openBranchId, trainerNameOf]);

  const dateRows = useMemo(() => {
    if (!openTrainerId) return [];
    return scopeReports
      .filter((r) => r.trainerId === openTrainerId && r.branchId === openBranchId)
      .sort((a, b) => a.reportDate.localeCompare(b.reportDate));
  }, [scopeReports, openTrainerId, openBranchId]);

  function toggleScope(scope: Scope) {
    setOpenBranchId(null);
    setOpenTrainerId(null);
    setOpenScope((prev) => (prev === scope ? null : scope));
  }

  if (loading) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">트레이너 세션</p>
        <span className="text-xs text-gray-400">제출 완료된 보고 기준</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          label="오늘 총 세션"
          value={todaySum.total}
          unit="회"
          subLabel={`${monthLabel} 누적 ${monthSum.total}회`}
          onClick={() => toggleScope("today")}
          active={openScope === "today"}
        />
        <KpiCard label="오늘 PT 세션" value={todaySum.pt} unit="회"
          onClick={() => toggleScope("today")} active={false} />
        <KpiCard label="오늘 OT / 체험" value={todaySum.ot} unit="회"
          onClick={() => toggleScope("today")} active={false} />
        <KpiCard label="오늘 그룹수업" value={todaySum.group} unit="회"
          onClick={() => toggleScope("today")} active={false} />
        <KpiCard label="오늘 기타" value={todaySum.other} unit="회"
          onClick={() => toggleScope("today")} active={false} />
        <KpiCard
          label={`${monthLabel} 누적 총 세션`}
          value={monthSum.total}
          unit="회"
          onClick={() => toggleScope("month")}
          active={openScope === "month"}
        />
      </div>

      {openScope && (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
            <p className="text-xs font-semibold text-gray-700">
              {openScope === "today" ? `오늘(${formatDate(today)})` : `${monthLabel} 누적`} 지점별 세션 상세
            </p>
            <button
              onClick={() => { setOpenScope(null); setOpenBranchId(null); setOpenTrainerId(null); }}
              className="p-1 rounded hover:bg-gray-200 text-gray-500"
            >
              <XIcon className="w-3.5 h-3.5" />
            </button>
          </div>

          {branchRows.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-8">
              선택한 기간에 등록된 트레이너 세션 실적이 없습니다.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {["지점", "브랜드", "PT 세션", "OT / 체험", "그룹수업", "기타", "총 세션"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {branchRows.map((b) => {
                    const bOpen = openBranchId === b.branchId;
                    return (
                      <Fragment key={b.branchId}>
                        <tr
                          onClick={() => {
                            setOpenTrainerId(null);
                            setOpenBranchId(bOpen ? null : b.branchId);
                          }}
                          className={cn("cursor-pointer hover:bg-gray-50", bOpen && "bg-blue-50/50")}
                        >
                          <td className="px-3 py-2 font-medium text-gray-900">
                            <span className="inline-flex items-center gap-1">
                              {bOpen ? <ChevronDownIcon className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRightIcon className="w-3.5 h-3.5 text-gray-400" />}
                              {branchNameOf(b.branchId)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">{branchBrandOf(b.branchId)}</td>
                          <td className="px-3 py-2 text-gray-700">{b.pt}회</td>
                          <td className="px-3 py-2 text-gray-700">{b.ot}회</td>
                          <td className="px-3 py-2 text-gray-700">{b.group}회</td>
                          <td className="px-3 py-2 text-gray-700">{b.other}회</td>
                          <td className="px-3 py-2 font-semibold text-gray-900">{b.total}회</td>
                        </tr>
                        {bOpen && (
                          <tr>
                            <td colSpan={7} className="px-4 py-3 bg-gray-50/70">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-gray-400">
                                    {["트레이너", "PT 세션", "OT / 체험", "그룹수업", "기타", "총 세션"].map((h) => (
                                      <th key={h} className="px-2 py-1.5 text-left font-medium">{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {trainerRows.map((t) => {
                                    const tOpen = openTrainerId === t.trainerId;
                                    return (
                                      <Fragment key={t.trainerId}>
                                        <tr
                                          onClick={() => setOpenTrainerId(tOpen ? null : t.trainerId)}
                                          className={cn("cursor-pointer hover:bg-gray-100/60", tOpen && "bg-blue-50")}
                                        >
                                          <td className="px-2 py-1.5 font-medium text-gray-700">
                                            <span className="inline-flex items-center gap-1">
                                              {tOpen ? <ChevronDownIcon className="w-3 h-3 text-gray-400" /> : <ChevronRightIcon className="w-3 h-3 text-gray-400" />}
                                              {t.trainerName}
                                            </span>
                                          </td>
                                          <td className="px-2 py-1.5 text-gray-600">{t.pt}회</td>
                                          <td className="px-2 py-1.5 text-gray-600">{t.ot}회</td>
                                          <td className="px-2 py-1.5 text-gray-600">{t.group}회</td>
                                          <td className="px-2 py-1.5 text-gray-600">{t.other}회</td>
                                          <td className="px-2 py-1.5 font-medium text-gray-800">{t.total}회</td>
                                        </tr>
                                        {tOpen && (
                                          <tr>
                                            <td colSpan={6} className="px-2 py-2 bg-white">
                                              <table className="w-full text-xs">
                                                <thead>
                                                  <tr className="text-gray-400">
                                                    {["날짜", "지점", "PT 세션", "OT / 체험", "그룹수업", "기타", "총 세션", "메모"].map((h) => (
                                                      <th key={h} className="px-2 py-1 text-left font-medium">{h}</th>
                                                    ))}
                                                  </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-50">
                                                  {dateRows.map((r) => (
                                                    <tr key={r.id}>
                                                      <td className="px-2 py-1 text-gray-600 whitespace-nowrap">{formatDate(r.reportDate)}</td>
                                                      <td className="px-2 py-1 text-gray-600">{branchNameOf(r.branchId)}</td>
                                                      <td className="px-2 py-1 text-gray-600">{ptOf(r)}회</td>
                                                      <td className="px-2 py-1 text-gray-600">{otOf(r)}회</td>
                                                      <td className="px-2 py-1 text-gray-600">{groupOf(r)}회</td>
                                                      <td className="px-2 py-1 text-gray-600">{otherOf(r)}회</td>
                                                      <td className="px-2 py-1 font-medium text-gray-800">{totalOf(r)}회</td>
                                                      <td className="px-2 py-1 text-gray-500">{r.memo || "-"}</td>
                                                    </tr>
                                                  ))}
                                                </tbody>
                                              </table>
                                            </td>
                                          </tr>
                                        )}
                                      </Fragment>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot className="bg-gray-50 border-t border-gray-200">
                  <tr className="text-xs font-semibold text-gray-700">
                    <td className="px-3 py-2" colSpan={2}>합계</td>
                    <td className="px-3 py-2">{scopeSum.pt}회</td>
                    <td className="px-3 py-2">{scopeSum.ot}회</td>
                    <td className="px-3 py-2">{scopeSum.group}회</td>
                    <td className="px-3 py-2">{scopeSum.other}회</td>
                    <td className="px-3 py-2">{scopeSum.total}회</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
