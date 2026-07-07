import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  type QueryConstraint,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { removeUndefinedDeep } from "@/lib/utils";
import type {
  Member,
  MemberImportJob,
  MemberImportType,
  MemberSatisfactionSurvey,
  UserRole,
} from "@/types";
import type { ParsedMemberRow, ParsedSatisfactionRow } from "@/lib/memberImport";

export function memberDocumentId(branchId: string, phone: string): string {
  return `${branchId}_${phone}`;
}

export async function getMembers(filters?: {
  branchIds?: string[];
  branchId?: string;
}): Promise<Member[]> {
  const branchIds = filters?.branchId
    ? [filters.branchId]
    : filters?.branchIds ?? [];

  if (branchIds.length > 0) {
    const results: Member[] = [];
    for (const branchId of branchIds) {
      const snap = await getDocs(
        query(collection(db, "members"), where("branchId", "==", branchId))
      );
      results.push(...snap.docs.map((d) => d.data() as Member));
    }
    return results.sort((a, b) =>
      a.branchName !== b.branchName
        ? a.branchName.localeCompare(b.branchName, "ko")
        : a.name.localeCompare(b.name, "ko")
    );
  }

  const snap = await getDocs(collection(db, "members"));
  return snap.docs
    .map((d) => d.data() as Member)
    .sort((a, b) =>
      a.branchName !== b.branchName
        ? a.branchName.localeCompare(b.branchName, "ko")
        : a.name.localeCompare(b.name, "ko")
    );
}

export async function getFollowUpSurveys(filters?: {
  branchIds?: string[];
  branchId?: string;
}): Promise<MemberSatisfactionSurvey[]> {
  const branchIds = filters?.branchId
    ? [filters.branchId]
    : filters?.branchIds ?? [];

  async function readWithConstraints(constraints: QueryConstraint[]) {
    const snap = await getDocs(
      query(collection(db, "memberSatisfactionSurveys"), ...constraints)
    );
    return snap.docs.map((d) => d.data() as MemberSatisfactionSurvey);
  }

  if (branchIds.length > 0) {
    const results: MemberSatisfactionSurvey[] = [];
    for (const branchId of branchIds) {
      results.push(
        ...(await readWithConstraints([
          where("branchId", "==", branchId),
          where("needsFollowUp", "==", true),
        ]))
      );
    }
    return results;
  }

  return readWithConstraints([where("needsFollowUp", "==", true)]);
}

export async function getMemberImportJobs(filters?: {
  branchIds?: string[];
  branchId?: string;
}): Promise<MemberImportJob[]> {
  const branchIds = filters?.branchId
    ? [filters.branchId]
    : filters?.branchIds ?? [];

  if (branchIds.length > 0) {
    const results: MemberImportJob[] = [];
    for (const branchId of branchIds) {
      const snap = await getDocs(
        query(collection(db, "memberImportJobs"), where("branchId", "==", branchId))
      );
      results.push(...snap.docs.map((d) => d.data() as MemberImportJob));
    }
    return results.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
  }

  const snap = await getDocs(collection(db, "memberImportJobs"));
  return snap.docs
    .map((d) => d.data() as MemberImportJob)
    .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
}

export async function saveMemberImport(params: {
  importType: MemberImportType;
  fileName: string;
  uploadedByUid: string;
  uploadedByRole: UserRole;
  branchId?: string;
  branchName?: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  memberRows?: ParsedMemberRow[];
  satisfactionRows?: ParsedSatisfactionRow[];
}): Promise<string> {
  if (params.importType === "members") {
    for (const row of params.memberRows ?? []) {
      const id = memberDocumentId(row.branchId, row.phone);
      const ref = doc(db, "members", id);
      const existing = await getDoc(ref);
      await setDoc(
        ref,
        removeUndefinedDeep({
          id,
          ...row,
          source: "bodycodi_excel",
          sourceFileName: params.fileName,
          createdAt: existing.exists() ? existing.data().createdAt : serverTimestamp(),
          updatedAt: serverTimestamp(),
        }),
        { merge: true }
      );
    }
  } else {
    for (const row of params.satisfactionRows ?? []) {
      const memberId = row.branchId && row.phone
        ? memberDocumentId(row.branchId, row.phone)
        : undefined;
      const ref = doc(collection(db, "memberSatisfactionSurveys"));
      await setDoc(
        ref,
        removeUndefinedDeep({
          id: ref.id,
          memberId,
          ...row,
          source: "bodycodi_excel",
          sourceFileName: params.fileName,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    }
  }

  const jobRef = doc(collection(db, "memberImportJobs"));
  await setDoc(
    jobRef,
    removeUndefinedDeep({
      id: jobRef.id,
      importType: params.importType,
      fileName: params.fileName,
      uploadedByUid: params.uploadedByUid,
      uploadedByRole: params.uploadedByRole,
      branchId: params.branchId,
      branchName: params.branchName,
      totalRows: params.totalRows,
      validRows: params.validRows,
      invalidRows: params.invalidRows,
      status: "imported",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  return jobRef.id;
}
