import {
  collection,
  doc,
  setDoc,
  getDocs,
  getCountFromServer,
  query,
  where,
  orderBy,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { TrainerSession } from "@/types";

// ── Validation ────────────────────────────────────────────────────────────────

// 빈 값 → 0, 음수 금지, 소수점 금지 (정수만), NaN/Infinity 금지
function sanitizeCount(v: number | undefined | null): number {
  if (v === undefined || v === null || isNaN(v) || !isFinite(v)) return 0;
  return Math.max(0, Math.floor(v));
}

// ── Document ID ───────────────────────────────────────────────────────────────
// 같은 지점·날짜·트레이너 조합은 문서 1개만 존재한다. 트레이너 자체는 지점 소속이
// 없으므로, 지점 구분은 이 ID(및 branchId 필드)에만 존재한다.

export function trainerSessionId(branchId: string, date: string, trainerId: string): string {
  return `${branchId}_${date}_${trainerId}`;
}

// ── Upsert ────────────────────────────────────────────────────────────────────

export type UpsertTrainerSessionInput = {
  branchId: string;
  date: string;
  trainerId: string;
  trainerName: string;
  ptSessionCount?: number | null;
  otSessionCount?: number | null;
  groupSessionCount?: number | null;
  otherSessionCount?: number | null;
  memo?: string;
  createdBy: string;
  isTestData?: boolean;
};

export async function upsertTrainerSession(
  input: UpsertTrainerSessionInput
): Promise<string> {
  const ptSessionCount = sanitizeCount(input.ptSessionCount);
  const otSessionCount = sanitizeCount(input.otSessionCount);
  const groupSessionCount = sanitizeCount(input.groupSessionCount);
  const otherSessionCount = sanitizeCount(input.otherSessionCount);
  const totalSessionCount =
    ptSessionCount + otSessionCount + groupSessionCount + otherSessionCount;

  const id = trainerSessionId(input.branchId, input.date, input.trainerId);
  const now = Timestamp.now();

  // undefined는 Firestore에 저장하지 않는다 — memo는 값이 있을 때만 포함
  const memo = input.memo?.trim();

  const data: Record<string, unknown> = {
    id,
    trainerId: input.trainerId,
    trainerName: input.trainerName,
    branchId: input.branchId,
    date: input.date,
    ptSessionCount,
    otSessionCount,
    groupSessionCount,
    otherSessionCount,
    totalSessionCount,
    memo: memo || "",
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };

  if (input.isTestData !== undefined) {
    data.isTestData = input.isTestData;
  }

  // merge:true — 같은 ID 재저장 시 업데이트 (중복 문서 생성 없음)
  await setDoc(doc(db, "trainerSessions", id), data, { merge: true });

  return id;
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function getTrainerSessionsByBranchAndDate(
  branchId: string,
  date: string
): Promise<TrainerSession[]> {
  // Equality-only filters use single-field auto-indexes — no composite index needed.
  const snap = await getDocs(
    query(
      collection(db, "trainerSessions"),
      where("branchId", "==", branchId),
      where("date", "==", date)
    )
  );
  return snap.docs
    .map((d) => ({ ...d.data() } as TrainerSession))
    .sort((a, b) => a.trainerName.localeCompare(b.trainerName, "ko"));
}

export async function getTrainerSessionsByPeriod(
  branchId: string,
  fromDate: string,
  toDate: string
): Promise<TrainerSession[]> {
  const snap = await getDocs(
    query(
      collection(db, "trainerSessions"),
      where("branchId", "==", branchId),
      where("date", ">=", fromDate),
      where("date", "<=", toDate),
      orderBy("date", "asc")
    )
  );
  return snap.docs
    .map((d) => ({ ...d.data() } as TrainerSession))
    .sort((a, b) =>
      a.date !== b.date
        ? a.date.localeCompare(b.date)
        : a.trainerName.localeCompare(b.trainerName, "ko")
    );
}

export async function getAllTrainerSessionsByPeriod(
  fromDate: string,
  toDate: string
): Promise<TrainerSession[]> {
  const snap = await getDocs(
    query(
      collection(db, "trainerSessions"),
      where("date", ">=", fromDate),
      where("date", "<=", toDate),
      orderBy("date", "asc")
    )
  );
  return snap.docs.map((d) => ({ ...d.data() } as TrainerSession));
}

// 트레이너 통합(merge) 검토 화면에서 "이전 대상 trainerId의 기존 세션 개수"를 보여주기 위한 조회.
// trainerId 단일 필드 where만 사용하므로 별도 복합 색인 없이 동작한다.
export async function getTrainerSessionCountByTrainerId(trainerId: string): Promise<number> {
  const snap = await getCountFromServer(
    query(collection(db, "trainerSessions"), where("trainerId", "==", trainerId))
  );
  return snap.data().count;
}
