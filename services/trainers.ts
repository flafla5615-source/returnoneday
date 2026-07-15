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

// 전사 공용 — branchId 필터 없이 전체 트레이너를 조회한다.
export async function getAllTrainers(): Promise<Trainer[]> {
  const snap = await getDocs(
    query(collection(db, "trainers"), orderBy("createdAt", "asc"))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Trainer));
}

export type CreateTrainerInput = {
  name: string;
  phoneLast4?: string;
  identifierMemo?: string;
  firstRegisteredBranchId?: string;
  active: boolean;
  createdBy: string;
};

export async function createTrainer(input: CreateTrainerInput): Promise<string> {
  const now = Timestamp.now();
  const name = input.name.trim();
  const phoneLast4 = input.phoneLast4?.trim();
  const identifierMemo = input.identifierMemo?.trim();

  const data: Record<string, unknown> = {
    name,
    active: input.active,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
  if (phoneLast4) data.phoneLast4 = phoneLast4;
  if (identifierMemo) data.identifierMemo = identifierMemo;
  if (input.firstRegisteredBranchId) data.firstRegisteredBranchId = input.firstRegisteredBranchId;

  const ref = await addDoc(collection(db, "trainers"), data);
  return ref.id;
}

// admin 전용 (Firestore Rules에서 서버 기준으로 검증) — 이름 / 전화번호 뒤 4자리 /
// 식별 메모 / 활성 여부만 수정 가능. 소속 지점 개념이 없으므로 branchIds는 다루지 않는다.
export type UpdateTrainerInput = Partial<
  Pick<Trainer, "name" | "phoneLast4" | "identifierMemo" | "active">
>;

export async function updateTrainer(id: string, data: UpdateTrainerInput): Promise<void> {
  const payload: Record<string, unknown> = { updatedAt: Timestamp.now() };
  if (data.name !== undefined) payload.name = data.name.trim();
  if (data.phoneLast4 !== undefined) payload.phoneLast4 = data.phoneLast4.trim();
  if (data.identifierMemo !== undefined) payload.identifierMemo = data.identifierMemo.trim();
  if (data.active !== undefined) payload.active = data.active;

  await updateDoc(doc(db, "trainers", id), payload);
}
