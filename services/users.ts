import {
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
