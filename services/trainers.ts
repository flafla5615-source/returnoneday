import {
  collection,
  doc,
  addDoc,
  getDocs,
  updateDoc,
  Timestamp,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Trainer } from "@/types";

export async function getAllTrainers(): Promise<Trainer[]> {
  const snap = await getDocs(
    query(collection(db, "trainers"), orderBy("createdAt", "asc"))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Trainer));
}

export async function createTrainer(
  data: Pick<Trainer, "name" | "branchIds" | "active">
): Promise<string> {
  const now = Timestamp.now();
  const ref = await addDoc(collection(db, "trainers"), {
    ...data,
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}

export async function updateTrainer(
  id: string,
  data: Partial<Pick<Trainer, "name" | "branchIds" | "active">>
): Promise<void> {
  await updateDoc(doc(db, "trainers", id), {
    ...data,
    updatedAt: Timestamp.now(),
  });
}
