/* 기존 Firebase Auth 계정을 Firestore 프로필에 연결할 때
   "어느 지점 문서를 어떻게 고칠지" 결정하는 순수 로직.

   Firestore 의존성이 없어 단독 테스트할 수 있다.
   실제 쓰기는 services/users.ts 의 linkExistingAuthAccount 가 담당한다. */

export interface LinkAccountPlan {
  /** 이 지점의 managerUids 에 uid 를 추가한다 */
  branchToAdd: string;
  /**
   * 이 지점들의 managerUids 에서 uid 를 뺀다.
   * 담당 지점을 바꿔 연결하는 경우, 이전 지점에 uid 가 남아
   * "담당자 목록"과 "사용자의 branchIds"가 어긋나는 것을 막는다.
   * 다른 담당자의 uid 는 건드리지 않는다.
   */
  branchesToRemove: string[];
  /** 연결 후 사용자의 담당 지점 — 요구사항상 항상 정확히 하나 */
  nextBranchIds: string[];
}

export function planLinkAccount(params: {
  branchId: string;
  /** 연결 전 사용자 문서의 branchIds (문서가 없으면 빈 배열) */
  previousBranchIds?: string[] | null;
}): LinkAccountPlan {
  const { branchId } = params;
  const previous = Array.isArray(params.previousBranchIds) ? params.previousBranchIds : [];

  return {
    branchToAdd: branchId,
    branchesToRemove: previous.filter((id) => id && id !== branchId),
    nextBranchIds: [branchId],
  };
}
