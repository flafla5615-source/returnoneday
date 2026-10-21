"use client";

import { useEffect, useMemo, useState } from "react";
import { getAllBranches } from "@/services/branches";
import { getWeeklyReportsInRange, resolveWeeklyState } from "@/services/weeklyReports";
import {
  currentWeekStart,
  isWritableWeek,
  shiftWeek,
  weekOfMonthLabel,
  weekRangeLabel,
} from "@/lib/weekSchedule";
import {
  WeeklyReportDetailPanel,
  WeeklyStateBadge,
} from "@/components/reports/WeeklyReportViews";
import LoadingState from "@/components/common/LoadingState";
import { formatDateTime } from "@/lib/utils";
import type { Branch, BranchWeeklyReport } from "@/types";
import { ChevronLeftIcon, ChevronRightIcon, PaperclipIcon } from "lucide-react";

/* 본사 주간보고 현황.
   일일보고 화면과 같은 원칙 — 표에는 요약만 두고, 원문은 넓은 상세 화면에서 본다.
   표는 table-fixed 로 열 너비를 고정해 모든 지점이 같은 레이아웃을 쓴다. */

interface WeeklyRow {
  branch: Branch;
  report: BranchWeeklyReport | null;
}

export default function AdminWeeklyReportsPage() {
  const thisWeek = currentWeekStart();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [reports, setReports] = useState<BranchWeeklyReport[]>([]);
  const [weekStart, setWeekStart] = useState(thisWeek);
  const [branchFilter, setBranchFilter] = useState("");
  const [detailBranchId, setDetailBranchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAllBranches()
      .then(setBranches)
      .catch((err) => {
        console.error("admin weekly branches load failed:", err);
        setError("지점 목록을 불러오지 못했습니다.");
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // 전 지점을 한 번에 읽고 지점 필터는 화면에서 적용한다
        const loaded = await getWeeklyReportsInRange({
          fromWeekStart: weekStart,
          toWeekStart: weekStart,
        });
        if (!cancelled) setReports(loaded);
      } catch (err) {
        console.error("admin weekly reports load failed:", err);
        if (cancelled) return;
        setError("주간보고 현황을 불러오지 못했습니다.");
        setReports([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [weekStart]);

  const rows: WeeklyRow[] = useMemo(() => {
    const byBranch = new Map(reports.map((r) => [r.branchId, r]));
    return branches
      .filter((b) => !branchFilter || b.id === branchFilter)
      .map((branch) => ({ branch, report: byBranch.get(branch.id) ?? null }));
  }, [branches, reports, branchFilter]);

  // 집계는 지점 필터와 무관하게 전 지점 기준
  const summary = useMemo(() => {
    const byBranch = new Map(reports.map((r) => [r.branchId, r]));
    let submitted = 0;
    let draft = 0;
    for (const b of branches) {
      const state = resolveWeeklyState(byBranch.get(b.id) ?? null);
      if (state === "submitted") submitted += 1;
      if (state === "draft") draft += 1;
    }
    return { submitted, draft, missing: branches.length - submitted - draft };
  }, [branches, reports]);

  const detailRow = useMemo(
    () => rows.find((r) => r.branch.id === detailBranchId) ?? null,
    [rows, detailBranchId]
  );

  function goToWeek(next: string) {
    if (!isWritableWeek(next)) return;
    setWeekStart(next);
    setDetailBranchId(null);
  }

  const isThisWeek = weekStart === thisWeek;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900">지점별 주간보고 현황</h1>
        <p className="text-xs text-gray-400">월요일 ~ 일요일 기준 주차별 제출 현황입니다.</p>
      </div>

      {/* 주차 · 지점 필터 */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => goToWeek(shiftWeek(weekStart, -1))}
            aria-label="이전 주"
            className="rounded-lg border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-50"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <div className="px-2 text-center">
            <p className="text-sm font-semibold text-gray-800">{weekRangeLabel(weekStart)}</p>
            <p className="text-[11px] text-gray-400">
              {weekOfMonthLabel(weekStart)}
              {isThisWeek && " · 이번 주"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => goToWeek(shiftWeek(weekStart, 1))}
            disabled={isThisWeek}
            aria-label="다음 주"
            className="rounded-lg border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => goToWeek(thisWeek)}
            disabled={isThisWeek}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            이번 주
          </button>
        </div>

        <select
          value={branchFilter}
          onChange={(e) => setBranchFilter(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
        >
          <option value="">전 지점</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      {/* 집계 */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "제출 완료", value: summary.submitted, tone: "text-green-700" },
          { label: "임시저장", value: summary.draft, tone: "text-gray-700" },
          { label: "미작성", value: summary.missing, tone: "text-red-700" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className={`mt-1 text-xl font-bold ${s.tone}`}>
              {s.value}
              <span className="text-sm font-normal text-gray-400"> / {branches.length}</span>
            </p>
          </div>
        ))}
      </div>

      {loading ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
          표시할 지점이 없습니다.
        </p>
      ) : (
        <>
          {/* PC — 열 너비 고정 */}
          <div className="hidden overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm md:block">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[18%]" />
                <col className="w-[16%]" />
                <col className="w-[22%]" />
                <col className="w-[14%]" />
              </colgroup>
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium">지점</th>
                  <th className="px-4 py-2 font-medium">상태</th>
                  <th className="px-4 py-2 font-medium">첨부</th>
                  <th className="px-4 py-2 font-medium">최초 제출</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.branch.id}
                    onClick={() => row.report && setDetailBranchId(row.branch.id)}
                    className={
                      row.report
                        ? "cursor-pointer border-t border-gray-100 align-top hover:bg-gray-50"
                        : "border-t border-gray-100 align-top"
                    }
                  >
                    <td className="px-4 py-3">
                      <p className="truncate font-medium text-gray-800">{row.branch.name}</p>
                      <p className="truncate text-xs text-gray-400">{row.branch.brand}</p>
                    </td>
                    <td className="px-4 py-3">
                      <WeeklyStateBadge state={resolveWeeklyState(row.report)} />
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {row.report?.files?.length ? (
                        <span className="inline-flex items-center gap-1">
                          <PaperclipIcon className="h-3 w-3" />
                          {row.report.files.length}개
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {row.report?.submittedAt
                        ? formatDateTime(row.report.submittedAt.toDate())
                        : "-"}
                      {!!row.report?.editCount && (
                        <span className="block text-[11px] text-gray-400">
                          재제출 {row.report.editCount}회
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.report ? (
                        <span className="inline-block rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600">
                          보고 보기
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 모바일 — 가로 스크롤 없는 카드 목록 */}
          <div className="space-y-2 md:hidden">
            {rows.map((row) => (
              <button
                key={row.branch.id}
                type="button"
                disabled={!row.report}
                onClick={() => setDetailBranchId(row.branch.id)}
                className="w-full rounded-xl border border-gray-200 bg-white p-3 text-left shadow-sm disabled:opacity-70 active:bg-gray-50"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate font-medium text-gray-800">{row.branch.name}</p>
                  <WeeklyStateBadge state={resolveWeeklyState(row.report)} />
                </div>
                <p className="mt-1 flex items-center gap-1 text-xs text-gray-400">
                  {!!row.report?.files?.length && (
                    <>
                      <PaperclipIcon className="h-3 w-3" />
                      {row.report.files.length}개 ·
                    </>
                  )}
                  {row.report?.submittedAt
                    ? `제출 ${formatDateTime(row.report.submittedAt.toDate())}`
                    : "제출 기록 없음"}
                </p>
              </button>
            ))}
          </div>
        </>
      )}

      {detailRow?.report && (
        <WeeklyReportDetailPanel
          title={detailRow.branch.name}
          subtitle={`${detailRow.branch.brand} · ${weekRangeLabel(weekStart)}`}
          report={detailRow.report}
          weekStartDate={weekStart}
          onClose={() => setDetailBranchId(null)}
        />
      )}
    </div>
  );
}
