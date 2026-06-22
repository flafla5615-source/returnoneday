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
  await updateDoc(doc(db, "users", uid), {
    name,
    role,
    status: "active" as UserStatus,
    branchIds,
    updatedAt: Timestamp.now(),
  });
}

export async function getPendingUsers(): Promise<UserProfile[]> {
  const snap = await getDocs(
    query(collection(db, "users"), where("status", "==", "pending"), orderBy("createdAt", "desc"))
  );
  return snap.docs.map((d) => d.data() as UserProfile);
}
