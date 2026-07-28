import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { BranchMonthlyTarget } from "@/types";

// 지점 월 목표(branchMonthlyTargets).
// 문서 ID = {branchId}_{yearMonth} → 같은 지점·월에 문서가 중복 생성되지 않는다.
// 목표 미입력 항목은 null로 저장한다 (0과 구분해서 "목표 미설정"으로 표시하기 위함).

export function branchTargetId(branchId: string, yearMonth: string): string {
  return `${branchId}_${yearMonth}`;
}

export type BranchTargetInput = {
  targetSalesAmount?: number | null;
  targetNewMembers?: number | null;
  targetRenewals?: number | null;
  targetComebacks?: number | null;
  targetRegistrations?: number | null;
  targetInquiries?: number | null;
  targetPtSalesAmount?: number | null;
  targetTrainerSalesAmount?: number | null;
};

export const TARGET_FIELDS = [
  "targetSalesAmount",
  "targetNewMembers",
  "targetRenewals",
  "targetComebacks",
  "targetRegistrations",
  "targetInquiries",
  "targetPtSalesAmount",
  "targetTrainerSalesAmount",
] as const;

export type TargetField = (typeof TARGET_FIELDS)[number];

// 빈 값은 null(미설정), 값이 있으면 0 이상 정수로 정규화한다.
function normalizeTarget(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (isNaN(v) || !isFinite(v)) return null;
  return Math.max(0, Math.floor(v));
}

export async function upsertBranchTarget(
  branchId: string,
  yearMonth: string,
  input: BranchTargetInput,
  uid: string
): Promise<string> {
  const id = branchTargetId(branchId, yearMonth);
  const ref = doc(db, "branchMonthlyTargets", id);
  const existing = await getDoc(ref);
  const now = Timestamp.now();

  const payload: Record<string, unknown> = {
    id,
    branchId,
    yearMonth,
    updatedBy: uid,
    updatedAt: now,
  };
  for (const field of TARGET_FIELDS) {
    payload[field] = normalizeTarget(input[field]);
  }

  if (existing.exists()) {
    // createdBy/createdAt은 보존한다 (merge)
    await setDoc(ref, payload, { merge: true });
  } else {
    await setDoc(ref, { ...payload, createdBy: uid, createdAt: now });
  }
  return id;
}

export async function getBranchTarget(
  branchId: string,
  yearMonth: string
): Promise<BranchMonthlyTarget | null> {
  const snap = await getDoc(doc(db, "branchMonthlyTargets", branchTargetId(branchId, yearMonth)));
  return snap.exists() ? (snap.data() as BranchMonthlyTarget) : null;
}

// 해당 월 전 지점 목표 (admin 전용 조회 — equality 필터만 사용해 복합 색인 불필요)
export async function getBranchTargetsByMonth(
  yearMonth: string
): Promise<BranchMonthlyTarget[]> {
  const snap = await getDocs(
    query(collection(db, "branchMonthlyTargets"), where("yearMonth", "==", yearMonth))
  );
  return snap.docs.map((d) => d.data() as BranchMonthlyTarget);
}

// ── 달성률 ────────────────────────────────────────────────────────────────────

export type AchievementStatus = "achieved" | "warning" | "behind" | "unset";

export const ACHIEVEMENT_LABEL: Record<AchievementStatus, string> = {
  achieved: "달성",
  warning: "주의",
  behind: "미달",
  unset: "목표 미설정",
};

export interface Achievement {
  target: number | null;
  actual: number;
  rate: number | null; // 목표 미설정이면 null (0%로 표시하지 않는다)
  status: AchievementStatus;
}

/**
 * 달성률 = 실적 / 목표 × 100.
 * 목표가 없거나 0이면 rate를 계산하지 않고 "목표 미설정"으로 둔다.
 * 색상만이 아니라 텍스트 상태(ACHIEVEMENT_LABEL)로도 표시한다.
 */
export function calcAchievement(target: number | null | undefined, actual: number): Achievement {
  if (target === null || target === undefined || target <= 0) {
    return { target: target ?? null, actual, rate: null, status: "unset" };
  }
  const rate = (actual / target) * 100;
  const status: AchievementStatus = rate >= 100 ? "achieved" : rate >= 80 ? "warning" : "behind";
  return { target, actual, rate, status };
}
