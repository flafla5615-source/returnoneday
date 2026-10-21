"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getBranchesByIds } from "@/services/branches";
import {
  getWeeklyReport,
  getWeeklyReportsInRange,
  resolveWeeklyState,
  saveWeeklyReport,
} from "@/services/weeklyReports";
import {
  currentWeekStart,
  isWritableWeek,
  listWeekStartsDesc,
  shiftWeek,
  weekOfMonthLabel,
  weekRangeLabel,
} from "@/lib/weekSchedule";
import {
  WeeklyReportDetailPanel,
  WeeklyStateBadge,
  WideTextEditorPanel,
} from "@/components/reports/WeeklyReportViews";
import LoadingState from "@/components/common/LoadingState";
import { formatDateTime } from "@/lib/utils";
import {
  WEEKLY_CONTENT_MAX_LENGTH,
  type Branch,
  type BranchWeeklyReport,
  type WeeklyReportStatus,
} from "@/types";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  HistoryIcon,
  Maximize2Icon,
  PencilIcon,
} from "lucide-react";

type Tab = "write" | "history";

const HISTORY_RANGES = [
  { weeks: 8, label: "최근 8주" },
  { weeks: 16, label: "최근 16주" },
  { weeks: 52, label: "최근 1년" },
];

export default function ManagerWeeklyReportsPage() {
  const { profile } = useAuth();
  const thisWeek = currentWeekStart();

  const [tab, setTab] = useState<Tab>("write");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [weekStart, setWeekStart] = useState(thisWeek);

  const [report, setReport] = useState<BranchWeeklyReport | null>(null);
  const [draft, setDraft] = useState("");
  const [wideOpen, setWideOpen] = useState(false);

  const [historyWeeks, setHistoryWeeks] = useState(8);
  const [historyReports, setHistoryReports] = useState<BranchWeeklyReport[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [detailWeek, setDetailWeek] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<WeeklyReportStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    getBranchesByIds(profile.branchIds)
      .then((bs) => {
        setBranches(bs);
        if (bs.length > 0) setBranchId((prev) => prev || bs[0].id);
        else setLoading(false);
      })
      .catch((err) => {
        console.error("weekly report branches load failed:", err);
        setError("지점 정보를 불러오지 못했습니다.");
        setLoading(false);
      });
  }, [profile]);

  // 선택한 주차의 보고
  useEffect(() => {
    if (!branchId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const loaded = await getWeeklyReport(branchId, weekStart);
        if (cancelled) return;
        setReport(loaded);
        setDraft(loaded?.content ?? "");
      } catch (err) {
        console.error("weekly report load failed:", err);
        if (cancelled) return;
        setError("주간보고를 불러오지 못했습니다.");
        setReport(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [branchId, weekStart, reloadKey]);

  // 지난 보고 내역 (내역 탭에서만)
  useEffect(() => {
    if (!branchId || tab !== "history") return;
    let cancelled = false;
    (async () => {
      setHistoryLoading(true);
      try {
        const from = shiftWeek(thisWeek, -(historyWeeks - 1));
        const loaded = await getWeeklyReportsInRange({
          fromWeekStart: from,
          toWeekStart: thisWeek,
          branchId,
        });
        if (!cancelled) setHistoryReports(loaded);
      } catch (err) {
        console.error("weekly history load failed:", err);
        if (!cancelled) setError("지난 주간보고를 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [branchId, tab, historyWeeks, thisWeek, reloadKey]);

  const selectedBranch = useMemo(
    () => branches.find((b) => b.id === branchId) ?? null,
    [branches, branchId]
  );

  // 보고가 없는 주차도 보여줘야 빠뜨린 주가 드러난다
  const historyRows = useMemo(() => {
    const byWeek = new Map(historyReports.map((r) => [r.weekStartDate, r]));
    return listWeekStartsDesc(shiftWeek(thisWeek, -(historyWeeks - 1)), thisWeek).map((week) => ({
      week,
      report: byWeek.get(week) ?? null,
    }));
  }, [historyReports, historyWeeks, thisWeek]);

  const detailReport = useMemo(
    () => historyRows.find((r) => r.week === detailWeek)?.report ?? null,
    [historyRows, detailWeek]
  );

  function goToWeek(next: string) {
    if (!isWritableWeek(next)) return;
    setWeekStart(next);
    setNotice(null);
    setError(null);
  }

  async function handleSave(status: WeeklyReportStatus) {
    if (!profile || !selectedBranch) return;

    const content = draft.trim();
    if (status === "submitted" && content.length === 0) {
      setError("주간보고 내용을 입력해주세요.");
      return;
    }

    setSaving(status);
    setError(null);
    setNotice(null);
    try {
      await saveWeeklyReport({
        branchId: selectedBranch.id,
        branchName: selectedBranch.name,
        weekStartDate: weekStart,
        content,
        status,
        uid: profile.uid,
        name: profile.name,
      });
      setNotice(
        status === "submitted"
          ? `${weekRangeLabel(weekStart)} 주간보고를 제출했습니다.`
          : `${weekRangeLabel(weekStart)} 주간보고를 임시저장했습니다.`
      );
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("weekly report save failed:", err);
      const code = (err as { code?: string })?.code ?? (err as Error)?.message ?? "unknown";
      setError(
        code === "permission-denied"
          ? "작성 권한이 없습니다. 담당 지점인지 확인해주세요. (미래 주차는 작성할 수 없습니다)"
          : code === "content-empty"
            ? "주간보고 내용을 입력해주세요."
            : code === "content-too-long"
              ? `내용은 ${WEEKLY_CONTENT_MAX_LENGTH.toLocaleString("ko-KR")}자를 넘을 수 없습니다.`
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

  const isThisWeek = weekStart === thisWeek;
  const isSubmitted = report?.status === "submitted";
  const dirty = (report?.content ?? "") !== draft;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900">주간보고</h1>
        <p className="text-xs text-gray-400">월요일 ~ 일요일 기준으로 한 주를 작성합니다.</p>
      </div>

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
          <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => goToWeek(shiftWeek(weekStart, -1))}
                aria-label="이전 주"
                className="rounded-lg border border-gray-200 p-2.5 text-gray-600 hover:bg-gray-50"
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </button>

              <div className="flex-1 text-center">
                <p className="text-sm font-semibold text-gray-800">{weekRangeLabel(weekStart)}</p>
                <p className="text-xs text-gray-400">
                  {weekOfMonthLabel(weekStart)}
                  {isThisWeek && " · 이번 주"}
                </p>
              </div>

              <button
                type="button"
                onClick={() => goToWeek(shiftWeek(weekStart, 1))}
                disabled={isThisWeek}
                aria-label="다음 주"
                className="rounded-lg border border-gray-200 p-2.5 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                <ChevronRightIcon className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() => goToWeek(thisWeek)}
                disabled={isThisWeek}
                className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                이번 주
              </button>
            </div>
          </div>

          {!isThisWeek && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              지난 주차 보고를 작성 중입니다. 보고 주차({weekRangeLabel(weekStart)})와 실제 제출
              시각은 따로 기록됩니다.
            </p>
          )}

          {loading ? (
            <LoadingState />
          ) : (
            <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-gray-800">주간보고</h2>
                  <WeeklyStateBadge state={resolveWeeklyState(report)} />
                </div>
                <button
                  type="button"
                  onClick={() => setWideOpen(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                >
                  <Maximize2Icon className="h-3.5 w-3.5" />
                  넓게 작성
                </button>
              </div>

              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onClick={() => setWideOpen(true)}
                maxLength={WEEKLY_CONTENT_MAX_LENGTH}
                rows={10}
                placeholder="이번 주 운영 내용을 자유롭게 작성해주세요. (클릭하면 넓은 작성 화면이 열립니다)"
                className="w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-red-500"
              />

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-gray-400">
                  {draft.length.toLocaleString("ko-KR")} /{" "}
                  {WEEKLY_CONTENT_MAX_LENGTH.toLocaleString("ko-KR")}자
                </p>
                <div className="flex flex-1 gap-2 sm:flex-none">
                  {!isSubmitted && (
                    <button
                      type="button"
                      onClick={() => handleSave("draft")}
                      disabled={saving !== null}
                      className="flex-1 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 sm:flex-none"
                    >
                      {saving === "draft" ? "저장 중..." : "임시저장"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleSave("submitted")}
                    disabled={saving !== null || !draft.trim() || (isSubmitted && !dirty)}
                    className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40 sm:flex-none"
                  >
                    {saving === "submitted" ? "처리 중..." : isSubmitted ? "수정 제출" : "제출"}
                  </button>
                </div>
              </div>

              {report && (
                <div className="space-y-1 border-t border-gray-100 pt-3 text-xs text-gray-500">
                  <p>
                    {report.submittedAt
                      ? `최초 제출 ${formatDateTime(report.submittedAt.toDate())}`
                      : "임시저장 (미제출)"}
                    {report.editCount > 0 &&
                      report.updatedAt &&
                      ` · 최종 수정 ${formatDateTime(report.updatedAt.toDate())} (${report.editCount}회)`}
                  </p>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {/* ─── 지난 보고 내역 ─────────────────────────────────────────── */}
      {tab === "history" && (
        <>
          <div className="flex gap-1 rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
            {HISTORY_RANGES.map((r) => (
              <button
                key={r.weeks}
                type="button"
                onClick={() => setHistoryWeeks(r.weeks)}
                className={
                  historyWeeks === r.weeks
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
              {historyRows.map((row) => (
                <div key={row.week} className="flex items-center gap-2 px-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-800">
                      {weekRangeLabel(row.week)}
                    </p>
                    <p className="text-xs text-gray-400">
                      {weekOfMonthLabel(row.week)}
                      {row.report?.submittedAt &&
                        ` · 제출 ${formatDateTime(row.report.submittedAt.toDate())}`}
                    </p>
                  </div>
                  <WeeklyStateBadge state={resolveWeeklyState(row.report)} />
                  <button
                    type="button"
                    onClick={() =>
                      row.report ? setDetailWeek(row.week) : (goToWeek(row.week), setTab("write"))
                    }
                    className="shrink-0 rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    {row.report ? "보기" : "작성"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {wideOpen && (
        <WideTextEditorPanel
          title="주간보고 작성"
          subtitle={`${selectedBranch?.name ?? ""} · ${weekRangeLabel(weekStart)}`}
          value={draft}
          maxLength={WEEKLY_CONTENT_MAX_LENGTH}
          onChange={setDraft}
          onClose={() => setWideOpen(false)}
        />
      )}

      {detailWeek && (
        <WeeklyReportDetailPanel
          title={selectedBranch?.name ?? "주간보고"}
          subtitle={weekRangeLabel(detailWeek)}
          report={detailReport}
          weekStartDate={detailWeek}
          onClose={() => setDetailWeek(null)}
        />
      )}
    </div>
  );
}
