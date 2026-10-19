import {
  SHIFT_DEADLINE,
  type BranchShiftReport,
  type ShiftSubmissionState,
  type ShiftType,
} from "@/types";

/* ══════════════════════════════════════════════════════════════════════════
   지점별 일일보고 기한 계산 (Firestore 의존성 없음 — 순수 함수만)

   정시/지연 여부는 문서에 저장하지 않는다. submittedAt(서버 시각)과 기한을
   조회 시점에 비교해서 계산한다.
   → 기한 정책이 바뀌어도 과거 기록을 고칠 필요가 없고,
     클라이언트가 "정시"라고 주장하는 값을 그대로 믿는 일도 없다.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * 해당 보고의 제출 기한 (KST).
 * KST는 서머타임이 없는 고정 +09:00 이라 오프셋을 직접 박아 파싱해도 안전하다.
 * (브라우저/서버의 로컬 타임존에 영향받지 않는다.)
 */
export function shiftDeadlineAt(reportDate: string, shift: ShiftType): Date {
  return new Date(`${reportDate}T${SHIFT_DEADLINE[shift]}:00+09:00`);
}

type MaybeTimestamp = { toDate?: () => Date } | undefined;

function toDateSafe(value: MaybeTimestamp): Date | null {
  if (!value || typeof value.toDate !== "function") return null;
  return value.toDate();
}

/**
 * 제출 현황 계산 (저장값이 아니라 매번 계산한다).
 *
 * submittedAt 이 비어 있는 제출 문서는 serverTimestamp 가 아직 확정되지 않은
 * 짧은 순간에만 발생한다. 이때는 updatedAt → 현재 시각 순으로 대체해서 판정하되,
 * 없는 값을 "정시"로 가정하지는 않는다.
 */
export function resolveSubmissionState(
  report: Pick<BranchShiftReport, "status" | "submittedAt" | "updatedAt"> | null | undefined,
  reportDate: string,
  shift: ShiftType,
  now: Date = new Date()
): ShiftSubmissionState {
  const deadline = shiftDeadlineAt(reportDate, shift);

  if (report?.status === "submitted") {
    const at = toDateSafe(report.submittedAt) ?? toDateSafe(report.updatedAt) ?? now;
    return at.getTime() <= deadline.getTime() ? "on_time" : "late";
  }

  if (report?.status === "draft") return "draft";

  return now.getTime() > deadline.getTime() ? "missing" : "pending";
}
