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
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  SHIFT_CONTENT_MAX_LENGTH,
  SHIFT_EDIT_HISTORY_LIMIT,
  type BranchShiftReport,
  type ShiftReportEdit,
  type ShiftReportStatus,
  type ShiftType,
} from "@/types";
import { isValidDateKey } from "@/lib/utils";
import { resolveSubmissionState, shiftDeadlineAt } from "@/lib/shiftSchedule";

// 기한·제출상태 계산은 Firestore 의존성이 없어 lib/shiftSchedule.ts 에 둔다.
// 호출부가 한 모듈만 import 하면 되도록 여기서 다시 내보낸다.
export { resolveSubmissionState, shiftDeadlineAt };

/* ══════════════════════════════════════════════════════════════════════════
   지점별 일일보고 (오전 / 마감)

   저장 원칙
   ─────────
   1. 문서 ID = {branchId}_{reportDate}_{shift}
      같은 지점·날짜·보고 유형은 문서가 하나뿐이므로 중복 제출이 구조적으로 불가능하다.
   2. 정시/지연 여부는 저장하지 않는다.
      submittedAt(서버 시각)과 기한을 조회 시점에 비교해서 계산한다.
      → 기한 정책이 바뀌어도 과거 기록을 고치지 않아도 되고,
        클라이언트가 "정시"라고 주장하는 값을 그대로 믿는 일도 없다.
   3. dailyReports / promotions / KPI 컬렉션은 건드리지 않는다. 완전히 별개 저장소다.
   ══════════════════════════════════════════════════════════════════════════ */

const COLLECTION = "branchShiftReports";

export function shiftReportId(branchId: string, reportDate: string, shift: ShiftType): string {
  return `${branchId}_${reportDate}_${shift}`.replaceAll("/", "-");
}

// ─── 조회 ────────────────────────────────────────────────────────────────────

export async function getShiftReport(
  branchId: string,
  reportDate: string,
  shift: ShiftType
): Promise<BranchShiftReport | null> {
  const snap = await getDoc(doc(db, COLLECTION, shiftReportId(branchId, reportDate, shift)));
  return snap.exists() ? (snap.data() as BranchShiftReport) : null;
}

/** 한 지점의 특정 날짜 오전·마감 보고를 함께 읽는다. */
export async function getShiftReportsForDay(
  branchId: string,
  reportDate: string
): Promise<Record<ShiftType, BranchShiftReport | null>> {
  const [morning, closing] = await Promise.all([
    getShiftReport(branchId, reportDate, "morning"),
    getShiftReport(branchId, reportDate, "closing"),
  ]);
  return { morning, closing };
}

/**
 * 날짜 구간 조회. branchId를 주면 해당 지점만, 없으면 전 지점(본사 전용).
 * reportDate는 "YYYY-MM-DD" 문자열이라 사전식 비교가 곧 날짜 비교다.
 */
export async function getShiftReportsInRange(params: {
  from: string;
  to: string;
  branchId?: string;
}): Promise<BranchShiftReport[]> {
  const { from, to, branchId } = params;

  const constraints = [
    ...(branchId ? [where("branchId", "==", branchId)] : []),
    where("reportDate", ">=", from),
    where("reportDate", "<=", to),
    orderBy("reportDate", "desc"),
  ];

  const snap = await getDocs(query(collection(db, COLLECTION), ...constraints));
  return snap.docs.map((d) => d.data() as BranchShiftReport);
}

// ─── 저장 ────────────────────────────────────────────────────────────────────

export interface SaveShiftReportInput {
  branchId: string;
  branchName: string;
  reportDate: string;
  shift: ShiftType;
  content: string;
  status: ShiftReportStatus;
  writerUid: string;
  writerName: string;
}

/**
 * 임시저장 / 제출 공용 저장.
 *
 * - 제출(submitted) 이후에는 임시저장(draft)으로 되돌리지 않는다.
 * - 제출된 보고의 본문이 바뀌면 수정 이력을 남긴다.
 *   (배열 원소에는 serverTimestamp를 넣을 수 없어 Timestamp.now()를 쓴다.
 *    따라서 수정 시각은 클라이언트 시각이다. 권위 있는 값은 submittedAt 하나뿐이다.)
 */
export async function saveShiftReport(input: SaveShiftReportInput): Promise<string> {
  const { branchId, branchName, reportDate, shift, status, writerUid, writerName } = input;

  if (!branchId) throw new Error("branchId is missing");
  if (!writerUid) throw new Error("writerUid is missing");
  if (!isValidDateKey(reportDate)) throw new Error("reportDate is invalid");

  const content = input.content.trim();
  if (content.length > SHIFT_CONTENT_MAX_LENGTH) {
    throw new Error("content-too-long");
  }
  if (status === "submitted" && content.length === 0) {
    throw new Error("content-empty");
  }

  const id = shiftReportId(branchId, reportDate, shift);
  const ref = doc(db, COLLECTION, id);
  const existing = await getDoc(ref);

  if (!existing.exists()) {
    await setDoc(ref, {
      id,
      branchId,
      branchName,
      reportDate,
      shift,
      content,
      status,
      writerUid,
      writerName,
      editCount: 0,
      edits: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...(status === "submitted" ? { submittedAt: serverTimestamp() } : {}),
    });
    return id;
  }

  const prev = existing.data() as BranchShiftReport;

  // 제출된 보고를 임시저장으로 되돌리지 않는다
  const nextStatus: ShiftReportStatus = prev.status === "submitted" ? "submitted" : status;

  const isEditAfterSubmit = prev.status === "submitted" && prev.content !== content;

  const edits: ShiftReportEdit[] = isEditAfterSubmit
    ? [
        ...(prev.edits ?? []),
        {
          editedAt: Timestamp.now(),
          editedByUid: writerUid,
          editedByName: writerName,
          previousContent: prev.content ?? "",
        },
      ].slice(-SHIFT_EDIT_HISTORY_LIMIT)
    : (prev.edits ?? []);

  // writerUid / writerName 은 최초 작성자를 그대로 유지한다.
  // 다른 담당자가 고친 경우는 edits 이력에만 남는다 (규칙에서도 변경을 막는다).
  await updateDoc(ref, {
    content,
    status: nextStatus,
    branchName,
    edits,
    editCount: (prev.editCount ?? 0) + (isEditAfterSubmit ? 1 : 0),
    updatedAt: serverTimestamp(),
    // 최초 제출 시각만 기록한다 (수정해도 제출 시각은 바뀌지 않는다)
    ...(nextStatus === "submitted" && !prev.submittedAt ? { submittedAt: serverTimestamp() } : {}),
  });

  return id;
}
