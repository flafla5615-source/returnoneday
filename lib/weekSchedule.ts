/* 주간보고 주차 계산 (Firestore 의존성 없음 — 순수 함수만)

   한 주는 월요일 ~ 일요일, 기준 시간대는 KST.
   날짜는 일일보고와 같이 "YYYY-MM-DD" 문자열로만 다룬다.
   문자열을 UTC 자정으로 해석해 일수(day index)로 환산하므로
   브라우저/서버의 로컬 타임존에 영향받지 않는다.

   제출 마감시간은 아직 없다 — 그래서 여기에는 지연 판정 로직이 없다. */

function dayIndexOf(dateKey: string): number {
  return Math.floor(Date.parse(`${dateKey}T00:00:00Z`) / 86400000);
}

function dateKeyOf(dayIndex: number): string {
  return new Date(dayIndex * 86400000).toISOString().slice(0, 10);
}

/** 어떤 시각이 KST 기준 며칠인지 ("YYYY-MM-DD"). KST는 고정 +09:00. */
export function kstDateKey(date: Date): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * 그 날짜가 속한 주의 월요일.
 * getUTCDay() 는 일요일이 0, 월요일이 1이므로 (day + 6) % 7 이 "월요일로부터 며칠째"가 된다.
 */
export function weekStartOf(dateKey: string): string {
  const day = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  const offsetFromMonday = (day + 6) % 7;
  return dateKeyOf(dayIndexOf(dateKey) - offsetFromMonday);
}

/** 주 시작일(월요일)에 대응하는 종료일(일요일). */
export function weekEndOf(weekStartDate: string): string {
  return dateKeyOf(dayIndexOf(weekStartDate) + 6);
}

/** 주차 이동 — weeks 만큼 앞/뒤 주의 월요일을 반환한다. */
export function shiftWeek(weekStartDate: string, weeks: number): string {
  return dateKeyOf(dayIndexOf(weekStartDate) + weeks * 7);
}

/** 오늘(KST)이 속한 주의 월요일. */
export function currentWeekStart(now: Date = new Date()): string {
  return weekStartOf(kstDateKey(now));
}

/**
 * 작성 가능한 주차인가 — 미래 주차만 막는다.
 * 이번 주와 과거 주차는 모두 작성·수정할 수 있다.
 */
export function isWritableWeek(weekStartDate: string, now: Date = new Date()): boolean {
  return dayIndexOf(weekStartDate) <= dayIndexOf(currentWeekStart(now));
}

/** 주차 표기 — "2026.10.19(월) ~ 10.25(일)" */
export function weekRangeLabel(weekStartDate: string): string {
  const end = weekEndOf(weekStartDate);
  const [, sm, sd] = weekStartDate.split("-");
  const [ey, em, ed] = end.split("-");
  const startYear = weekStartDate.slice(0, 4);
  // 연말·연초에 걸치는 주는 종료일에도 연도를 적는다
  const endLabel = ey === startYear ? `${em}.${ed}` : `${ey}.${em}.${ed}`;
  return `${startYear}.${sm}.${sd} ~ ${endLabel}`;
}

/** 그 주가 몇 월 몇째 주인지 — "10월 3주차" (해당 월 첫 월요일을 1주차로 센다) */
export function weekOfMonthLabel(weekStartDate: string): string {
  const [year, month] = weekStartDate.split("-").map(Number);
  const firstOfMonth = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
  const firstMondayIndex = dayIndexOf(weekStartOf(firstOfMonth)) < dayIndexOf(firstOfMonth)
    ? dayIndexOf(weekStartOf(firstOfMonth)) + 7 // 1일이 월요일이 아니면 그 다음 월요일이 1주차
    : dayIndexOf(weekStartOf(firstOfMonth));
  const nth = Math.floor((dayIndexOf(weekStartDate) - firstMondayIndex) / 7) + 1;
  return `${month}월 ${nth}주차`;
}

/** from..to 사이 주의 시작일을 최신순으로 (양 끝 포함). 둘 다 월요일이어야 한다. */
export function listWeekStartsDesc(fromWeekStart: string, toWeekStart: string): string[] {
  const out: string[] = [];
  for (let i = dayIndexOf(toWeekStart); i >= dayIndexOf(fromWeekStart); i -= 7) {
    out.push(dateKeyOf(i));
  }
  return out;
}
