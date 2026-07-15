import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export type BranchAccountCreationMethod = "temporary_password" | "reset_email";

export type BranchAccountRequest = {
  branchId: string;
  branchName: string;
  email: string;
};

export type BranchAccountResult = {
  branchId: string;
  branchName: string;
  email: string;
  status: "created" | "linked_existing" | "failed";
  uid?: string;
  userDocumentLinked: boolean;
  branchManagerUidsLinked: boolean;
  initialPasswordSet: boolean;
  resetEmailSent?: boolean;
  message?: string;
};

export async function createBranchAccounts(params: {
  method: BranchAccountCreationMethod;
  password?: string;
  accounts: BranchAccountRequest[];
}): Promise<BranchAccountResult[]> {
  const callable = httpsCallable<
    {
      method: BranchAccountCreationMethod;
      password?: string;
      accounts: BranchAccountRequest[];
    },
    { results: BranchAccountResult[] }
  >(functions, "createBranchAccounts");

  const response = await callable(params);
  return response.data.results;
}

// ── 지점 운영계정 비밀번호 관리 (admin 전용) ─────────────────────────────────
// 비밀번호는 Firestore/CSV/로그/화면 결과 어디에도 저장·노출하지 않는다.
// 이 함수는 값을 서버로 전달만 하고, 응답에는 비밀번호를 포함하지 않는다.

export type SetBranchAccountPasswordParams = {
  targetUid?: string;
  email?: string;
  newPassword: string;
};

export type SetBranchAccountPasswordResult = {
  success: true;
  uid: string;
};

export async function setBranchAccountPassword(
  params: SetBranchAccountPasswordParams
): Promise<SetBranchAccountPasswordResult> {
  const callable = httpsCallable<
    SetBranchAccountPasswordParams,
    SetBranchAccountPasswordResult
  >(functions, "setBranchAccountPassword");

  const response = await callable(params);
  return response.data;
}
