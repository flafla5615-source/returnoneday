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
