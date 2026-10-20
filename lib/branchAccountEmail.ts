/* 지점 운영계정 이메일 결정 규칙

   운영계정은 개인이 아니라 지점 기준으로 만든다 (지점 1개 = 운영계정 1개).
   기본값은 {branchId}@returnlife.co.kr 이지만, 본사가 아이디를 따로 지정한
   지점은 그 주소를 쓴다.

   page.tsx 는 default export 외의 임의 export 를 둘 수 없어 별도 모듈로 분리했다.
   덕분에 매핑 규칙을 단위 테스트할 수 있다. */

export const EMAIL_DOMAIN = "returnlife.co.kr";

/**
 * 본사가 아이디를 지정한 지점.
 *
 * 지점명 전체 일치가 아니라 식별 키워드 포함 여부로 찾는다.
 * 지점명에 브랜드 접두사가 붙고("머팩 벌리점", "짐플릭스 시청점")
 * 브랜드가 바뀌면 이름도 바뀌기 때문에, 전체 일치로 묶어두면
 * 이름이 조금만 달라져도 조용히 매칭에 실패한다.
 */
export const BRANCH_EMAIL_OVERRIDES: { keyword: string; email: string }[] = [
  { keyword: "벌리", email: `beolli@${EMAIL_DOMAIN}` },
  { keyword: "보건대", email: `bogeondae@${EMAIL_DOMAIN}` },
  { keyword: "신진주역", email: `sinjinju@${EMAIL_DOMAIN}` },
  // 시청점은 실제 발급된 계정이 브랜드명(gymflix) 기준이다 — 2026-10-20 확인
  { keyword: "시청", email: `gymflix@${EMAIL_DOMAIN}` },
];

/**
 * branchId 기반 기본 이메일 — 이메일에 쓸 수 없는 문자는 하이픈으로 변환한다.
 *
 * branchId 가 전부 한글이면 변환 후 아이디 부분이 비어 "@returnlife.co.kr" 같은
 * 잘못된 주소가 나온다. 그럴 때는 빈 문자열을 돌려줘서 화면이 "이메일 필요" 로
 * 표시하고 관리자가 직접 입력하게 한다 (잘못된 주소를 기본값으로 채우지 않는다).
 */
export function branchEmailOf(branchId: string): string {
  const local = branchId
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  if (!local) return "";
  return `${local}@${EMAIL_DOMAIN}`;
}

/**
 * 지정 아이디가 있으면 그것을, 없으면 branchId 기반 기본 이메일을 돌려준다.
 * 기본 이메일을 만들 수 없으면 빈 문자열("관리자가 직접 입력")을 돌려준다.
 */
export function defaultEmailFor(branchName: string, branchId: string): string {
  const override = BRANCH_EMAIL_OVERRIDES.find((o) => branchName.includes(o.keyword));
  return override ? override.email : branchEmailOf(branchId);
}
