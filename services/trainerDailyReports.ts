import {
  collection,
  doc,
  setDoc,
  getDocs,
  query,
  where,
  orderBy,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { TrainerDailyReport } from "@/types";

// ── Validation ────────────────────────────────────────────────────────────────

// 빈 값 → 0, 음수 금지, 소수점 금지 (정수만), NaN/Infinity 금지
function sanitizeCount(v: number | undefined | null): number {
  if (v === undefined || v === null || isNaN(v) || !isFinite(v)) return 0;
  return Math.max(0, Math.floor(v));
}

// ── Document ID ───────────────────────────────────────────────────────────────

export function trainerDailyReportId(
  branchId: string,
  reportDate: string,
  trainerId: string
): string {
  return `${branchId}_${reportDate}_${trainerId}`;
}

// ── Upsert ────────────────────────────────────────────────────────────────────

export type UpsertTrainerDailyReportInput = {
  branchId: string;
  reportDate: string;
  trainerId: string;
  trainerName: string;
  ptSessionCount?: number | null;
  otSessionCount?: number | null;
  groupSessionCount?: number | null;
  otherSessionCount?: number | null;
  memo?: string;
  writerUid: string;
  isTestData?: boolean;
};

export async function upsertTrainerDailyReport(
  input: UpsertTrainerDailyReportInput
): Promise<string> {
  const ptSessionCount = sanitizeCount(input.ptSessionCount);
  const otSessionCount = sanitizeCount(input.otSessionCount);
  const groupSessionCount = sanitizeCount(input.groupSessionCount);
  const otherSessionCount = sanitizeCount(input.otherSessionCount);
  const totalSessionCount =
    ptSessionCount + otSessionCount + groupSessionCount + otherSessionCount;

  const id = trainerDailyReportId(input.branchId, input.reportDate, input.trainerId);
  const now = Timestamp.now();

  // undefined는 Firestore에 저장하지 않는다 — memo는 값이 있을 때만 포함
  const memo = input.memo?.trim();

  const data: Record<string, unknown> = {
    id,
    branchId: input.branchId,
    reportDate: input.reportDate,
    trainerId: input.trainerId,
    trainerName: input.trainerName,
    ptSessionCount,
    otSessionCount,
    groupSessionCount,
    otherSessionCount,
    totalSessionCount,
    memo: memo || "",
    writerUid: input.writerUid,
    createdAt: now,
    updatedAt: now,
  };

  if (input.isTestData !== undefined) {
    data.isTestData = input.isTestData;
  }

  // merge:true — 같은 ID 재저장 시 업데이트 (중복 문서 생성 없음)
  await setDoc(doc(db, "trainerDailyReports", id), data, { merge: true });

  return id;
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function getTrainerDailyReportsByBranchAndDate(
  branchId: string,
  reportDate: string
): Promise<TrainerDailyReport[]> {
  // Equality-only filters use single-field auto-indexes — no composite index needed.
  const snap = await getDocs(
    query(
      collection(db, "trainerDailyReports"),
      where("branchId", "==", branchId),
      where("reportDate", "==", reportDate)
    )
  );
  return snap.docs
    .map((d) => ({ ...d.data() } as TrainerDailyReport))
    .sort((a, b) => a.trainerName.localeCompare(b.trainerName, "ko"));
}

export async function getTrainerDailyReportsByPeriod(
  branchId: string,
  fromDate: string,
  toDate: string
): Promise<TrainerDailyReport[]> {
  const snap = await getDocs(
    query(
      collection(db, "trainerDailyReports"),
      where("branchId", "==", branchId),
      where("reportDate", ">=", fromDate),
      where("reportDate", "<=", toDate),
      orderBy("reportDate", "asc")
    )
  );
  return snap.docs
    .map((d) => ({ ...d.data() } as TrainerDailyReport))
    .sort((a, b) =>
      a.reportDate !== b.reportDate
        ? a.reportDate.localeCompare(b.reportDate)
        : a.trainerName.localeCompare(b.trainerName, "ko")
    );
}

export async function getAllTrainerDailyReportsByPeriod(
  fromDate: string,
  toDate: string
): Promise<TrainerDailyReport[]> {
  const snap = await getDocs(
    query(
      collection(db, "trainerDailyReports"),
      where("reportDate", ">=", fromDate),
      where("reportDate", "<=", toDate),
      orderBy("reportDate", "asc")
    )
  );
  return snap.docs.map((d) => ({ ...d.data() } as TrainerDailyReport));
}

export async function getTrainerDailyReportsByTrainer(
  trainerId: string,
  fromDate: string,
  toDate: string
): Promise<TrainerDailyReport[]> {
  const snap = await getDocs(
    query(
      collection(db, "trainerDailyReports"),
      where("trainerId", "==", trainerId),
      where("reportDate", ">=", fromDate),
      where("reportDate", "<=", toDate),
      orderBy("reportDate", "asc")
    )
  );
  return snap.docs.map((d) => ({ ...d.data() } as TrainerDailyReport));
}
