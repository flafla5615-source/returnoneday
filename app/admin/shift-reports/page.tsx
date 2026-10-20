"use client";

import { useEffect, useMemo, useState } from "react";
import { getAllBranches } from "@/services/branches";
import { getShiftReportsInRange } from "@/services/shiftReports";
import { resolveSubmissionState, weekdayLabel } from "@/lib/shiftSchedule";
import LoadingState from "@/components/common/LoadingState";
import {
  ReportDetailPanel,
  ShiftSummaryCell,
  type BranchRow,
  type ShiftMap,
} from "@/components/reports/ShiftReportViews";
import {
  addDaysToDateKey,
  formatDate,
  getKoreaToday,
  isFutureKoreaDate,
  isValidDateKey,
} from "@/lib/utils";
import {
  SHIFT_DEADLINE,
  SHIFT_LABEL,
  SHIFT_TYPES,
  type Branch,
  type BranchShiftReport,
  type ShiftType,
} from "@/types";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

/* ══════════════════════════════════════════════════════════════════════════
   본사 지점별 일일보고 현황

   레이아웃 원칙
   ─────────────
   현황표에는 "요약"만 둔다 — 지점명, 제출 상태, 제출 시각, 지연 시간.
   보고 원문은 표 바깥의 넓은 상세 화면에서만 보여준다.

   원문을 표 셀에 넣으면 두 가지 문제가 생긴다.
   1. 좁은 열(전체 폭의 1/4)에 긴 글이 들어가 글자가 과하게 줄바꿈되고 행이 길어진다.
   2. 표가 내용에 따라 열 너비를 자동 계산하므로, 지점명이나 본문 길이에 따라
      지점마다 열 비율이 달라진다. (특정 지점만 넓어 보이는 원인)
   그래서 표는 table-fixed 로 열 너비를 고정하고, 원문은 상세 화면으로 분리했다.
   ══════════════════════════════════════════════════════════════════════════ */

const EMPTY: ShiftMap = { morning: null, closing: null };

export default function AdminShiftReportsPage() {
  const today = getKoreaToday();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [reports, setReports] = useState<BranchShiftReport[]>([]);
  const [date, setDate] = useState(today);
  const [branchFilter, setBranchFilter] = useState("");
  const [detailBranchId, setDetailBranchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAllBranches()
      .then(setBranches)
      .catch((err) => {
        console.error("admin shift reports branches load failed:", err);
        setError("지점 목록을 불러오지 못했습니다.");
      });
  }, []);

  useEffect(() => {
    if (!isValidDateKey(date)) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // 전 지점을 한 번에 읽고 지점 필터는 화면에서 적용한다.
        // (제출/미제출 집계가 필터와 무관하게 같은 원본에서 나오도록)
        const loaded = await getShiftReportsInRange({ from: date, to: date });
        if (!cancelled) setReports(loaded);
      } catch (err) {
        console.error("admin shift reports load failed:", err);
        if (cancelled) return;
        setError("보고 현황을 불러오지 못했습니다.");
        setReports([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date]);

  const rows: BranchRow[] = useMemo(() => {
    const byBranch = new Map<string, ShiftMap>();
    for (const r of reports) {
      const current = byBranch.get(r.branchId) ?? { ...EMPTY };
      current[r.shift] = r;
      byBranch.set(r.branchId, current);
    }

    const now = new Date();
    return branches
      .filter((b) => !branchFilter || b.id === branchFilter)
      .map((branch) => {
        const branchReports = byBranch.get(branch.id) ?? EMPTY;
        return {
          branch,
          reports: branchReports,
          states: {
            morning: resolveSubmissionState(branchReports.morning, date, "morning", now),
            closing: resolveSubmissionState(branchReports.closing, date, "closing", now),
          },
        };
      });
  }, [branches, reports, branchFilter, date]);

  // 제출 집계는 지점 필터와 무관하게 전 지점 기준으로 보여준다
  const summary = useMemo(() => {
    const now = new Date();
    const counts: Record<ShiftType, { submitted: number; late: number; missing: number }> = {
      morning: { submitted: 0, late: 0, missing: 0 },
      closing: { submitted: 0, late: 0, missing: 0 },
    };
    const byBranch = new Map<string, ShiftMap>();
    for (const r of reports) {
      const current = byBranch.get(r.branchId) ?? { ...EMPTY };
      current[r.shift] = r;
      byBranch.set(r.branchId, current);
    }
    for (const branch of branches) {
      const branchReports = byBranch.get(branch.id) ?? EMPTY;
      for (const shift of SHIFT_TYPES) {
        const state = resolveSubmissionState(branchReports[shift], date, shift, now);
        if (state === "on_time" || state === "late") counts[shift].submitted += 1;
        if (state === "late") counts[shift].late += 1;
        if (state === "missing" || state === "draft") counts[shift].missing += 1;
      }
    }
    return counts;
  }, [branches, reports, date]);

  const detailRow = useMemo(
    () => rows.find((r) => r.branch.id === detailBranchId) ?? null,
    [rows, detailBranchId]
  );

  function shiftDate(days: number) {
    const next = addDaysToDateKey(date, days);
    if (isFutureKoreaDate(next)) return;
    setDate(next);
    setDetailBranchId(null);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900">지점별 일일보고 현황</h1>
        <p className="text-xs text-gray-400">
          오전 보고 {SHIFT_DEADLINE.morning} / 마감 보고 {SHIFT_DEADLINE.closing} 기준으로 정시·지연을
          판정합니다.
        </p>
      </div>

      {/* 날짜 · 지점 필터 */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shiftDate(-1)}
            aria-label="이전 날짜"
            className="rounded-lg border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-50"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => {
              const value = e.target.value;
              if (isValidDateKey(value) && !isFutureKoreaDate(value)) {
                setDate(value);
                setDetailBranchId(null);
              }
            }}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
          />
          <button
            type="button"
            onClick={() => shiftDate(1)}
            disabled={date >= today}
            aria-label="다음 날짜"
            className="rounded-lg border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setDate(today);
              setDetailBranchId(null);
            }}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            오늘
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

        <span className="text-xs text-gray-400">
          {formatDate(date)} ({weekdayLabel(date)})
        </span>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      {/* 집계 */}
      <div className="grid grid-cols-2 gap-3">
        {SHIFT_TYPES.map((shift) => (
          <div key={shift} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-gray-500">{SHIFT_LABEL[shift]}</p>
            <p className="mt-1 text-xl font-bold text-gray-900">
              {summary[shift].submitted}
              <span className="text-sm font-normal text-gray-400"> / {branches.length} 제출</span>
            </p>
            <p className="mt-1 text-xs text-gray-500">
              지연 {summary[shift].late}건 · 미제출 {summary[shift].missing}건
            </p>
          </div>
        ))}
      </div>

      {/* 지점별 현황 — 요약만. 원문은 상세 화면에서 본다. */}
      {loading ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
          표시할 지점이 없습니다.
        </p>
      ) : (
        <>
          {/* PC — 열 너비를 고정해 모든 지점이 같은 레이아웃을 쓴다 */}
          <div className="hidden overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm md:block">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[27%]" />
                <col className="w-[27%]" />
                <col className="w-[16%]" />
              </colgroup>
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium">지점</th>
                  <th className="px-4 py-2 font-medium">오전 보고</th>
                  <th className="px-4 py-2 font-medium">마감 보고</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.branch.id}
                    onClick={() => setDetailBranchId(row.branch.id)}
                    className="cursor-pointer border-t border-gray-100 align-top hover:bg-gray-50"
                  >
                    <td className="px-4 py-3">
                      <p className="truncate font-medium text-gray-800">{row.branch.name}</p>
                      <p className="truncate text-xs text-gray-400">{row.branch.brand}</p>
                    </td>

                    {SHIFT_TYPES.map((shift) => (
                      <td key={shift} className="px-4 py-3">
                        <ShiftSummaryCell
                          shift={shift}
                          report={row.reports[shift]}
                          state={row.states[shift]}
                          reportDate={date}
                        />
                      </td>
                    ))}

                    <td className="px-4 py-3 text-right">
                      <span className="inline-block rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600">
                        보고 보기
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 모바일 — 가로 스크롤 없이 화면 폭을 그대로 쓰는 카드 목록 */}
          <div className="space-y-2 md:hidden">
            {rows.map((row) => (
              <button
                key={row.branch.id}
                type="button"
                onClick={() => setDetailBranchId(row.branch.id)}
                className="w-full rounded-xl border border-gray-200 bg-white p-3 text-left shadow-sm active:bg-gray-50"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="min-w-0 truncate font-medium text-gray-800">{row.branch.name}</p>
                  <span className="shrink-0 text-xs text-gray-400">보고 보기</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {SHIFT_TYPES.map((shift) => (
                    <div key={shift} className="rounded-lg bg-gray-50 p-2">
                      <p className="mb-1 text-[11px] text-gray-500">{SHIFT_LABEL[shift]}</p>
                      <ShiftSummaryCell
                        shift={shift}
                        report={row.reports[shift]}
                        state={row.states[shift]}
                        reportDate={date}
                      />
                    </div>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {detailRow && (
        <ReportDetailPanel
          row={detailRow}
          reportDate={date}
          onClose={() => setDetailBranchId(null)}
        />
      )}
    </div>
  );
}
