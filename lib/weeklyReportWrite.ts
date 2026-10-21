import {
  WEEKLY_EDIT_HISTORY_LIMIT,
  type BranchWeeklyReport,
  type WeeklyReportEdit,
  type WeeklyReportState,
  type WeeklyReportStatus,
} from "@/types";

/* 주간보고 저장 시 "무엇을 어떻게 바꿀지" 결정하는 순수 로직.
   Firestore 의존성이 없어 단독 테스트할 수 있다.
   실제 쓰기(serverTimestamp 적용)는 services/weeklyReports.ts 가 담당한다.

   지키는 규칙
   1. submittedAt(최초 제출 시각)은 최초 제출 때 한 번만 기록한다.
   2. 제출된 보고는 임시저장으로 되돌아가지 않는다.
   3. 제출 이후 본문이 바뀌면 이전 버전을 이력에 남긴다.
      이력 시각은 기기 시계가 아니라 문서에 이미 저장돼 있던 updatedAt(서버 시각)을 복사한다. */

export interface WeeklyWritePlan {
  isCreate: boolean;
  nextStatus: WeeklyReportStatus;
  isEditAfterSubmit: boolean;
  /** 이번 쓰기에서 submittedAt 을 새로 기록해야 하는가 (최초 제출일 때만 true) */
  setSubmittedAt: boolean;
  nextEditCount: number;
  nextEditHistory: WeeklyReportEdit[];
}

type PrevReport = Pick<
  BranchWeeklyReport,
  "status" | "content" | "editHistory" | "editCount" | "submittedAt" | "updatedAt"
>;

export function planWeeklyReportWrite(
  prev: PrevReport | null,
  input: { content: string; status: WeeklyReportStatus; uid: string; name: string }
): WeeklyWritePlan {
  if (!prev) {
    return {
      isCreate: true,
      nextStatus: input.status,
      isEditAfterSubmit: false,
      setSubmittedAt: input.status === "submitted",
      nextEditCount: 0,
      nextEditHistory: [],
    };
  }

  const wasSubmitted = prev.status === "submitted";
  const nextStatus: WeeklyReportStatus = wasSubmitted ? "submitted" : input.status;
  const isEditAfterSubmit = wasSubmitted && prev.content !== input.content;

  const nextEditHistory: WeeklyReportEdit[] = isEditAfterSubmit
    ? [
        ...(prev.editHistory ?? []),
        {
          previousVersionAt: prev.updatedAt,
          editedByUid: input.uid,
          editedByName: input.name,
          previousContent: prev.content ?? "",
        },
      ].slice(-WEEKLY_EDIT_HISTORY_LIMIT)
    : (prev.editHistory ?? []);

  return {
    isCreate: false,
    nextStatus,
    isEditAfterSubmit,
    // 핵심: 이미 submittedAt 이 있으면 절대 다시 쓰지 않는다
    setSubmittedAt: nextStatus === "submitted" && !prev.submittedAt,
    nextEditCount: (prev.editCount ?? 0) + (isEditAfterSubmit ? 1 : 0),
    nextEditHistory,
  };
}

/** 주차별 작성 상태 — 마감시간이 없으므로 지연 판정 없이 문서 상태만 본다. */
export function resolveWeeklyState(
  report: Pick<BranchWeeklyReport, "status"> | null | undefined
): WeeklyReportState {
  if (report?.status === "submitted") return "submitted";
  if (report?.status === "draft") return "draft";
  return "none";
}
