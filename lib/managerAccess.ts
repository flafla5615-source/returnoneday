/* 1단계 개편: 지점장 화면은 홈과 지점별 일일보고만 남긴다.

   메뉴에서 링크를 지우는 것만으로는 URL 직접 입력을 막을 수 없으므로
   레이아웃에서 이 화이트리스트로 경로를 검사한다.
   (숨긴 화면의 코드와 Firestore 원본 데이터는 그대로 보존한다 — 노출만 차단.)

   주의: "/manager" 를 접두사로 취급하면 /manager/* 전체가 통과해버린다.
   홈은 반드시 정확히 일치할 때만 허용한다. */

/** 정확히 이 경로일 때만 허용 */
const ALLOWED_EXACT = ["/manager"];

/** 이 경로이거나 그 하위 경로일 때 허용 */
const ALLOWED_PREFIX = ["/manager/shift-reports", "/manager/weekly-reports"];

export function isAllowedManagerPath(pathname: string): boolean {
  // 끝의 슬래시는 무시한다 ("/manager/" 도 홈으로 본다)
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

  if (ALLOWED_EXACT.includes(path)) return true;
  return ALLOWED_PREFIX.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
