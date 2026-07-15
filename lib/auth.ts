import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
  type User,
} from "firebase/auth";
import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
} from "firebase/firestore";
import { auth, db } from "./firebase";
import type { UserProfile } from "@/types";

/**
 * 회원가입: Firebase Auth 계정 생성 + Firestore users 문서 생성.
 * - role은 항상 branch_manager로 고정 (클라이언트에서 admin 생성 불가)
 * - status는 항상 pending (관리자 승인 후 active)
 */
export async function signUp(
  email: string,
  password: string,
  name: string
): Promise<User> {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const now = serverTimestamp();
  const profile = {
    uid: cred.user.uid,
    name,
    email,
    role: "branch_manager" as const,
    status: "pending" as const,
    branchIds: [],
    createdAt: now,
    updatedAt: now,
  };
  await setDoc(doc(db, "users", cred.user.uid), profile);
  return cred.user;
}

export async function signIn(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function logOut(): Promise<void> {
  await signOut(auth);
}

// 지점 운영계정 비밀번호는 본사 admin이 관리한다 — branch_manager 자기 비밀번호 변경 기능은 제공하지 않는다.
export async function resetPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email);
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;
  return snap.data() as UserProfile;
}

export { onAuthStateChanged, auth };
