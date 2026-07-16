import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import type { Trainer } from "@/types";

// 본사 확정 명단 수기 붙여넣기 → 중복 확인 → 미리보기 → 관리자 승인 → 일괄 등록.
// 구글시트 연동(services/trainerImport.ts)과는 완전히 별개의 경로다.

// 확정된 예외는 이 한 건뿐이다 — 다른 이름은 절대 자동으로 병합/수정하지 않는다.
const TRAINER_NAME_ALIASES: Record<string, string> = {
  "김동현_2": "김동현",
};

export function normalizeRosterName(raw: string): string {
  const trimmed = raw.trim();
  return TRAINER_NAME_ALIASES[trimmed] ?? trimmed;
}

export interface ParsedNameEntry {
  finalName: string;
  originalVariants: string[];
  variantCounts: Record<string, number>; // 원본 표기 문자열 -> 그 표기가 등장한 횟수
  occurrenceCount: number;
  firstIndex: number;
}

// trim → 빈 줄 제거 → 완전 동일 이름만 중복 제거(최초 등장 순서 유지).
// "김동현_2" → "김동현" 예외만 별도로 합산되고, 그 외에는 문자열이 완전히 같을 때만 하나로 묶인다.
export function parseRosterText(rawText: string): ParsedNameEntry[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const map = new Map<string, ParsedNameEntry>();
  lines.forEach((line, idx) => {
    const finalName = normalizeRosterName(line);
    let entry = map.get(finalName);
    if (!entry) {
      entry = { finalName, originalVariants: [], variantCounts: {}, occurrenceCount: 0, firstIndex: idx };
      map.set(finalName, entry);
    }
    entry.occurrenceCount += 1;
    entry.variantCounts[line] = (entry.variantCounts[line] ?? 0) + 1;
    if (!entry.originalVariants.includes(line)) entry.originalVariants.push(line);
  });

  return Array.from(map.values()).sort((a, b) => a.firstIndex - b.firstIndex);
}

export type RosterAction = "use_existing" | "create_new" | "review" | "exclude" | "merge";
export type RosterReviewReason =
  | "existing_alias_only" // 김동현_2만 있고 김동현은 없는 경우
  | "duplicate_merge_needed" // 김동현/김동현_2 둘 다 있는 경우
  | "multiple_exact_matches"; // 동일 이름이 기존에 이미 여러 명 있는 경우

export interface RosterClassifiedRow extends ParsedNameEntry {
  action: RosterAction;
  status: string;
  matchedTrainerId?: string;
  reviewReason?: RosterReviewReason;
  reviewCandidates?: Trainer[];
  mergeFromTrainerIds?: string[]; // action이 "merge"일 때만 사용 — 이전 대상 trainerId 목록
}

// 기존 trainers 전체와 비교해 기존 사용 / 신규 등록 / 검토 필요로 분류한다.
// 이름이 "비슷하다"는 이유만으로는 절대 자동 병합하지 않는다 — 완전 일치만 취급한다.
export function classifyRosterEntries(
  entries: ParsedNameEntry[],
  existingTrainers: Trainer[]
): RosterClassifiedRow[] {
  return entries.map((entry) => {
    if (entry.finalName === "김동현") {
      const kimDonghyun = existingTrainers.find((t) => t.name === "김동현");
      const kimDonghyun2 = existingTrainers.find((t) => t.name === "김동현_2");

      if (kimDonghyun && !kimDonghyun2) {
        return { ...entry, action: "use_existing", status: "기존 트레이너 사용", matchedTrainerId: kimDonghyun.id };
      }
      if (!kimDonghyun && kimDonghyun2) {
        return {
          ...entry,
          action: "review",
          status: "검토 필요 (김동현_2만 존재)",
          reviewReason: "existing_alias_only",
          reviewCandidates: [kimDonghyun2],
        };
      }
      if (kimDonghyun && kimDonghyun2) {
        return {
          ...entry,
          action: "review",
          status: "중복 통합 필요",
          reviewReason: "duplicate_merge_needed",
          reviewCandidates: [kimDonghyun, kimDonghyun2],
        };
      }
      return { ...entry, action: "create_new", status: "신규 등록" };
    }

    const exactMatches = existingTrainers.filter((t) => t.name === entry.finalName);
    if (exactMatches.length === 1) {
      return { ...entry, action: "use_existing", status: "기존 트레이너 사용", matchedTrainerId: exactMatches[0].id };
    }
    if (exactMatches.length > 1) {
      return {
        ...entry,
        action: "review",
        status: "검토 필요 (동명이인 여러 명)",
        reviewReason: "multiple_exact_matches",
        reviewCandidates: exactMatches,
      };
    }
    return { ...entry, action: "create_new", status: "신규 등록" };
  });
}

export interface RosterImportSummary {
  totalInputLines: number;
  exactDuplicatesRemoved: number;
  aliasMerged: number; // 김동현_2 → 김동현으로 합산된 원본 행 수
  uniqueCount: number;
  matchedExistingCount: number;
  newCount: number;
  reviewCount: number;
  excludedCount: number;
}

export function summarizeRoster(
  totalInputLines: number,
  entries: ParsedNameEntry[],
  rows: RosterClassifiedRow[]
): RosterImportSummary {
  let exactDuplicatesRemoved = 0;
  let aliasMerged = 0;

  entries.forEach((entry) => {
    Object.entries(entry.variantCounts).forEach(([variant, count]) => {
      // 같은 표기가 여러 줄 반복된 경우: 첫 등장만 남기고 나머지는 완전 동일 중복 제거
      exactDuplicatesRemoved += count - 1;
      // "김동현"으로 정규화됐지만 원본 표기가 "김동현"이 아닌 경우(=김동현_2) → 이름 예외 통합
      if (variant !== entry.finalName) aliasMerged += count;
    });
  });

  return {
    totalInputLines,
    exactDuplicatesRemoved,
    aliasMerged,
    uniqueCount: entries.length,
    matchedExistingCount: rows.filter((r) => r.action === "use_existing").length,
    newCount: rows.filter((r) => r.action === "create_new").length,
    reviewCount: rows.filter((r) => r.action === "review").length,
    excludedCount: rows.filter((r) => r.action === "exclude").length,
  };
}

// ─── 서버 승인 호출 ──────────────────────────────────────────────────────────

export type CommitAction = "use_existing" | "create_new" | "merge" | "exclude";

export interface RosterImportDecisionInput {
  finalName: string;
  action: CommitAction;
  matchedTrainerId?: string;
  mergeKeepTrainerId?: string;
  mergeFromTrainerIds?: string[];
}

export interface RosterImportItemResult {
  finalName: string;
  action: string;
  status: "success" | "skipped" | "failed";
  trainerId?: string;
  message?: string;
}

export async function commitTrainerRosterImport(
  rawText: string,
  decisions: RosterImportDecisionInput[]
): Promise<{ batchId: string; alreadyProcessed: boolean; results: RosterImportItemResult[] }> {
  const callable = httpsCallable<
    { rawText: string; decisions: RosterImportDecisionInput[] },
    { batchId: string; alreadyProcessed: boolean; results: RosterImportItemResult[] }
  >(functions, "commitTrainerRosterImport");
  const response = await callable({ rawText, decisions });
  return response.data;
}
