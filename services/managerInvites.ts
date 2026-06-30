import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ManagerInvite } from "@/types";

export async function getAllManagerInvites(): Promise<Record<string, ManagerInvite>> {
  const snap = await getDocs(collection(db, "managerInvites"));
  const result: Record<string, ManagerInvite> = {};
  snap.docs.forEach((d) => {
    result[d.id] = d.data() as ManagerInvite;
  });
  return result;
}

export async function upsertManagerInvite(
  key: string,
  data: Omit<ManagerInvite, "createdAt" | "updatedAt">
): Promise<void> {
  const ref = doc(db, "managerInvites", key);
  const existing = await getDoc(ref);
  const now = Timestamp.now();
  await setDoc(ref, {
    ...data,
    createdAt: existing.exists() ? existing.data().createdAt : now,
    updatedAt: now,
  });
}
