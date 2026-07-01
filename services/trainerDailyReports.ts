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

function sanitizeMoney(v: number | undefined | null): number {
  if (v === undefined || v === null || isNaN(v) || !isFinite(v)) return 0;
  return Math.max(0, Math.round(v));
}

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
  walkInSales?: number | null;
  personalSales?: number | null;
  classCount?: number | null;
  writerUid: string;
  isTestData?: boolean;
};

export async function upsertTrainerDailyReport(
  input: UpsertTrainerDailyReportInput
): Promise<string> {
  const walkInSales = sanitizeMoney(input.walkInSales);
  const personalSales = sanitizeMoney(input.personalSales);
  const totalSales = walkInSales + personalSales;
  const classCount = sanitizeCount(input.classCount);

  const id = trainerDailyReportId(input.branchId, input.reportDate, input.trainerId);
  const now = Timestamp.now();

  const data: Omit<TrainerDailyReport, "createdAt"> & { createdAt: Timestamp } = {
    id,
    branchId: input.branchId,
    reportDate: input.reportDate,
    trainerId: input.trainerId,
    trainerName: input.trainerName,
    walkInSales,
    personalSales,
    totalSales,
    classCount,
    writerUid: input.writerUid,
    createdAt: now,
    updatedAt: now,
  };

  if (input.isTestData !== undefined) {
    (data as TrainerDailyReport).isTestData = input.isTestData;
  }

  // setDoc with merge:false is idempotent for the same ID — safe upsert pattern.
  // createdAt gets overwritten here on update, but we use merge to preserve it.
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
