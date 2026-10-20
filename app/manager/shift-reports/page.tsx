"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getBranchesByIds } from "@/services/branches";
import { getShiftReportsForDay, getShiftReportsInRange, saveShiftReport } from "@/services/shiftReports";
import {
  describeSubmission,
  editVersionTime,
  formatLateDuration,
  isWritableReportDate,
  listDateKeysDesc,
  resolveSubmissionState,
  shiftDateKey,
  weekdayLabel,
} from "@/lib/shiftSchedule";
import ShiftNotice from "@/components/reports/ShiftNotice";
import { ShiftStateBadge } from "@/components/common/StatusBadge";
import LoadingState from "@/components/common/LoadingState";
import { formatDate, formatDateTime, getKoreaToday, isValidDateKey } from "@/lib/utils";
import {
  SHIFT_CONTENT_MAX_LENGTH,
  SHIFT_DEADLINE,
  SHIFT_LABEL,
  SHIFT_TYPES,
  type Branch,
  type BranchShiftReport,
  type ShiftReportStatus,
  type ShiftType,
} from "@/types";
import {
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  HistoryIcon,
  PencilIcon,
} from "lucide-react";

type ReportMap = Record<ShiftType, BranchShiftReport | null>;
type Tab = "write" | "history";

const EMPTY_REPORTS: ReportMap = { morning: null, closing: null };

const HISTORY_RANGES = [
  { days: 7, label: "최근 7일" },
  { days: 30, label: "최근 30일" },
  { days: 90, label: "최근 90일" },
];

export default function ManagerShiftReportsPage() {
  const { profile } = useAuth();
  const today = getKoreaToday();

  const [tab, setTab] = useState<Tab>("write");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [reportDate, setReportDate] = useState(today);

  const [reports, setReports] = useState<ReportMap>(EMPTY_REPORTS);
  const [drafts, setDrafts] = useState<Record<ShiftType, string>>({ morning: "", closing: "" });
  const [openHistory, setOpenHistory] = useState<Record<ShiftType, boolean>>({
    morning: false,
    closing: false,
  });

  const [historyDays, setHistoryDays] = useState(7);
  const [historyReports, setHistoryReports] = useState<BranchShiftReport[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<ShiftType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 담당 지점 로드
  useEffect(() => {
    if (!profile) return;
    getBranchesByIds(profile.branchIds)
      .then((bs) => {
        setBranches(bs);
        if (bs.length > 0) setBranchId((prev) => prev || bs[0].id);
        else setLoading(false);
      })
      .catch((err) => {
        console.error("shift report branches load failed:", err);
        setError("지점 정보를 불러오지 못했습니다.");
        setLoading(false);
      });
  }, [profile]);

  // 선택한 날짜의 오전·마감 보고
  useEffect(() => {
    if (!branchId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const loaded = await getShiftReportsForDay(branchId, reportDate);
        if (cancelled) return;
        setReports(loaded);
        setDrafts({
          morning: loaded.morning?.content ?? "",
          closing: loaded.closing?.content ?? "",
        });
        setOpenHistory({ morning: false, closing: false });
      } catch (err) {
        console.error("shift reports load failed:", err);
        if (cancelled) return;
        setError("보고 내용을 불러오지 못했습니다.");
        setReports(EMPTY_REPORTS);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [branchId, reportDate, reloadKey]);

  // 지난 보고 내역 (내역 탭에서만 조회)
  useEffect(() => {
    if (!branchId || tab !== "history") return;
    let cancelled = false;
    (async () => {
      setHistoryLoading(true);
      try {
        const from = shiftDateKey(today, -(historyDays - 1));
        const loaded = await getShiftReportsInRange({ from, to: today, branchId });
        if (!cancelled) setHistoryReports(loaded);
      } catch (err) {
        console.error("shift report history load failed:", err);
        if (!cancelled) setError("지난 보고 내역을 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [branchId, tab, historyDays, today, reloadKey]);

  const selectedBranch = useMemo(
    () => branches.find((b) => b.id === branchId) ?? null,
    [branches, branchId]
  );

  // 내역 탭: 기간 내 모든 날짜를 최신순으로 세우고 보고를 붙인다.
  // 보고가 없는 날짜도 보여줘야 빠뜨린 날이 드러난다.
  const historyRows = useMemo(() => {
    const byDate = new Map<string, ReportMap>();
    for (const r of historyReports) {
      const current = byDate.get(r.reportDate) ?? { ...EMPTY_REPORTS };
      current[r.shift] = r;
      byDate.set(r.reportDate, current);
    }
    const now = new Date();
    return listDateKeysDesc(shiftDateKey(today, -(historyDays - 1)), today).map((date) => {
      const dayReports = byDate.get(date) ?? EMPTY_REPORTS;
      return {
        date,
        reports: dayReports,
        states: {
          morning: resolveSubmissionState(dayReports.morning, date, "morning", now),
          closing: resolveSubmissionState(dayReports.closing, date, "closing", now),
        },
      };
    });
  }, [historyReports, historyDays, today]);

  function goToDate(date: string) {
    if (!isValidDateKey(date) || !isWritableReportDate(date)) return;
    setReportDate(date);
    setNotice(null);
    setError(null);
  }

  async function handleSave(shift: ShiftType, status: ShiftReportStatus) {
    if (!profile || !selectedBranch) return;

    const content = drafts[shift].trim();
    if (status === "submitted" && content.length === 0) {
      setError(`${SHIFT_LABEL[shift]} 내용을 입력해주세요.`);
      return;
    }

    setSaving(shift);
    setError(null);
    setNotice(null);
    try {
      await saveShiftReport({
        branchId: selectedBranch.id,
        branchName: selectedBranch.name,
        reportDate,
        shift,
        content,
        status,
        writerUid: profile.uid,
        writerName: profile.name,
      });
      setNotice(
        status === "submitted"
          ? `${formatDate(reportDate)} ${SHIFT_LABEL[shift]}를 제출했습니다.`
          : `${formatDate(reportDate)} ${SHIFT_LABEL[shift]}를 임시저장했습니다.`
      );
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("shift report save failed:", err);
      const code = (err as { code?: string })?.code ?? (err as Error)?.message ?? "unknown";
      setError(
        code === "permission-denied"
          ? "작성 권한이 없습니다. 담당 지점인지 확인해주세요. (미래 날짜는 작성할 수 없습니다)"
          : code === "content-too-long"
            ? `내용은 ${SHIFT_CONTENT_MAX_LENGTH.toLocaleString("ko-KR")}자를 넘을 수 없습니다.`
            : "저장하지 못했습니다. 잠시 후 다시 시도해주세요."
      );
    } finally {
      setSaving(null);
    }
  }

  if (!profile) return <LoadingState />;

  if (branches.length === 0 && !loading) {
    return (
      <div className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-6">
        <p className="text-sm font-semibold text-amber-700">배정된 지점 없음</p>
        <p className="text-sm text-amber-600">관리자에게 지점 배정을 요청하세요.</p>
      </div>
    );
  }

  const isToday = reportDate === today;
  const daysBack = listDateKeysDesc(reportDate, today).length - 1;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900">지점별 일일보고</h1>
        <p className="text-xs text-gray-400">오전 보고와 마감 보고를 각각 작성·제출합니다.</p>
      </div>

      <ShiftNotice />

      {/* 지점 선택 */}
      {branches.length > 1 && (
        <select
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 sm:w-auto"
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}

      {/* 탭 */}
      <div className="flex rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
        {(
          [
            { key: "write", label: "보고 작성", icon: PencilIcon },
            { key: "history", label: "지난 보고 내역", icon: HistoryIcon },
          ] as const
        ).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={
              tab === key
                ? "flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#1e3a5f] px-3 py-2.5 text-sm font-semibold text-white"
                : "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm text-gray-500 hover:bg-gray-50"
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {notice}
        </p>
      )}

      {/* ─── 보고 작성 ─────────────────────────────────────────────── */}
      {tab === "write" && (
        <>
          {/* 날짜 선택 */}
          <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => goToDate(shiftDateKey(reportDate, -1))}
                aria-label="이전 날짜"
                className="rounded-lg border border-gray-200 p-2.5 text-gray-600 hover:bg-gray-50"
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </button>

              <label className="relative flex flex-1 items-center">
                <CalendarDaysIcon className="pointer-events-none absolute left-3 h-4 w-4 text-gray-400" />
                <input
                  type="date"
                  value={reportDate}
                  max={today}
                  onChange={(e) => goToDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 py-2.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </label>

              <button
                type="button"
                onClick={() => goToDate(shiftDateKey(reportDate, 1))}
                disabled={isToday}
                aria-label="다음 날짜"
                className="rounded-lg border border-gray-200 p-2.5 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                <ChevronRightIcon className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() => goToDate(today)}
                disabled={isToday}
                className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                오늘
              </button>
            </div>

            <p className="text-center text-xs text-gray-500">
              보고일 <span className="font-semibold text-gray-700">{formatDate(reportDate)}</span> (
              {weekdayLabel(reportDate)})
            </p>
          </div>

          {/* 소급 작성 안내 */}
          {!isToday && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {daysBack}일 지난 보고일입니다. 지금 제출하면 <strong>지연 제출</strong>로 기록되며,
              보고일({formatDate(reportDate)})과 실제 제출 시각이 따로 남습니다.
            </p>
          )}

          {loading ? (
            <LoadingState />
          ) : (
            SHIFT_TYPES.map((shift) => {
              const report = reports[shift];
              const info = describeSubmission(report, reportDate, shift);
              const isSubmitted = report?.status === "submitted";
              const busy = saving === shift;
              const dirty = (report?.content ?? "") !== drafts[shift];

              return (
                <section
                  key={shift}
                  className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-semibold text-gray-800">{SHIFT_LABEL[shift]}</h2>
                      <ShiftStateBadge state={info.state} />
                      {info.backdated && (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                          소급 작성
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">기한 {SHIFT_DEADLINE[shift]}</p>
                  </div>

                  <textarea
                    value={drafts[shift]}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [shift]: e.target.value }))}
                    maxLength={SHIFT_CONTENT_MAX_LENGTH}
                    rows={7}
                    placeholder={
                      shift === "morning"
                        ? "오전 상황을 자유롭게 작성해주세요."
                        : "마감 상황을 자유롭게 작성해주세요."
                    }
                    className="w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-red-500"
                  />

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-gray-400">
                      {drafts[shift].length.toLocaleString("ko-KR")} /{" "}
                      {SHIFT_CONTENT_MAX_LENGTH.toLocaleString("ko-KR")}자
                    </p>
                    <div className="flex flex-1 gap-2 sm:flex-none">
                      {!isSubmitted && (
                        <button
                          type="button"
                          onClick={() => handleSave(shift, "draft")}
                          disabled={busy}
                          className="flex-1 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 sm:flex-none"
                        >
                          {busy ? "저장 중..." : "임시저장"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleSave(shift, "submitted")}
                        disabled={busy || (isSubmitted && !dirty)}
                        className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-40 sm:flex-none"
                      >
                        {busy ? "처리 중..." : isSubmitted ? "수정 제출" : "제출"}
                      </button>
                    </div>
                  </div>

                  {report && (
                    <div className="space-y-1 border-t border-gray-100 pt-3 text-xs text-gray-500">
                      <p>
                        보고일 {formatDate(report.reportDate)}
                        {info.submittedAt && (
                          <>
                            {" · "}최초 제출 {formatDateTime(info.submittedAt)}
                            {info.lateByMs > 0 && (
                              <span className="ml-1 text-amber-600">
                                ({formatLateDuration(info.lateByMs)} 지연)
                              </span>
                            )}
                            {info.backdated && (
                              <span className="ml-1 text-amber-600">
                                ({info.daysAfterReportDate}일 뒤 소급)
                              </span>
                            )}
                          </>
                        )}
                      </p>
                      {report.editCount > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setOpenHistory((prev) => ({ ...prev, [shift]: !prev[shift] }))
                          }
                          className="flex items-center gap-1 text-gray-500 hover:text-gray-700"
                        >
                          <HistoryIcon className="h-3 w-3" />
                          수정 {report.editCount}회 {openHistory[shift] ? "접기" : "보기"}
                        </button>
                      )}
                      {openHistory[shift] && (
                        <ul className="space-y-2 pt-1">
                          {report.updatedAt && (
                            <li className="rounded-lg border border-gray-200 bg-white p-2">
                              <p className="text-[11px] font-medium text-gray-600">
                                현재 내용 · 최종 수정 {formatDateTime(report.updatedAt.toDate())}
                              </p>
                            </li>
                          )}
                          {[...(report.edits ?? [])].reverse().map((edit, i) => {
                            const t = editVersionTime(edit);
                            return (
                              <li key={i} className="rounded-lg bg-gray-50 p-2">
                                <p className="text-[11px] text-gray-500">
                                  {t.at ? `${formatDateTime(t.at)} 저장본` : "저장 시각 기록 없음"}
                                  {t.at && t.fromDeviceClock && (
                                    <span className="text-gray-400"> (기기 시각)</span>
                                  )}
                                  {` · 수정자 ${edit.editedByName}`}
                                </p>
                                <p className="mt-1 whitespace-pre-wrap text-[11px] text-gray-600">
                                  {edit.previousContent || "(이전 내용 없음)"}
                                </p>
                              </li>
                            );
                          })}
                          {report.editCount > (report.edits ?? []).length && (
                            <li className="text-[11px] text-gray-400">
                              오래된 이력 {report.editCount - (report.edits ?? []).length}건은 보관
                              한도를 넘어 본문이 남아 있지 않습니다.
                            </li>
                          )}
                        </ul>
                      )}
                    </div>
                  )}
                </section>
              );
            })
          )}
        </>
      )}

      {/* ─── 지난 보고 내역 ─────────────────────────────────────────── */}
      {tab === "history" && (
        <>
          <div className="flex gap-1 rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
            {HISTORY_RANGES.map((r) => (
              <button
                key={r.days}
                type="button"
                onClick={() => setHistoryDays(r.days)}
                className={
                  historyDays === r.days
                    ? "flex-1 rounded-lg bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-800"
                    : "flex-1 rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-50"
                }
              >
                {r.label}
              </button>
            ))}
          </div>

          {historyLoading ? (
            <LoadingState />
          ) : (
            <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              {historyRows.map((row) => {
                const isOpen = expandedDate === row.date;
                const hasAny = SHIFT_TYPES.some((s) => row.reports[s]);
                return (
                  <div key={row.date}>
                    <button
                      type="button"
                      onClick={() => setExpandedDate(isOpen ? null : row.date)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-3 text-left hover:bg-gray-50"
                    >
                      <span className="shrink-0 text-sm font-medium text-gray-800">
                        {formatDate(row.date).slice(5)}
                        <span className="ml-1 text-xs font-normal text-gray-400">
                          ({weekdayLabel(row.date)})
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center justify-end gap-1">
                        {SHIFT_TYPES.map((shift) => (
                          <span key={shift} className="flex items-center gap-1">
                            <span className="text-[11px] text-gray-400">
                              {shift === "morning" ? "오전" : "마감"}
                            </span>
                            <ShiftStateBadge state={row.states[shift]} />
                          </span>
                        ))}
                      </span>
                    </button>

                    {isOpen && (
                      <div className="space-y-2 bg-gray-50 px-3 pb-3">
                        {SHIFT_TYPES.map((shift) => {
                          const report = row.reports[shift];
                          const info = describeSubmission(report, row.date, shift);
                          return (
                            <div
                              key={shift}
                              className="rounded-lg border border-gray-200 bg-white p-2.5"
                            >
                              <p className="mb-1 text-xs font-semibold text-gray-600">
                                {SHIFT_LABEL[shift]}
                              </p>
                              {report ? (
                                <>
                                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-gray-700">
                                    {report.content || "(내용 없음)"}
                                  </p>
                                  <p className="mt-2 text-[11px] text-gray-400">
                                    {info.submittedAt
                                      ? `최초 제출 ${formatDateTime(info.submittedAt)}`
                                      : "임시저장 (미제출)"}
                                    {info.lateByMs > 0 &&
                                      ` · ${formatLateDuration(info.lateByMs)} 지연`}
                                    {info.backdated && ` · ${info.daysAfterReportDate}일 뒤 소급`}
                                    {report.editCount > 0 && ` · 수정 ${report.editCount}회`}
                                  </p>
                                </>
                              ) : (
                                <p className="text-xs text-gray-400">작성된 보고가 없습니다.</p>
                              )}
                            </div>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() => {
                            goToDate(row.date);
                            setTab("write");
                          }}
                          className="w-full rounded-lg bg-[#1e3a5f] py-2.5 text-sm font-semibold text-white hover:bg-[#16304f]"
                        >
                          {hasAny ? "이 날짜 보고 수정하기" : "이 날짜 보고 작성하기"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
