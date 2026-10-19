"use client";

import { useEffect, useMemo, useState } from "react";
import { getAllBranches } from "@/services/branches";
import { getShiftReportsInRange } from "@/services/shiftReports";
import { describeSubmission, resolveSubmissionState, weekdayLabel } from "@/lib/shiftSchedule";
import { ShiftStateBadge } from "@/components/common/StatusBadge";
import LoadingState from "@/components/common/LoadingState";
import {
  addDaysToDateKey,
  formatDate,
  formatDateTime,
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
  type ShiftSubmissionState,
  type ShiftType,
} from "@/types";
import { ChevronLeftIcon, ChevronRightIcon, HistoryIcon } from "lucide-react";

type ShiftMap = Record<ShiftType, BranchShiftReport | null>;

interface BranchRow {
  branch: Branch;
  reports: ShiftMap;
  states: Record<ShiftType, ShiftSubmissionState>;
}

const EMPTY: ShiftMap = { morning: null, closing: null };

export default function AdminShiftReportsPage() {
  const today = getKoreaToday();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [reports, setReports] = useState<BranchShiftReport[]>([]);
  const [date, setDate] = useState(today);
  const [branchFilter, setBranchFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
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

  function shiftDate(days: number) {
    const next = addDaysToDateKey(date, days);
    if (isFutureKoreaDate(next)) return;
    setDate(next);
    setExpanded(null);
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
                setExpanded(null);
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
              setExpanded(null);
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

      {/* 지점별 현황 */}
      {loading ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
          표시할 지점이 없습니다.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium">지점</th>
                  <th className="px-4 py-2 font-medium">오전 보고</th>
                  <th className="px-4 py-2 font-medium">마감 보고</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isOpen = expanded === row.branch.id;
                  const hasContent = SHIFT_TYPES.some((s) => row.reports[s]);
                  return (
                    <tr
                      key={row.branch.id}
                      className="border-t border-gray-100 align-top"
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-800">{row.branch.name}</p>
                        <p className="text-xs text-gray-400">{row.branch.brand}</p>

                        {isOpen && (
                          <div className="mt-3 space-y-3 md:hidden">
                            {SHIFT_TYPES.map((shift) => (
                              <ShiftDetail
                                key={shift}
                                shift={shift}
                                report={row.reports[shift]}
                                reportDate={date}
                              />
                            ))}
                          </div>
                        )}
                      </td>

                      {SHIFT_TYPES.map((shift) => {
                        const report = row.reports[shift];
                        return (
                          <td key={shift} className="px-4 py-3">
                            <ShiftStateBadge state={row.states[shift]} />
                            {(() => {
                              const info = describeSubmission(report, date, shift);
                              if (!info.submittedAt) return null;
                              return (
                                <>
                                  <p className="mt-1 text-xs text-gray-400">
                                    제출 {formatDateTime(info.submittedAt)}
                                  </p>
                                  {info.backdated && (
                                    <p className="mt-0.5 text-[11px] text-amber-600">
                                      소급 작성 ({info.daysAfterReportDate}일 뒤)
                                    </p>
                                  )}
                                </>
                              );
                            })()}
                            {!!report?.editCount && (
                              <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-400">
                                <HistoryIcon className="h-3 w-3" />
                                수정 {report.editCount}회
                              </p>
                            )}
                            {isOpen && (
                              <div className="mt-2 hidden md:block">
                                <ShiftDetail shift={shift} report={report} reportDate={date} hideTitle />
                              </div>
                            )}
                          </td>
                        );
                      })}

                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : row.branch.id)}
                          disabled={!hasContent}
                          className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                        >
                          {isOpen ? "접기" : "원문"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/** 보고 원문 + 수정 이력 */
function ShiftDetail({
  shift,
  report,
  reportDate,
  hideTitle,
}: {
  shift: ShiftType;
  report: BranchShiftReport | null;
  reportDate: string;
  hideTitle?: boolean;
}) {
  const [showHistory, setShowHistory] = useState(false);

  if (!report) {
    return (
      <div className="rounded-lg bg-gray-50 p-2 text-xs text-gray-400">
        {!hideTitle && <p className="mb-1 font-medium text-gray-500">{SHIFT_LABEL[shift]}</p>}
        작성된 보고가 없습니다.
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-gray-50 p-2">
      {!hideTitle && (
        <p className="mb-1 text-xs font-medium text-gray-500">{SHIFT_LABEL[shift]}</p>
      )}
      <p className="whitespace-pre-wrap text-xs leading-relaxed text-gray-700">
        {report.content || "(내용 없음)"}
      </p>
      {(() => {
        const info = describeSubmission(report, reportDate, shift);
        return (
          <p className="mt-2 text-[11px] text-gray-400">
            보고일 {formatDate(report.reportDate)}
            {info.submittedAt
              ? ` · 최초 제출 ${formatDateTime(info.submittedAt)}`
              : " · 임시저장 (미제출)"}
            {info.backdated && ` · ${info.daysAfterReportDate}일 뒤 소급 작성`}
            {` · 작성자 ${report.writerName}`}
          </p>
        );
      })()}

      {report.editCount > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="mt-1 text-[11px] text-gray-500 underline hover:text-gray-700"
          >
            수정 이력 {report.editCount}회 {showHistory ? "접기" : "보기"}
          </button>
          {showHistory && (
            <ul className="mt-1 space-y-1.5">
              {[...(report.edits ?? [])].reverse().map((edit, i) => (
                <li key={i} className="rounded border border-gray-200 bg-white p-1.5">
                  <p className="text-[11px] text-gray-500">
                    {formatDateTime(edit.editedAt.toDate())} · {edit.editedByName}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap text-[11px] text-gray-600">
                    {edit.previousContent || "(이전 내용 없음)"}
                  </p>
                </li>
              ))}
              {report.editCount > (report.edits ?? []).length && (
                <li className="text-[11px] text-gray-400">
                  오래된 이력 {report.editCount - (report.edits ?? []).length}건은 보관 한도를 넘어
                  본문이 남아 있지 않습니다.
                </li>
              )}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
