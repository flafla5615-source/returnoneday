"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getBranchesByIds } from "@/services/branches";
import {
  getShiftReportsForDay,
  resolveSubmissionState,
  saveShiftReport,
  shiftDeadlineAt,
} from "@/services/shiftReports";
import ShiftNotice from "@/components/reports/ShiftNotice";
import { ShiftStateBadge } from "@/components/common/StatusBadge";
import LoadingState from "@/components/common/LoadingState";
import {
  formatDate,
  formatDateTime,
  getKoreaToday,
  getKoreaYesterday,
} from "@/lib/utils";
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
import { HistoryIcon } from "lucide-react";

type ReportMap = Record<ShiftType, BranchShiftReport | null>;

const EMPTY_REPORTS: ReportMap = { morning: null, closing: null };

export default function ManagerShiftReportsPage() {
  const { profile } = useAuth();

  const today = getKoreaToday();
  const yesterday = getKoreaYesterday();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [reportDate, setReportDate] = useState(today);

  const [reports, setReports] = useState<ReportMap>(EMPTY_REPORTS);
  const [drafts, setDrafts] = useState<Record<ShiftType, string>>({ morning: "", closing: "" });
  const [openHistory, setOpenHistory] = useState<Record<ShiftType, boolean>>({
    morning: false,
    closing: false,
  });

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

  // 저장 후 다시 읽어야 하므로 재조회 트리거를 둔다
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

  const selectedBranch = useMemo(
    () => branches.find((b) => b.id === branchId) ?? null,
    [branches, branchId]
  );

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
          ? `${SHIFT_LABEL[shift]}를 제출했습니다.`
          : `${SHIFT_LABEL[shift]}를 임시저장했습니다.`
      );
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("shift report save failed:", err);
      const code = (err as { code?: string })?.code ?? (err as Error)?.message ?? "unknown";
      setError(
        code === "permission-denied"
          ? "작성 권한이 없습니다. 담당 지점과 보고 가능 날짜(오늘·전일)를 확인해주세요."
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

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-lg font-bold text-gray-900">지점별 일일보고</h1>
        <p className="text-xs text-gray-400">오전 보고와 마감 보고를 각각 작성·제출합니다.</p>
      </div>

      <ShiftNotice />

      {/* 지점 · 날짜 선택 */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        {branches.length > 1 && (
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        {branches.length === 1 && (
          <span className="px-1 text-sm font-medium text-gray-700">{branches[0].name}</span>
        )}

        <div className="flex gap-1">
          {[
            { value: today, label: `오늘 (${formatDate(today).slice(5)})` },
            { value: yesterday, label: `전일 (${formatDate(yesterday).slice(5)})` },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setReportDate(opt.value)}
              className={
                reportDate === opt.value
                  ? "rounded-lg bg-[#1e3a5f] px-3 py-1.5 text-sm font-medium text-white"
                  : "rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
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

      {loading ? (
        <LoadingState />
      ) : (
        SHIFT_TYPES.map((shift) => {
          const report = reports[shift];
          const state = resolveSubmissionState(report, reportDate, shift);
          const deadline = shiftDeadlineAt(reportDate, shift);
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
                  <ShiftStateBadge state={state} />
                </div>
                <p className="text-xs text-gray-400">
                  기한 {SHIFT_DEADLINE[shift]} ({formatDate(reportDate)})
                </p>
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
                <div className="flex gap-2">
                  {!isSubmitted && (
                    <button
                      type="button"
                      onClick={() => handleSave(shift, "draft")}
                      disabled={busy}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                    >
                      {busy ? "저장 중..." : "임시저장"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleSave(shift, "submitted")}
                    disabled={busy || (isSubmitted && !dirty)}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-40"
                  >
                    {busy ? "처리 중..." : isSubmitted ? "수정 제출" : "제출"}
                  </button>
                </div>
              </div>

              {report && (
                <div className="space-y-1 border-t border-gray-100 pt-3 text-xs text-gray-500">
                  {report.submittedAt && (
                    <p>
                      제출 {formatDateTime(report.submittedAt.toDate())}
                      {resolveSubmissionState(report, reportDate, shift) === "late" && (
                        <span className="ml-1 text-amber-600">
                          (기한 {formatDateTime(deadline)} 경과)
                        </span>
                      )}
                    </p>
                  )}
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
                      {[...(report.edits ?? [])].reverse().map((edit, i) => (
                        <li key={i} className="rounded-lg bg-gray-50 p-2">
                          <p className="text-[11px] text-gray-500">
                            {formatDateTime(edit.editedAt.toDate())} · {edit.editedByName}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-[11px] text-gray-600">
                            {edit.previousContent || "(이전 내용 없음)"}
                          </p>
                        </li>
                      ))}
                      {report.editCount > (report.edits?.length ?? 0) && (
                        <li className="text-[11px] text-gray-400">
                          오래된 이력 {report.editCount - (report.edits?.length ?? 0)}건은 보관
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
    </div>
  );
}
