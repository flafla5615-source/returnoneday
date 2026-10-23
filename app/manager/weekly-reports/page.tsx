"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getBranchesByIds } from "@/services/branches";
import {
  checkStorageAvailable,
  deleteWeeklyFile,
  getWeeklyReport,
  getWeeklyReportsInRange,
  resolveWeeklyState,
  submitWeeklyReport,
  uploadWeeklyFile,
} from "@/services/weeklyReports";
import { describeStorageError, STORAGE_SETUP_GUIDE } from "@/lib/storageErrors";
import {
  currentWeekStart,
  isWritableWeek,
  listWeekStartsDesc,
  shiftWeek,
  weekOfMonthLabel,
  weekRangeLabel,
} from "@/lib/weekSchedule";
import {
  WEEKLY_FILE_MAX_COUNT,
  WEEKLY_FILE_MAX_BYTES,
  formatFileSize,
} from "@/lib/weeklyFiles";
import {
  PdfPreviewPanel,
  WeeklyFileList,
  WeeklyReportDetailPanel,
  WeeklyStateBadge,
} from "@/components/reports/WeeklyReportViews";
import LoadingState from "@/components/common/LoadingState";
import { formatDateTime } from "@/lib/utils";
import type { Branch, BranchWeeklyReport, WeeklyReportFile } from "@/types";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  HistoryIcon,
  PaperclipIcon,
  PencilIcon,
  RefreshCwIcon,
  UploadIcon,
  AlertTriangleIcon,
} from "lucide-react";

type Tab = "write" | "history";

interface UploadJob {
  key: string;
  /** 재시도할 수 있도록 원본 File 을 들고 있는다 */
  file: File;
  name: string;
  size: number;
  percent: number;
  status: "uploading" | "failed";
  message?: string;
  /** Firebase 오류 코드 — 화면에 그대로 보여준다 */
  code?: string;
  retryable?: boolean;
}

const HISTORY_RANGES = [
  { weeks: 8, label: "최근 8주" },
  { weeks: 16, label: "최근 16주" },
  { weeks: 52, label: "최근 1년" },
];

export default function ManagerWeeklyReportsPage() {
  const { profile } = useAuth();
  const thisWeek = currentWeekStart();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<Tab>("write");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [weekStart, setWeekStart] = useState(thisWeek);

  const [report, setReport] = useState<BranchWeeklyReport | null>(null);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<WeeklyReportFile | null>(null);

  const [historyWeeks, setHistoryWeeks] = useState(8);
  const [historyReports, setHistoryReports] = useState<BranchWeeklyReport[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [detailWeek, setDetailWeek] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Storage 설정 문제를 업로드 전에 미리 알려준다.
  // blocking=false 는 "확인 실패"라 단정할 수 없는 경우로, 업로드를 막지 않는다.
  const [storageIssue, setStorageIssue] = useState<
    { code: string; message: string; blocking: boolean; needsSetup: boolean } | null
  >(null);
  const [storageChecking, setStorageChecking] = useState(true);

  useEffect(() => {
    if (!profile) return;
    getBranchesByIds(profile.branchIds)
      .then((bs) => {
        setBranches(bs);
        if (bs.length > 0) setBranchId((prev) => prev || bs[0].id);
        else setLoading(false);
      })
      .catch((err) => {
        console.error("weekly branches load failed:", err);
        setError("지점 정보를 불러오지 못했습니다.");
        setLoading(false);
      });
  }, [profile]);

  useEffect(() => {
    if (!branchId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const loaded = await getWeeklyReport(branchId, weekStart);
        if (!cancelled) setReport(loaded);
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

  async function runStorageCheck() {
    setStorageChecking(true);
    try {
      const result = await checkStorageAvailable({ timeoutMs: 0 });
      setStorageIssue(
        result.available
          ? null
          : {
              code: result.code,
              message: describeStorageError(result.code).message,
              blocking: !result.timedOut,
              needsSetup: describeStorageError(result.code).needsSetup,
            }
      );
    } finally {
      setStorageChecking(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const apply = (result: Awaited<ReturnType<typeof checkStorageAvailable>>) => {
      if (cancelled) return;
      setStorageIssue(
        result.available
          ? null
          : {
              code: result.code,
              message: describeStorageError(result.code).message,
              blocking: !result.timedOut,
              needsSetup: describeStorageError(result.code).needsSetup,
            }
      );
    };

    (async () => {
      // 1차: 짧은 제한으로 빠르게 안내
      const quick = await checkStorageAvailable();
      apply(quick);
      if (cancelled) return;
      setStorageChecking(false);

      // 2차: 제한 없이 확정 답을 받아 안내를 갱신한다
      // (버킷이 없으면 SDK 재시도가 끝나는 30초쯤 확정된다)
      if (!quick.available && quick.timedOut) {
        apply(await checkStorageAvailable({ timeoutMs: 0 }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedBranch = useMemo(
    () => branches.find((b) => b.id === branchId) ?? null,
    [branches, branchId]
  );

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

  const files = report?.files ?? [];
  const isSubmitted = report?.status === "submitted";
  const isThisWeek = weekStart === thisWeek;

  function goToWeek(next: string) {
    if (!isWritableWeek(next)) return;
    setWeekStart(next);
    setNotice(null);
    setError(null);
    setJobs([]);
  }

  /** 파일 1개 업로드 — 신규 선택과 재시도가 같은 경로를 쓴다 */
  async function runUpload(key: string, file: File) {
    if (!profile || !selectedBranch) return;

    setJobs((prev) =>
      prev.map((j) =>
        j.key === key
          ? { ...j, status: "uploading", percent: 0, message: undefined, code: undefined }
          : j
      )
    );

    try {
      await uploadWeeklyFile({
        branchId: selectedBranch.id,
        branchName: selectedBranch.name,
        weekStartDate: weekStart,
        file,
        uid: profile.uid,
        name: profile.name,
        onProgress: (percent) =>
          setJobs((prev) => prev.map((j) => (j.key === key ? { ...j, percent } : j))),
      });
      // 성공한 파일만 목록에 반영한다
      setJobs((prev) => prev.filter((j) => j.key !== key));
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("weekly upload failed:", err);
      // 검증 실패(형식·크기)는 자체 문구가 있고, 그 외는 Storage 오류 코드로 판단한다
      const userMessage = (err as Error & { userMessage?: string }).userMessage;
      const code = (err as { code?: string })?.code;
      const info = describeStorageError(code);
      setJobs((prev) =>
        prev.map((j) =>
          j.key === key
            ? {
                ...j,
                status: "failed",
                message: userMessage ?? info.message,
                code: userMessage ? undefined : code,
                retryable: userMessage ? false : info.retryable,
              }
            : j
        )
      );
      // 설정 문제라면 배너로도 알려 같은 실패를 반복하지 않게 한다
      if (!userMessage && info.needsSetup) {
        setStorageIssue({
          code: code ?? "storage/unknown",
          message: info.message,
          blocking: true,
          needsSetup: info.needsSetup,
        });
      }
    }
  }

  async function handleFiles(selected: FileList | null) {
    if (!selected || !profile || !selectedBranch) return;
    setError(null);
    setNotice(null);

    // 한 번에 여러 개를 고르면 순서대로 올린다 (진행률을 개별 표시)
    for (const file of Array.from(selected)) {
      const key = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`;
      setJobs((prev) => [
        ...prev,
        { key, file, name: file.name, size: file.size, percent: 0, status: "uploading" },
      ]);
      await runUpload(key, file);
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleDelete(file: WeeklyReportFile) {
    if (!profile || !selectedBranch) return;
    setDeletingId(file.fileId);
    setError(null);
    try {
      await deleteWeeklyFile({
        branchId: selectedBranch.id,
        weekStartDate: weekStart,
        fileId: file.fileId,
        uid: profile.uid,
        name: profile.name,
      });
      setNotice(`${file.name} 파일을 삭제했습니다.`);
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("weekly delete failed:", err);
      setError("파일을 삭제하지 못했습니다.");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSubmit() {
    if (!profile || !selectedBranch) return;
    if (files.length === 0) {
      setError("첨부파일을 1개 이상 올린 뒤 제출해주세요.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await submitWeeklyReport({
        branchId: selectedBranch.id,
        branchName: selectedBranch.name,
        weekStartDate: weekStart,
        uid: profile.uid,
        name: profile.name,
      });
      setNotice(`${weekRangeLabel(weekStart)} 주간보고를 제출했습니다.`);
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("weekly submit failed:", err);
      const code = (err as { code?: string })?.code ?? (err as Error)?.message ?? "unknown";
      setError(
        code === "no-files"
          ? "첨부파일을 1개 이상 올린 뒤 제출해주세요."
          : code === "permission-denied"
            ? "제출 권한이 없습니다. 담당 지점인지 확인해주세요."
            : "제출하지 못했습니다. 잠시 후 다시 시도해주세요."
      );
    } finally {
      setSubmitting(false);
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

  const uploading = jobs.some((j) => j.status === "uploading");
  const canAddMore = files.length < WEEKLY_FILE_MAX_COUNT && !storageIssue?.blocking;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900">주간보고</h1>
        <p className="text-xs text-gray-400">
          월요일 ~ 일요일 기준으로 보고서 파일을 첨부합니다. (PDF, XLSX, XLS, DOCX)
        </p>
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

      {storageIssue && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-amber-800">
                {storageIssue.needsSetup
                  ? "파일 업로드를 쓰려면 설정이 필요합니다"
                  : "Storage 연결을 확인하지 못했습니다"}
              </p>
              <p className="mt-0.5 text-xs text-amber-700">{storageIssue.message}</p>

              {storageIssue.needsSetup && (
                <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-xs text-amber-800">
                  {STORAGE_SETUP_GUIDE.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              )}
              {storageIssue.needsSetup && (
                <a
                  href={STORAGE_SETUP_GUIDE.consoleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
                >
                  Firebase 콘솔에서 Storage 열기
                </a>
              )}

              <p className="mt-2 font-mono text-[11px] text-amber-600">
                오류 코드: {storageIssue.code}
              </p>
            </div>
            <button
              type="button"
              onClick={runStorageCheck}
              disabled={storageChecking}
              className="flex shrink-0 items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs text-amber-800 hover:bg-amber-100 disabled:opacity-50"
            >
              <RefreshCwIcon className={storageChecking ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
              다시 확인
            </button>
          </div>
        </div>
      )}

      {tab === "write" && (
        <>
          {/* 주차 이동 */}
          <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
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
              지난 주차 보고입니다. 보고 주차({weekRangeLabel(weekStart)})와 실제 제출 시각은 따로
              기록됩니다.
            </p>
          )}

          {loading ? (
            <LoadingState />
          ) : (
            <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-gray-800">첨부파일</h2>
                  <WeeklyStateBadge state={resolveWeeklyState(report)} />
                  <span className="text-xs text-gray-400">
                    {files.length} / {WEEKLY_FILE_MAX_COUNT}
                  </span>
                </div>
              </div>

              {/* 파일 선택 */}
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.xlsx,.xls,.docx"
                  onChange={(e) => handleFiles(e.target.files)}
                  disabled={!canAddMore}
                  className="hidden"
                  id="weekly-file-input"
                />
                <label
                  htmlFor="weekly-file-input"
                  className={
                    canAddMore && !uploading
                      ? "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-gray-300 px-4 py-6 text-center hover:border-red-400 hover:bg-red-50/30"
                      : "flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-gray-200 px-4 py-6 text-center opacity-50"
                  }
                >
                  <UploadIcon className="h-5 w-5 text-gray-400" />
                  <span className="text-sm font-medium text-gray-700">
                    {storageIssue?.blocking
                      ? "업로드를 사용할 수 없습니다"
                      : canAddMore
                        ? "파일 선택"
                        : `최대 ${WEEKLY_FILE_MAX_COUNT}개까지 첨부했습니다`}
                  </span>
                  <span className="text-[11px] text-gray-400">
                    PDF, XLSX, XLS, DOCX · 파일당 최대 {formatFileSize(WEEKLY_FILE_MAX_BYTES)}
                  </span>
                </label>
              </div>

              {/* 업로드 진행률 */}
              {jobs.length > 0 && (
                <ul className="space-y-2">
                  {jobs.map((j) => (
                    <li
                      key={j.key}
                      className={
                        j.status === "failed"
                          ? "rounded-lg border border-red-200 bg-red-50 p-2.5"
                          : "rounded-lg border border-gray-200 p-2.5"
                      }
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="min-w-0 break-words break-keep text-xs font-medium text-gray-700">
                          {j.name}
                        </p>
                        <span className="shrink-0 text-[11px] text-gray-400">
                          {j.status === "failed" ? "실패" : `${j.percent}%`}
                        </span>
                      </div>
                      {j.status === "uploading" ? (
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                          <div
                            className="h-full bg-[#1e3a5f] transition-all"
                            style={{ width: `${j.percent}%` }}
                          />
                        </div>
                      ) : (
                        <div className="mt-1 space-y-1.5">
                          <p className="text-[11px] text-red-600">{j.message}</p>
                          {j.code && (
                            <p className="font-mono text-[11px] text-red-400">오류 코드: {j.code}</p>
                          )}
                          <div className="flex justify-end gap-2">
                            {j.retryable && (
                              <button
                                type="button"
                                onClick={() => runUpload(j.key, j.file)}
                                className="flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50"
                              >
                                <RefreshCwIcon className="h-3 w-3" />
                                재시도
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setJobs((prev) => prev.filter((x) => x.key !== j.key))}
                              className="text-[11px] text-gray-500 underline"
                            >
                              지우기
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <WeeklyFileList
                files={files}
                onPreview={setPreview}
                onDelete={handleDelete}
                deletingId={deletingId}
                emptyText="아직 첨부된 파일이 없습니다."
              />

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3">
                <p className="text-xs text-gray-500">
                  {report?.submittedAt
                    ? `최초 제출 ${formatDateTime(report.submittedAt.toDate())}`
                    : "미제출 (파일을 올린 뒤 제출해주세요)"}
                </p>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting || uploading || files.length === 0}
                  className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40"
                >
                  {submitting ? "처리 중..." : isSubmitted ? "다시 제출" : "제출"}
                </button>
              </div>

              {uploading && (
                <p className="text-[11px] text-gray-400">
                  업로드가 끝나야 제출할 수 있습니다.
                </p>
              )}
            </section>
          )}
        </>
      )}

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
                    <p className="flex items-center gap-1 text-xs text-gray-400">
                      {!!row.report?.files?.length && (
                        <>
                          <PaperclipIcon className="h-3 w-3" />
                          {row.report.files.length}개
                        </>
                      )}
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

      {preview && <PdfPreviewPanel file={preview} onClose={() => setPreview(null)} />}

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
