import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  where,
  Timestamp,
  orderBy,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { UserProfile, UserRole, UserStatus } from "@/types";
import { planLinkAccount } from "@/lib/linkAccountPlan";

export async function getAllUsers(): Promise<UserProfile[]> {
  const snap = await getDocs(query(collection(db, "users"), orderBy("createdAt", "desc")));
  return snap.docs.map((d) => d.data() as UserProfile);
}

export async function getUserById(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? (snap.data() as UserProfile) : null;
}

export async function updateUserProfile(
  uid: string,
  updates: Partial<Pick<UserProfile, "name" | "role" | "status" | "branchIds">>
): Promise<void> {
  await updateDoc(doc(db, "users", uid), {
    ...updates,
    updatedAt: Timestamp.now(),
  });
}

export async function approveUser(
  uid: string,
  name: string,
  role: UserRole,
  branchIds: string[]
): Promise<void> {
  await updateUserProfileWithBranchAssignments(uid, {
    name,
    role,
    status: "active" as UserStatus,
    branchIds,
  });
}

export async function updateUserProfileWithBranchAssignments(
  uid: string,
  updates: Pick<UserProfile, "name" | "role" | "status" | "branchIds">
): Promise<void> {
  const targetBranchIds = new Set(updates.branchIds);
  const branchesSnap = await getDocs(collection(db, "branches"));
  const now = Timestamp.now();
  const batch = writeBatch(db);

  batch.update(doc(db, "users", uid), {
    ...updates,
    updatedAt: now,
  });

  branchesSnap.docs.forEach((branchDoc) => {
    const data = branchDoc.data();
    const managerUids = Array.isArray(data.managerUids)
      ? (data.managerUids as string[])
      : [];
    const shouldHaveUser = targetBranchIds.has(branchDoc.id);
    const hasUser = managerUids.includes(uid);

    if (shouldHaveUser === hasUser) return;

    const nextManagerUids = shouldHaveUser
      ? [...managerUids, uid]
      : managerUids.filter((managerUid) => managerUid !== uid);

    batch.update(doc(db, "branches", branchDoc.id), {
      managerUids: nextManagerUids,
      updatedAt: now,
    });
  });

  await batch.commit();
}

export async function getPendingUsers(): Promise<UserProfile[]> {
  const snap = await getDocs(
    query(collection(db, "users"), where("status", "==", "pending"), orderBy("createdAt", "desc"))
  );
  return snap.docs.map((d) => d.data() as UserProfile);
}


/* ── 기존 Firebase Auth 계정 연결 ──────────────────────────────────────────────
   Auth 콘솔에서 만든 계정은 users 문서가 없어 관리자 목록에 나타나지 않는다.
   이 함수는 그 계정의 UID 로 프로필을 만들거나(이미 있으면 갱신하고)
   담당 지점 하나에 연결한다. Cloud Functions 를 쓰지 않는다.

   안전장치
   - 기존 문서가 admin 이면 거부한다 (관리자 계정 보호)
   - 지점의 managerUids 는 arrayUnion 으로 더하므로 기존 담당자가 유지된다
   - users 문서와 지점 문서를 하나의 writeBatch 로 묶어 중간 상태가 남지 않는다
   - 같은 UID 로 다시 실행해도 결과가 같다 (중복 생성 없음) */

export type LinkExistingAuthAccountResult = {
  /** users 문서를 새로 만들었는지 (false 면 기존 문서를 갱신) */
  createdProfile: boolean;
  /** 지점 담당자 목록에 새로 추가됐는지 (false 면 이미 있었음) */
  addedToBranch: boolean;
  /** 담당에서 해제된 이전 지점 (지점을 옮겨 연결한 경우) */
  removedFromBranchIds: string[];
};

export async function linkExistingAuthAccount(params: {
  uid: string;
  email: string;
  name: string;
  branchId: string;
}): Promise<LinkExistingAuthAccountResult> {
  const uid = params.uid.trim();
  const email = params.email.trim().toLowerCase();
  const name = params.name.trim();
  const branchId = params.branchId.trim();

  if (!uid) throw new Error("uid-required");
  if (!name) throw new Error("name-required");
  if (!branchId) throw new Error("branch-required");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("email-invalid");

  const branchRef = doc(db, "branches", branchId);
  const userRef = doc(db, "users", uid);
  const [branchSnap, userSnap] = await Promise.all([getDoc(branchRef), getDoc(userRef)]);

  if (!branchSnap.exists()) throw new Error("branch-not-found");

  const existing = userSnap.exists() ? (userSnap.data() as UserProfile) : null;

  // 관리자 계정은 이 경로로 덮어쓰지 않는다
  if (existing?.role === "admin") throw new Error("target-is-admin");

  const plan = planLinkAccount({ branchId, previousBranchIds: existing?.branchIds });

  const now = Timestamp.now();
  const batch = writeBatch(db);

  if (existing) {
    batch.update(userRef, {
      name,
      email,
      role: "branch_manager",
      status: "active",
      active: true,
      branchIds: plan.nextBranchIds,
      updatedAt: now,
    });
  } else {
    batch.set(userRef, {
      uid,
      name,
      email,
      role: "branch_manager",
      status: "active",
      active: true,
      branchIds: plan.nextBranchIds,
      createdAt: now,
      updatedAt: now,
    });
  }

  // 기존 담당자를 보존하면서 이 UID 만 추가한다
  const managerUids = Array.isArray(branchSnap.data()?.managerUids)
    ? (branchSnap.data()!.managerUids as string[])
    : [];
  const addedToBranch = !managerUids.includes(uid);
  if (addedToBranch) {
    batch.update(branchRef, { managerUids: arrayUnion(uid), updatedAt: now });
  }

  for (const staleBranchId of plan.branchesToRemove) {
    batch.update(doc(db, "branches", staleBranchId), {
      managerUids: arrayRemove(uid),
      updatedAt: now,
    });
  }

  await batch.commit();

  return {
    createdProfile: !existing,
    addedToBranch,
    removedFromBranchIds: plan.branchesToRemove,
  };
}
