import { SHIFT_EDIT_HISTORY_LIMIT, type BranchShiftReport, type ShiftReportEdit, type ShiftReportStatus } from "@/types";

/* ══════════════════════════════════════════════════════════════════════════
   지점별 일일보고 저장 시 "무엇을 어떻게 바꿀지" 결정하는 순수 로직.

   Firestore 의존성이 없어 단독으로 테스트할 수 있다.
   실제 쓰기(serverTimestamp 적용)는 services/shiftReports.ts 가 담당한다.

   여기서 지키는 규칙
   ─────────────────
   1. submittedAt(최초 제출 시각)은 최초 제출 때 한 번만 기록한다.
      이후 몇 번을 수정해도 다시 쓰지 않는다. → setSubmittedAt
   2. 제출된 보고는 임시저장으로 되돌아가지 않는다. → nextStatus
   3. 제출 이후 본문이 바뀌면 이전 버전을 이력에 남긴다. → nextEdits
      이력의 시각은 기기 시계가 아니라, 문서에 이미 저장돼 있던
      updatedAt(서버 시각)을 복사해 쓴다.
   ══════════════════════════════════════════════════════════════════════════ */

export interface ShiftWritePlan {
  /** 새 문서를 만드는가 (기존 문서가 없을 때) */
  isCreate: boolean;
  /** 저장 후 상태 */
  nextStatus: ShiftReportStatus;
  /** 제출 이후 본문이 바뀐 수정인가 */
  isEditAfterSubmit: boolean;
  /** 이번 쓰기에서 submittedAt 을 새로 기록해야 하는가 (최초 제출일 때만 true) */
  setSubmittedAt: boolean;
  nextEditCount: number;
  nextEdits: ShiftReportEdit[];
}

type PrevReport = Pick<
  BranchShiftReport,
  "status" | "content" | "edits" | "editCount" | "submittedAt" | "updatedAt"
>;

export function planShiftReportWrite(
  prev: PrevReport | null,
  input: { content: string; status: ShiftReportStatus; writerUid: string; writerName: string }
): ShiftWritePlan {
  if (!prev) {
    return {
      isCreate: true,
      nextStatus: input.status,
      isEditAfterSubmit: false,
      setSubmittedAt: input.status === "submitted",
      nextEditCount: 0,
      nextEdits: [],
    };
  }

  const wasSubmitted = prev.status === "submitted";

  // 제출된 보고를 임시저장으로 되돌리지 않는다
  const nextStatus: ShiftReportStatus = wasSubmitted ? "submitted" : input.status;

  const isEditAfterSubmit = wasSubmitted && prev.content !== input.content;

  const nextEdits: ShiftReportEdit[] = isEditAfterSubmit
    ? [
        ...(prev.edits ?? []),
        {
          // 기기 시각이 아니라, 이미 저장돼 있던 서버 시각을 복사한다
          previousVersionAt: prev.updatedAt,
          editedByUid: input.writerUid,
          editedByName: input.writerName,
          previousContent: prev.content ?? "",
        },
      ].slice(-SHIFT_EDIT_HISTORY_LIMIT)
    : (prev.edits ?? []);

  return {
    isCreate: false,
    nextStatus,
    isEditAfterSubmit,
    // 핵심: 이미 submittedAt 이 있으면 절대 다시 쓰지 않는다
    setSubmittedAt: nextStatus === "submitted" && !prev.submittedAt,
    nextEditCount: (prev.editCount ?? 0) + (isEditAfterSubmit ? 1 : 0),
    nextEdits,
  };
}
