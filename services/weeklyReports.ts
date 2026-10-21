import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { WEEKLY_CONTENT_MAX_LENGTH, type BranchWeeklyReport, type WeeklyReportStatus } from "@/types";
import { isValidDateKey } from "@/lib/utils";
import { weekEndOf, weekStartOf } from "@/lib/weekSchedule";
import { planWeeklyReportWrite, resolveWeeklyState } from "@/lib/weeklyReportWrite";

// 상태 판정은 Firestore 의존성이 없어 lib 에 둔다. 호출부 편의를 위해 다시 내보낸다.
export { resolveWeeklyState };

/* ══════════════════════════════════════════════════════════════════════════
   주간보고 (월요일 ~ 일요일, KST)

   1. 문서 ID = {branchId}_{weekStartDate}
      같은 지점·같은 주차는 문서가 하나뿐이라 중복 생성이 구조적으로 불가능하다.
   2. 보고 대상 주차(weekStartDate)와 실제 제출 시각(submittedAt)은 별개로 기록한다.
      submittedAt 은 serverTimestamp 라 기기 시계와 무관하다.
   3. 제출 마감시간이 없어 지연 판정을 하지 않는다.
   4. branchShiftReports / dailyReports / promotions / KPI 는 건드리지 않는다.
   ══════════════════════════════════════════════════════════════════════════ */

const COLLECTION = "branchWeeklyReports";

export function weeklyReportId(branchId: string, weekStartDate: string): string {
  return `${branchId}_${weekStartDate}`.replaceAll("/", "-");
}

// ─── 조회 ────────────────────────────────────────────────────────────────────

export async function getWeeklyReport(
  branchId: string,
  weekStartDate: string
): Promise<BranchWeeklyReport | null> {
  const snap = await getDoc(doc(db, COLLECTION, weeklyReportId(branchId, weekStartDate)));
  return snap.exists() ? (snap.data() as BranchWeeklyReport) : null;
}

/**
 * 주차 구간 조회. branchId를 주면 해당 지점만, 없으면 전 지점(본사 전용).
 * weekStartDate 는 "YYYY-MM-DD" 문자열이라 사전식 비교가 곧 날짜 비교다.
 */
export async function getWeeklyReportsInRange(params: {
  fromWeekStart: string;
  toWeekStart: string;
  branchId?: string;
}): Promise<BranchWeeklyReport[]> {
  const { fromWeekStart, toWeekStart, branchId } = params;

  const constraints = [
    ...(branchId ? [where("branchId", "==", branchId)] : []),
    where("weekStartDate", ">=", fromWeekStart),
    where("weekStartDate", "<=", toWeekStart),
    orderBy("weekStartDate", "desc"),
  ];

  const snap = await getDocs(query(collection(db, COLLECTION), ...constraints));
  return snap.docs.map((d) => d.data() as BranchWeeklyReport);
}

// ─── 저장 ────────────────────────────────────────────────────────────────────

export interface SaveWeeklyReportInput {
  branchId: string;
  branchName: string;
  weekStartDate: string;
  content: string;
  status: WeeklyReportStatus;
  uid: string;
  name: string;
}

/**
 * 임시저장 / 제출 공용 저장.
 * - 제출 이후에는 임시저장으로 되돌리지 않는다.
 * - 빈 내용은 제출할 수 없다.
 * - 최초 제출 시각은 한 번만 기록하고, 수정 이력은 따로 쌓는다.
 */
export async function saveWeeklyReport(input: SaveWeeklyReportInput): Promise<string> {
  const { branchId, branchName, weekStartDate, status, uid, name } = input;

  if (!branchId) throw new Error("branchId is missing");
  if (!uid) throw new Error("uid is missing");
  if (!isValidDateKey(weekStartDate)) throw new Error("week-invalid");
  // 주 시작일은 반드시 월요일이어야 한다 (문서 ID 규칙과 보안 규칙이 이를 전제한다)
  if (weekStartOf(weekStartDate) !== weekStartDate) throw new Error("week-not-monday");

  const content = input.content.trim();
  if (content.length > WEEKLY_CONTENT_MAX_LENGTH) throw new Error("content-too-long");
  if (status === "submitted" && content.length === 0) throw new Error("content-empty");

  const id = weeklyReportId(branchId, weekStartDate);
  const ref = doc(db, COLLECTION, id);
  const existing = await getDoc(ref);
  const prev = existing.exists() ? (existing.data() as BranchWeeklyReport) : null;

  const plan = planWeeklyReportWrite(prev, { content, status, uid, name });

  if (plan.isCreate) {
    await setDoc(ref, {
      id,
      branchId,
      branchName,
      weekStartDate,
      weekEndDate: weekEndOf(weekStartDate),
      content,
      status: plan.nextStatus,
      editCount: 0,
      editHistory: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: uid,
      updatedByName: name,
      ...(plan.setSubmittedAt
        ? { submittedAt: serverTimestamp(), submittedBy: uid, submittedByName: name }
        : {}),
    });
    return id;
  }

  await updateDoc(ref, {
    content,
    status: plan.nextStatus,
    branchName,
    editCount: plan.nextEditCount,
    editHistory: plan.nextEditHistory,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
    updatedByName: name,
    // 최초 제출일 때만 기록한다 — 이후 수정에서는 건드리지 않는다
    ...(plan.setSubmittedAt
      ? { submittedAt: serverTimestamp(), submittedBy: uid, submittedByName: name }
      : {}),
  });

  return id;
}
