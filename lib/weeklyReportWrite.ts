import type { BranchWeeklyReport, WeeklyReportState } from "@/types";

/* 주간보고 상태 판정 (Firestore 의존성 없음).

   주간보고는 파일 첨부 방식이라 "제출 마감시간"이 없고, 따라서 지연 판정도 없다.
   상태는 문서의 status 로만 결정한다.

   텍스트 방식이던 시절의 저장 분기 로직(planWeeklyReportWrite)은
   파일 업로드/제출 흐름으로 대체되어 services/weeklyReports.ts 로 옮겨갔다. */

export function resolveWeeklyState(
  report: Pick<BranchWeeklyReport, "status"> | null | undefined
): WeeklyReportState {
  if (report?.status === "submitted") return "submitted";
  if (report?.status === "draft") return "draft";
  return "none";
}
