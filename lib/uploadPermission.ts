import type { UserProfile } from "@/types";

/* 주간보고 파일 업로드 권한을 클라이언트에서 미리 판정한다.

   Storage 규칙이 거부하면 SDK 는 storage/unauthorized 하나만 돌려준다.
   그것만으로는 "담당 지점이 아니어서"인지 "승인 대기 상태라서"인지 알 수 없다.
   규칙과 똑같은 조건을 여기서도 보고, 막히는 이유를 구체적으로 알려준다.

   ⚠ 이것은 안내용이다. 실제 차단은 Storage 보안 규칙이 한다.
      여기 검사를 통과해도 규칙이 거부하면 업로드는 실패한다. */

export type UploadDenyReason =
  | "no-profile"
  | "not-manager"
  | "not-active"
  | "branch-not-assigned";

export interface UploadPermission {
  allowed: boolean;
  reason?: UploadDenyReason;
  /** 화면에 그대로 보여줄 설명 */
  message?: string;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "승인 대기",
  suspended: "정지",
  active: "활성",
};

export function checkUploadPermission(params: {
  profile: Pick<UserProfile, "role" | "status" | "branchIds"> | null | undefined;
  branchId: string;
  /** 안내문에 지점명을 쓰기 위한 선택 입력 */
  branchName?: string;
  /** branchId → 지점명 (등록된 담당 지점을 이름으로 보여주기 위함) */
  branchNameOf?: (id: string) => string;
}): UploadPermission {
  const { profile, branchId, branchName, branchNameOf } = params;
  const target = branchName || branchId;

  if (!profile) {
    return {
      allowed: false,
      reason: "no-profile",
      message:
        "계정 정보를 찾을 수 없습니다. 로그아웃 후 다시 로그인해주세요. " +
        "그래도 같으면 본사에 계정 연결을 요청해주세요.",
    };
  }

  if (profile.role !== "branch_manager") {
    return {
      allowed: false,
      reason: "not-manager",
      message:
        profile.role === "admin"
          ? "본사 관리자 계정은 보고서를 조회·다운로드할 수 있지만 업로드는 지점 계정으로 해야 합니다."
          : "지점장 계정이 아니라 업로드할 수 없습니다. 본사에 문의해주세요.",
    };
  }

  if (profile.status !== "active") {
    return {
      allowed: false,
      reason: "not-active",
      message: `계정이 '${STATUS_LABEL[profile.status] ?? profile.status}' 상태라 업로드할 수 없습니다. 본사에 활성화를 요청해주세요.`,
    };
  }

  const assigned = profile.branchIds ?? [];
  if (!assigned.includes(branchId)) {
    const assignedNames = assigned
      .map((id) => (branchNameOf ? branchNameOf(id) : id))
      .filter(Boolean);
    return {
      allowed: false,
      reason: "branch-not-assigned",
      message:
        `이 계정은 '${target}' 담당으로 등록돼 있지 않습니다. ` +
        (assignedNames.length > 0
          ? `등록된 담당 지점: ${assignedNames.join(", ")}. `
          : "등록된 담당 지점이 없습니다. ") +
        "본사에 담당 지점 연결을 요청해주세요.",
    };
  }

  return { allowed: true };
}
