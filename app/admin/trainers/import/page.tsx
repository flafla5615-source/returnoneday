"use client";

import { useMemo, useState } from "react";
import { previewTrainerImport, type TrainerImportRow } from "@/services/trainerImport";
import { getAllTrainers } from "@/services/trainers";
import LoadingState from "@/components/common/LoadingState";
import { cn } from "@/lib/utils";
import type { Trainer } from "@/types";
import { CloudDownloadIcon, AlertCircleIcon, RefreshCwIcon } from "lucide-react";

type Classification = "new" | "existing_match" | "review";

interface ClassifiedRow extends TrainerImportRow {
  classification: Classification;
  matchedTrainerName?: string;
  duplicateInSheet: boolean;
}

const CLASSIFICATION_LABEL: Record<Classification, string> = {
  new: "신규 후보",
  existing_match: "기존 일치",
  review: "검토 필요",
};

const CLASSIFICATION_COLOR: Record<Classification, string> = {
  new: "bg-blue-100 text-blue-700",
  existing_match: "bg-green-100 text-green-700",
  review: "bg-amber-100 text-amber-700",
};

// 서버가 반환하는 message는 아래 표에 있으면 안내 문구로 치환하고,
// 이미 한국어 문장(예: requireAdmin의 "관리자만 사용할 수 있는 기능입니다.")이면 그대로 쓴다.
// 그 외(예상 못한 내부 오류 메시지, 키 정보 등)는 절대 그대로 노출하지 않고 일반 문구로 대체한다.
const IMPORT_ERROR_MESSAGES: Record<string, string> = {
  "sheets-not-configured": "구글시트 연동 설정이 필요합니다.",
  "sheets-access-denied": "시트 접근 권한이 없습니다. 서비스 계정에 시트 읽기 권한을 공유해주세요.",
  "sheet-not-found": "시트 탭을 찾을 수 없습니다. 시트 이름을 확인해주세요.",
  "columns-not-found": "필요한 컬럼(이름/지점명/직급/연락처/현재 상태)을 찾을 수 없습니다.",
  "no-data": "재직 중인 TR 트레이너 데이터를 찾지 못했습니다.",
};

function importErrorMessage(err: unknown): string {
  const message = (err as { message?: string })?.message ?? "";
  if (IMPORT_ERROR_MESSAGES[message]) return IMPORT_ERROR_MESSAGES[message];
  if (/[가-힣]/.test(message)) return message;
  return "일시적인 오류로 불러오지 못했습니다. 잠시 후 다시 시도해주세요.";
}

export default function TrainerImportPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetRows, setSheetRows] = useState<TrainerImportRow[] | null>(null);
  const [existingTrainers, setExistingTrainers] = useState<Trainer[]>([]);
  const [filter, setFilter] = useState<"all" | "new" | "existing" | "review">("all");

  async function handleImport() {
    setLoading(true);
    setError(null);
    try {
      const [rows, trainers] = await Promise.all([previewTrainerImport(), getAllTrainers()]);
      setSheetRows(rows);
      setExistingTrainers(trainers);
    } catch (err) {
      console.error("[TrainerImport] preview failed", err);
      setError(importErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  // 재직 상태인 행만 실제 가져오기 대상 — 나머지(퇴직자 등)는 "제외"로 집계만 한다.
  const activeRows = useMemo(() => (sheetRows ?? []).filter((r) => r.status === "재직"), [sheetRows]);
  const excludedRows = useMemo(() => (sheetRows ?? []).filter((r) => r.status !== "재직"), [sheetRows]);

  const classified = useMemo<ClassifiedRow[]>(() => {
    const groupCounts = new Map<string, number>();
    activeRows.forEach((r) => {
      const key = `${r.normalizedName}__${r.phoneLast4}`;
      groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
    });

    return activeRows.map((r) => {
      const nameCandidates = existingTrainers.filter(
        (t) => t.name === r.normalizedName || t.name === r.originalName
      );

      let classification: Classification;
      let matchedTrainerName: string | undefined;

      if (r.phoneLast4) {
        const exact = nameCandidates.find((t) => (t.phoneLast4 ?? "") === r.phoneLast4);
        if (exact) {
          classification = "existing_match";
          matchedTrainerName = exact.name;
        } else if (nameCandidates.length > 0) {
          classification = "review"; // 이름은 같지만 전화번호 뒤 4자리가 다름 — 동명이인 또는 중복 검토
        } else {
          classification = "new";
        }
      } else {
        classification = nameCandidates.length > 0 ? "review" : "new"; // 전화번호 없어 확정 불가
      }

      const key = `${r.normalizedName}__${r.phoneLast4}`;
      return {
        ...r,
        classification,
        matchedTrainerName,
        duplicateInSheet: (groupCounts.get(key) ?? 0) > 1,
      };
    });
  }, [activeRows, existingTrainers]);

  const summary = useMemo(
    () => ({
      totalTR: sheetRows?.length ?? 0,
      excluded: excludedRows.length,
      newCount: classified.filter((r) => r.classification === "new").length,
      existingCount: classified.filter((r) => r.classification === "existing_match").length,
      reviewCount: classified.filter((r) => r.classification === "review").length,
    }),
    [sheetRows, excludedRows, classified]
  );

  const filteredRows = useMemo(() => {
    switch (filter) {
      case "new":
        return classified.filter((r) => r.classification === "new");
      case "existing":
        return classified.filter((r) => r.classification === "existing_match");
      case "review":
        return classified.filter((r) => r.classification === "review");
      default:
        return classified;
    }
  }, [classified, filter]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-base font-bold text-gray-900">트레이너 명단 불러오기</h1>
        <p className="text-xs text-gray-500 mt-1 max-w-2xl">
          구글시트의 재직 트레이너 명단을 불러와 기존 앱 데이터와 비교합니다.
          최종 승인 전에는 실제 트레이너가 등록되지 않습니다.
        </p>
      </div>

      <button
        onClick={handleImport}
        disabled={loading}
        className="flex items-center gap-1.5 px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304f] disabled:opacity-50"
      >
        <CloudDownloadIcon className="w-4 h-4" />
        {loading ? "불러오는 중..." : "구글시트 불러오기"}
      </button>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircleIcon className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p>{error}</p>
            <button
              onClick={handleImport}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium underline hover:no-underline"
            >
              <RefreshCwIcon className="w-3 h-3" />
              다시 시도
            </button>
          </div>
        </div>
      )}

      {loading && <LoadingState />}

      {!loading && !sheetRows && !error && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm py-16 text-center text-sm text-gray-400">
          아직 불러온 트레이너 명단이 없습니다.
        </div>
      )}

      {!loading && sheetRows && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: "원본 TR 행 수", value: summary.totalTR },
              { label: "신규 후보", value: summary.newCount, color: "text-blue-600" },
              { label: "기존 일치", value: summary.existingCount, color: "text-green-600" },
              { label: "검토 필요", value: summary.reviewCount, color: "text-amber-600" },
              { label: "제외 (퇴직 등)", value: summary.excluded, color: "text-gray-400" },
            ].map((c) => (
              <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
                <p className="text-xs text-gray-500 mb-1">{c.label}</p>
                <p className={cn("text-2xl font-bold", c.color ?? "text-gray-900")}>{c.value}</p>
              </div>
            ))}
          </div>

          {/* Filter tabs */}
          <div className="flex flex-wrap gap-2">
            {(
              [
                { key: "all", label: `전체 (${classified.length})` },
                { key: "new", label: `신규 (${summary.newCount})` },
                { key: "existing", label: `기존 일치 (${summary.existingCount})` },
                { key: "review", label: `검토 필요 (${summary.reviewCount})` },
              ] as const
            ).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={cn(
                  "px-3 py-1.5 text-xs rounded-lg border transition-colors",
                  filter === key
                    ? "border-[#1e3a5f] text-[#1e3a5f] bg-white"
                    : "border-gray-300 text-gray-600 bg-white hover:bg-gray-50"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Table */}
          {filteredRows.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm py-14 text-center text-sm text-gray-400">
              해당 조건에 맞는 행이 없습니다.
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {[
                      "원본 이름",
                      "정리된 이름",
                      "지점명",
                      "직급",
                      "전화번호 뒤 4자리",
                      "기존 앱 일치 후보",
                      "분류 상태",
                    ].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredRows.map((r) => (
                    <tr key={r.sourceRow} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{r.originalName}</td>
                      <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                        {r.normalizedName}
                        {r.normalizedName !== r.originalName && (
                          <span className="ml-1.5 text-[10px] text-gray-400">(정리됨)</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{r.branchName || "-"}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{r.jobTitle}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                        {r.phoneLast4 || <span className="italic text-gray-300">없음</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                        {r.matchedTrainerName ?? "-"}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={cn(
                              "inline-flex px-2 py-0.5 rounded-full text-xs font-medium",
                              CLASSIFICATION_COLOR[r.classification]
                            )}
                          >
                            {CLASSIFICATION_LABEL[r.classification]}
                          </span>
                          {r.duplicateInSheet && (
                            <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-100 text-purple-700">
                              시트 내 반복
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
            현재 단계는 미리보기입니다. 실제 등록 기능은 다음 단계에서 추가됩니다.
          </p>
        </>
      )}
    </div>
  );
}
