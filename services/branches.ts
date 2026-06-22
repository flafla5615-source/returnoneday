import {
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  orderBy,
  Timestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Branch } from "@/types";

export async function getAllBranches(): Promise<Branch[]> {
  const snap = await getDocs(
    query(collection(db, "branches"), orderBy("sortOrder", "asc"))
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as Branch)
    .filter((branch) => branch.active);
}

export async function getAllBranchesIncludingInactive(): Promise<Branch[]> {
  const snap = await getDocs(
    query(collection(db, "branches"), orderBy("sortOrder", "asc"))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Branch);
}

export async function getBranchById(id: string): Promise<Branch | null> {
  const snap = await getDoc(doc(db, "branches", id));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Branch) : null;
}

export async function getBranchesByIds(ids: string[]): Promise<Branch[]> {
  if (ids.length === 0) return [];
  const results: Branch[] = [];
  for (const id of ids) {
    const b = await getBranchById(id);
    if (b) results.push(b);
  }
  return results;
}

export async function createBranch(
  data: Omit<Branch, "id" | "createdAt" | "updatedAt">
): Promise<string> {
  const ref = doc(collection(db, "branches"));
  await setDoc(ref, {
    ...data,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  return ref.id;
}

export async function updateBranch(id: string, data: Partial<Branch>): Promise<void> {
  await updateDoc(doc(db, "branches", id), {
    ...data,
    updatedAt: Timestamp.now(),
  });
}
