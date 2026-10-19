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

/* ── 보고일 vs 실제 제출일 ───────────────────────────────────────────────────
   reportDate(보고일)와 submittedAt(실제 제출 시각)은 다른 값이다.
   지난 날짜를 나중에 채워 넣는 소급 작성이 허용되므로, 화면에서는 둘을 항상
   구분해서 보여준다. "며칠 늦었는지"도 저장하지 않고 여기서 계산한다. */

/** 어떤 시각이 KST 기준 며칠인지 ("YYYY-MM-DD"). KST는 고정 +09:00 이라 단순 가산으로 정확하다. */
export function kstDateKey(date: Date): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function dayIndexOf(dateKey: string): number {
  return Math.floor(Date.parse(`${dateKey}T00:00:00Z`) / 86400000);
}

/** b - a (일 단위). 같은 날이면 0, b가 뒤면 양수. */
export function daysBetweenDateKeys(a: string, b: string): number {
  return dayIndexOf(b) - dayIndexOf(a);
}

export interface ShiftSubmissionInfo {
  state: ShiftSubmissionState;
  /** 실제 제출 시각 (미제출이면 null) */
  submittedAt: Date | null;
  /** 보고일 기준 제출 기한 */
  deadline: Date;
  /** 보고일이 지난 뒤에 제출한 소급 작성인가 */
  backdated: boolean;
  /** 보고일로부터 며칠 뒤에 제출했는가 (같은 날 제출이면 0) */
  daysAfterReportDate: number;
}

/**
 * 제출 상태 + 보고일/제출일 차이를 한 번에 계산한다.
 * 화면에서 "정시/지연" 뱃지와 "N일 뒤 소급 작성" 문구를 같은 근거로 그리기 위한 함수.
 */
export function describeSubmission(
  report: Pick<BranchShiftReport, "status" | "submittedAt" | "updatedAt"> | null | undefined,
  reportDate: string,
  shift: ShiftType,
  now: Date = new Date()
): ShiftSubmissionInfo {
  const deadline = shiftDeadlineAt(reportDate, shift);
  const state = resolveSubmissionState(report, reportDate, shift, now);

  const submittedAt =
    report?.status === "submitted"
      ? (toDateSafe(report.submittedAt) ?? toDateSafe(report.updatedAt))
      : null;

  const daysAfterReportDate = submittedAt
    ? daysBetweenDateKeys(reportDate, kstDateKey(submittedAt))
    : 0;

  return {
    state,
    submittedAt,
    deadline,
    backdated: daysAfterReportDate > 0,
    daysAfterReportDate,
  };
}

/** 작성 가능한 보고일인가 — 미래 날짜만 막는다 (과거는 소급 작성 허용). */
export function isWritableReportDate(reportDate: string, now: Date = new Date()): boolean {
  return dayIndexOf(reportDate) <= dayIndexOf(kstDateKey(now));
}

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * "YYYY-MM-DD" 의 요일 한 글자.
 * 날짜 키를 UTC 자정으로 해석해 요일을 구한다 — 로컬 타임존이 무엇이든 같은 결과가 나온다.
 */
export function weekdayLabel(dateKey: string): string {
  return WEEKDAY_LABELS[new Date(`${dateKey}T00:00:00Z`).getUTCDay()];
}

/** from..to 사이의 모든 날짜 키를 최신순으로 반환한다 (양 끝 포함). */
export function listDateKeysDesc(from: string, to: string): string[] {
  const out: string[] = [];
  for (let i = dayIndexOf(to); i >= dayIndexOf(from); i -= 1) {
    out.push(new Date(i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

/** 오늘(KST)에서 days일 전의 날짜 키. */
export function shiftDateKey(dateKey: string, days: number): string {
  return new Date((dayIndexOf(dateKey) + days) * 86400000).toISOString().slice(0, 10);
}
