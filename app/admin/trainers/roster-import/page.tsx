"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { getAllTrainers } from "@/services/trainers";
import { getTrainerSessionCountByTrainerId } from "@/services/trainerSessions";
import {
  parseRosterText,
  classifyRosterEntries,
  summarizeRoster,
  commitTrainerRosterImport,
  type ParsedNameEntry,
  type RosterClassifiedRow,
  type RosterImportSummary,
  type RosterImportDecisionInput,
  type RosterImportItemResult,
} from "@/services/trainerRosterImport";
import LoadingState from "@/components/common/LoadingState";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { cn } from "@/lib/utils";
import type { Trainer } from "@/types";
import {
  ArrowLeftIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  CircleIcon,
  Link2Icon,
  UserPlusIcon,
  GitMergeIcon,
  CircleXIcon,
  ClipboardListIcon,
  XIcon,
} from "lucide-react";

type Stage = "input" | "duplicates" | "preview" | "result";

const ACTION_LABEL: Record<string, string> = {
  use_existing: "기존 트레이너 사용",
  create_new: "신규 등록",
  review: "검토 필요",
  exclude: "제외",
  merge: "동일 인물로 통합",
};

const ACTION_COLOR: Record<string, string> = {
  use_existing: "bg-green-100 text-green-700",
  create_new: "bg-blue-100 text-blue-700",
  review: "bg-amber-100 text-amber-700",
  exclude: "bg-gray-100 text-gray-500",
  merge: "bg-purple-100 text-purple-700",
};

// 서버(commitTrainerRosterImport)가 HttpsError로 던진 code/message를 안전한 한국어 문구로 치환한다.
function commitErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  const message = (err as { message?: string })?.message ?? "";
  if (code.includes("not-found")) return "Firebase 함수가 배포되지 않았습니다. 관리자에게 문의해주세요.";
  if (code.includes("unauthenticated") || code.includes("permission-denied")) {
    return "관리자 로그인 권한을 확인해주세요.";
  }
  if (/[가-힣]/.test(message)) return message;
  return "일시적인 서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
}

export default function TrainerRosterImportPage() {
  const [stage, setStage] = useState<Stage>("input");
  const [rawText, setRawText] = useState("");
  const [entries, setEntries] = useState<ParsedNameEntry[]>([]);
  const [rows, setRows] = useState<RosterClassifiedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 검토 대기 중인 행의 통합(merge) 설정 UI 상태
  const [mergeTarget, setMergeTarget] = useState<{ rowIndex: number; keepTrainerId: string } | null>(null);
  const [sessionCounts, setSessionCounts] = useState<Record<string, number>>({});
  const [loadingCounts, setLoadingCounts] = useState(false);

  const [approveConfirmOpen, setApproveConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<RosterImportItemResult[] | null>(null);
  const [alreadyProcessed, setAlreadyProcessed] = useState(false);

  const totalInputLines = useMemo(
    () => rawText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0).length,
    [rawText]
  );

  const summary: RosterImportSummary | null = useMemo(() => {
    if (stage !== "preview" && stage !== "result") return null;
    return summarizeRoster(totalInputLines, entries, rows);
  }, [stage, totalInputLines, entries, rows]);

  const hasPendingReview = rows.some((r) => r.action === "review");

  // ── 단계 1 → 2: 중복 확인 ─────────────────────────────────────────────────
  function handleCheckDuplicates() {
    setError(null);
    const parsed = parseRosterText(rawText);
    if (parsed.length === 0) {
      setError("입력한 명단이 비어 있습니다.");
      return;
    }
    setEntries(parsed);
    setStage("duplicates");
  }

  // ── 단계 2 → 3: 등록 미리보기 ─────────────────────────────────────────────
  async function handlePreview() {
    setLoading(true);
    setError(null);
    try {
      const trainers = await getAllTrainers();
      setRows(classifyRosterEntries(entries, trainers));
      setStage("preview");
    } catch (err) {
      console.error("[RosterImport] preview failed", err);
      setError("기존 트레이너 목록을 불러오지 못했습니다. 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  }

  function resetAll() {
    setStage("input");
    setRawText("");
    setEntries([]);
    setRows([]);
    setError(null);
    setMergeTarget(null);
    setSessionCounts({});
    setResults(null);
    setAlreadyProcessed(false);
  }

  // ── 검토 필요 행 처리 ─────────────────────────────────────────────────────
  function applyRowUpdate(rowIndex: number, patch: Partial<RosterClassifiedRow>) {
    setRows((prev) => prev.map((r, i) => (i === rowIndex ? { ...r, ...patch } : r)));
  }

  function reviewUseExisting(rowIndex: number, trainer: Trainer) {
    applyRowUpdate(rowIndex, {
      action: "use_existing",
      status: `기존 트레이너와 연결 (${trainer.name})`,
      matchedTrainerId: trainer.id,
    });
  }

  function reviewCreateNew(rowIndex: number) {
    applyRowUpdate(rowIndex, { action: "create_new", status: "신규 트레이너로 등록", matchedTrainerId: undefined });
  }

  function reviewExclude(rowIndex: number) {
    applyRowUpdate(rowIndex, { action: "exclude", status: "이번 등록에서 제외" });
  }

  async function openMergeDialog(rowIndex: number) {
    const row = rows[rowIndex];
    if (!row.reviewCandidates || row.reviewCandidates.length < 2) return;
    setMergeTarget({ rowIndex, keepTrainerId: row.reviewCandidates[0].id });
    setLoadingCounts(true);
    try {
      const pairs = await Promise.all(
        row.reviewCandidates.map(async (t) => [t.id, await getTrainerSessionCountByTrainerId(t.id)] as const)
      );
      setSessionCounts((prev) => ({ ...prev, ...Object.fromEntries(pairs) }));
    } catch (err) {
      console.error("[RosterImport] session count fetch failed", err);
    } finally {
      setLoadingCounts(false);
    }
  }

  function confirmMerge() {
    if (!mergeTarget) return;
    const row = rows[mergeTarget.rowIndex];
    const candidates = row.reviewCandidates ?? [];
    const fromIds = candidates.map((t) => t.id).filter((id) => id !== mergeTarget.keepTrainerId);
    const keepTrainer = candidates.find((t) => t.id === mergeTarget.keepTrainerId);
    applyRowUpdate(mergeTarget.rowIndex, {
      action: "merge",
      status: `동일 인물로 통합 예정 (유지: ${keepTrainer?.name ?? mergeTarget.keepTrainerId})`,
      matchedTrainerId: mergeTarget.keepTrainerId,
      mergeFromTrainerIds: fromIds,
    });
    setMergeTarget(null);
  }

  // ── 최종 승인 ──────────────────────────────────────────────────────────────
  function buildDecisions(): RosterImportDecisionInput[] {
    return rows
      .filter((r) => r.action !== "review")
      .map((r) => {
        if (r.action === "merge") {
          return {
            finalName: r.finalName,
            action: "merge" as const,
            mergeKeepTrainerId: r.matchedTrainerId,
            mergeFromTrainerIds: r.mergeFromTrainerIds ?? [],
          };
        }
        if (r.action === "use_existing") {
          return { finalName: r.finalName, action: "use_existing" as const, matchedTrainerId: r.matchedTrainerId };
        }
        if (r.action === "create_new") {
          return { finalName: r.finalName, action: "create_new" as const };
        }
        return { finalName: r.finalName, action: "exclude" as const };
      });
  }

  async function handleApprove() {
    setSubmitting(true);
    setError(null);
    try {
      const decisions = buildDecisions();
      const response = await commitTrainerRosterImport(rawText, decisions);
      setResults(response.results);
      setAlreadyProcessed(response.alreadyProcessed);
      setStage("result");
    } catch (err) {
      console.error("[RosterImport] commit failed", err);
      setError(commitErrorMessage(err));
    } finally {
      setSubmitting(false);
      setApproveConfirmOpen(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Link
          href="/admin/trainers/manage"
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
          title="트레이너 관리로 돌아가기"
        >
          <ArrowLeftIcon className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-base font-bold text-gray-900">트레이너 명단 일괄 등록</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            본사에서 전달한 확정 명단을 붙여넣어 중복 확인 → 미리보기 → 승인 순서로 등록합니다.
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}

      {/* ── 단계 1: 입력 ──────────────────────────────────────────────────── */}
      {stage === "input" && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-3">
          <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
            트레이너 이름을 한 줄에 한 명씩 입력해주세요. 동일한 이름은 자동으로 중복 확인됩니다.
          </p>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={14}
            placeholder={"박도현\n김서연\n하윤서\n..."}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
          />
          <p className="text-xs text-gray-400">현재 {totalInputLines}줄 입력됨</p>
          <div className="flex gap-2 justify-end">
            <Link
              href="/admin/trainers/manage"
              className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            >
              취소
            </Link>
            <button
              onClick={handleCheckDuplicates}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304f]"
            >
              <ClipboardListIcon className="w-4 h-4" />
              중복 확인
            </button>
          </div>
        </div>
      )}

      {/* ── 단계 2: 중복 확인 결과 ────────────────────────────────────────── */}
      {stage === "duplicates" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { label: "원본 입력 행 수", value: totalInputLines },
              { label: "고유 이름 수", value: entries.length, color: "text-blue-600" },
              {
                label: "완전 동일 중복 제거 수",
                value: entries.reduce((sum, e) => sum + (e.occurrenceCount - e.originalVariants.length), 0),
                color: "text-gray-500",
              },
            ].map((c) => (
              <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
                <p className="text-xs text-gray-500 mb-1">{c.label}</p>
                <p className={cn("text-2xl font-bold", c.color ?? "text-gray-900")}>{c.value}</p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {["최종 이름", "원본 표기", "원본 등장 횟수"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entries.map((e) => (
                  <tr key={e.finalName} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{e.finalName}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {e.originalVariants.join(", ")}
                      {e.originalVariants.length > 1 && (
                        <span className="ml-1.5 text-[10px] text-purple-600">(이름 예외 통합)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700 text-xs">{e.occurrenceCount}회</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setStage("input")}
              className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            >
              다시 입력
            </button>
            <button
              onClick={handlePreview}
              disabled={loading}
              className="px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304f] disabled:opacity-50"
            >
              {loading ? "불러오는 중..." : "등록 미리보기"}
            </button>
          </div>
        </div>
      )}

      {loading && stage === "duplicates" && <LoadingState />}

      {/* ── 단계 3: 등록 미리보기 + 검토 ─────────────────────────────────── */}
      {stage === "preview" && summary && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "원본 입력 행 수", value: summary.totalInputLines },
              { label: "완전 동일 중복 제거", value: summary.exactDuplicatesRemoved, color: "text-gray-500" },
              { label: "이름 예외 통합", value: summary.aliasMerged, color: "text-purple-600" },
              { label: "고유 트레이너 수", value: summary.uniqueCount, color: "text-blue-600" },
              { label: "기존 앱 일치", value: summary.matchedExistingCount, color: "text-green-600" },
              { label: "신규 등록 예정", value: summary.newCount, color: "text-blue-600" },
              { label: "검토 필요", value: summary.reviewCount, color: "text-amber-600" },
              { label: "제외", value: summary.excludedCount, color: "text-gray-400" },
            ].map((c) => (
              <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
                <p className="text-xs text-gray-500 mb-1">{c.label}</p>
                <p className={cn("text-2xl font-bold", c.color ?? "text-gray-900")}>{c.value}</p>
              </div>
            ))}
          </div>

          {hasPendingReview && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              <AlertTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
              <p>검토가 필요한 항목이 있습니다. 모든 항목을 처리해야 최종 등록 승인이 가능합니다.</p>
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
            <table className="w-full text-sm min-w-[1000px]">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {["최종 이름", "원본 표기", "원본 등장 횟수", "기존 앱 일치", "기존 trainerId", "처리 방식", "상태"].map(
                    (h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r, idx) => (
                  <tr key={r.finalName} className="hover:bg-gray-50 align-top">
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{r.finalName}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{r.originalVariants.join(", ")}</td>
                    <td className="px-4 py-3 text-gray-700 text-xs whitespace-nowrap">{r.occurrenceCount}회</td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {r.matchedTrainerId ? "일치" : "-"}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-[10px] whitespace-nowrap font-mono">
                      {r.matchedTrainerId ?? "-"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={cn("inline-flex px-2 py-0.5 rounded-full text-xs font-medium", ACTION_COLOR[r.action])}>
                        {ACTION_LABEL[r.action]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 min-w-[220px]">
                      <p>{r.status}</p>
                      {r.action === "review" && (
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {r.reviewReason === "duplicate_merge_needed" || (r.reviewCandidates?.length ?? 0) > 1 ? (
                            <button
                              onClick={() => void openMergeDialog(idx)}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg border border-purple-300 text-purple-700 hover:bg-purple-50 text-[11px]"
                            >
                              <GitMergeIcon className="w-3 h-3" />
                              동일 인물로 통합
                            </button>
                          ) : null}
                          {r.reviewCandidates?.map((t) => (
                            <button
                              key={t.id}
                              onClick={() => reviewUseExisting(idx, t)}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg border border-green-300 text-green-700 hover:bg-green-50 text-[11px]"
                            >
                              <Link2Icon className="w-3 h-3" />
                              {t.name}와 연결
                            </button>
                          ))}
                          <button
                            onClick={() => reviewCreateNew(idx)}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50 text-[11px]"
                          >
                            <UserPlusIcon className="w-3 h-3" />
                            신규 등록
                          </button>
                          <button
                            onClick={() => reviewExclude(idx)}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 text-[11px]"
                          >
                            <CircleXIcon className="w-3 h-3" />
                            제외
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-2 justify-end">
            <button
              onClick={resetAll}
              className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            >
              취소
            </button>
            <button
              onClick={() => setApproveConfirmOpen(true)}
              disabled={hasPendingReview || submitting}
              className="px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304f] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? "등록 처리 중..." : "최종 등록 승인"}
            </button>
          </div>
        </div>
      )}

      {/* ── 통합 설정 다이얼로그 ──────────────────────────────────────────── */}
      {mergeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMergeTarget(null)} />
          <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-md space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">동일 인물로 통합</h3>
              <button onClick={() => setMergeTarget(null)} className="text-gray-400 hover:text-gray-600">
                <XIcon className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-gray-500">유지할 트레이너를 선택해주세요. 나머지는 세션 기록이 이전된 뒤 비활성 처리됩니다.</p>
            <div className="space-y-2">
              {(rows[mergeTarget.rowIndex]?.reviewCandidates ?? []).map((t) => (
                <label
                  key={t.id}
                  className={cn(
                    "flex items-center justify-between border rounded-lg px-3 py-2 text-sm cursor-pointer",
                    mergeTarget.keepTrainerId === t.id ? "border-[#1e3a5f] bg-[#1e3a5f]/5" : "border-gray-200"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={mergeTarget.keepTrainerId === t.id}
                      onChange={() => setMergeTarget({ ...mergeTarget, keepTrainerId: t.id })}
                    />
                    <div>
                      <p className="font-medium text-gray-900">{t.name}</p>
                      <p className="text-[10px] text-gray-400 font-mono">{t.id}</p>
                    </div>
                  </div>
                  <span className="text-xs text-gray-500">
                    {loadingCounts ? "확인 중..." : `기존 세션 ${sessionCounts[t.id] ?? 0}건`}
                  </span>
                </label>
              ))}
            </div>
            <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
              예상 이전 세션 수:{" "}
              {(rows[mergeTarget.rowIndex]?.reviewCandidates ?? [])
                .filter((t) => t.id !== mergeTarget.keepTrainerId)
                .reduce((sum, t) => sum + (sessionCounts[t.id] ?? 0), 0)}
              건
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setMergeTarget(null)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={confirmMerge}
                disabled={loadingCounts}
                className="px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304f] disabled:opacity-50"
              >
                통합 확정
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={approveConfirmOpen}
        title="트레이너 명단을 최종 등록하시겠습니까?"
        description="신규 트레이너 생성, 기존 연결, 통합 처리가 실제로 실행됩니다. 이 작업은 되돌릴 수 없습니다."
        confirmLabel="최종 등록 승인"
        onConfirm={() => void handleApprove()}
        onCancel={() => setApproveConfirmOpen(false)}
      />

      {/* ── 결과 화면 ─────────────────────────────────────────────────────── */}
      {stage === "result" && results && (
        <div className="space-y-4">
          {alreadyProcessed && (
            <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
              <AlertTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
              <p>동일한 명단이 이미 처리된 기록이 있어, 중복 등록 없이 기존 처리 결과를 표시합니다.</p>
            </div>
          )}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {["최종 이름", "처리 방식", "결과", "메시지"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {results.map((r, i) => (
                  <tr key={`${r.finalName}-${i}`} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{r.finalName}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{ACTION_LABEL[r.action] ?? r.action}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
                          r.status === "success"
                            ? "bg-green-100 text-green-700"
                            : r.status === "skipped"
                              ? "bg-gray-100 text-gray-500"
                              : "bg-red-100 text-red-700"
                        )}
                      >
                        {r.status === "success" ? <CheckCircleIcon className="w-3 h-3" /> : <CircleIcon className="w-3 h-3" />}
                        {r.status === "success" ? "성공" : r.status === "skipped" ? "제외됨" : "실패"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{r.message ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={resetAll}
              className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            >
              새 명단 등록
            </button>
            <Link
              href="/admin/trainers/manage"
              className="px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304f]"
            >
              트레이너 관리로 이동
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
