import {
  collection,
  doc,
  setDoc,
  getDocs,
  deleteDoc,
  updateDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  type QueryConstraint,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Issue, IssueStatus } from "@/types";

/**
 * 보고서의 이슈를 전체 교체 저장.
 * - 기존 이슈 삭제 후 새로 저장 (soft-delete 없이 실제 삭제)
 * - top-level issues 컬렉션에도 동일 ID로 저장 (관리자 쿼리용)
 */
export async function upsertIssues(
  reportId: string,
  branchId: string,
  reportDate: string,
  issues: Omit<Issue, "id" | "reportId" | "branchId" | "reportDate" | "createdAt" | "updatedAt">[]
): Promise<void> {
  // 기존 이슈 삭제
  const existingSnap = await getDocs(
    collection(db, "dailyReports", reportId, "issues")
  );
  await Promise.all(
    existingSnap.docs.map((d) => {
      // top-level issues에서도 삭제
      deleteDoc(doc(db, "issues", d.id));
      return deleteDoc(d.ref);
    })
  );

  // 새 이슈 저장
  for (const issue of issues) {
    const ref = doc(collection(db, "dailyReports", reportId, "issues"));
    const issueDoc: Omit<Issue, "createdAt" | "updatedAt"> & {
      createdAt: ReturnType<typeof serverTimestamp>;
      updatedAt: ReturnType<typeof serverTimestamp>;
    } = {
      id: ref.id,
      reportId,
      branchId,
      reportDate,
      ...issue,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, issueDoc);
    // top-level issues 컬렉션에도 동일 ID로 저장
    await setDoc(doc(db, "issues", ref.id), issueDoc);
  }
}

export async function getIssuesByReport(reportId: string): Promise<Issue[]> {
  const snap = await getDocs(
    collection(db, "dailyReports", reportId, "issues")
  );
  return snap.docs.map((d) => d.data() as Issue);
}

/**
 * 관리자용: 전체 이슈 조회 (top-level issues 컬렉션 사용)
 * 지점장용: branchId 필터 필수
 */
export async function getAllIssues(filters?: {
  branchId?: string;
  status?: IssueStatus;
  fromDate?: string;
  toDate?: string;
}): Promise<Issue[]> {
  // branchId + createdAt 복합 인덱스 사용
  const constraints: QueryConstraint[] = [orderBy("createdAt", "desc")];

  if (filters?.branchId) {
    constraints.unshift(where("branchId", "==", filters.branchId));
  }
  if (filters?.status) {
    constraints.push(where("status", "==", filters.status));
  }

  const snap = await getDocs(query(collection(db, "issues"), ...constraints));
  let issues = snap.docs.map((d) => d.data() as Issue);

  if (filters?.fromDate) {
    issues = issues.filter((i) => i.reportDate >= filters.fromDate!);
  }
  if (filters?.toDate) {
    issues = issues.filter((i) => i.reportDate <= filters.toDate!);
  }

  return issues;
}

export async function updateIssueStatus(
  issueId: string,
  status: IssueStatus
): Promise<void> {
  const update: Record<string, unknown> = {
    status,
    updatedAt: serverTimestamp(),
  };
  if (status === "resolved") {
    update.resolvedAt = serverTimestamp();
  }
  // top-level issues 업데이트
  await updateDoc(doc(db, "issues", issueId), update);
}
