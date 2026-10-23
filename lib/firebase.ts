import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

// Each var must be accessed with a static key so Turbopack/webpack can inline the value at build time.
// Dynamic process.env[variable] lookup is never replaced and returns undefined in the browser.
const missing: string[] = [];
if (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY) missing.push("NEXT_PUBLIC_FIREBASE_API_KEY");
if (!process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN) missing.push("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN");
if (!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) missing.push("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
if (!process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET) missing.push("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET");
if (!process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID) missing.push("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID");
if (!process.env.NEXT_PUBLIC_FIREBASE_APP_ID) missing.push("NEXT_PUBLIC_FIREBASE_APP_ID");

if (missing.length > 0) {
  throw new Error(
    `[Firebase] Missing environment variables:\n${missing.map((k) => `  - ${k}`).join("\n")}\n` +
      "Create .env.local from .env.example, or check the Vercel environment variables."
  );
}

if (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== "returnoneday") {
  throw new Error(
    `[Firebase] NEXT_PUBLIC_FIREBASE_PROJECT_ID must be "returnoneday", ` +
      `received "${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}".`
  );
}

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

// Reuse the existing app during hot reloads.
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, "asia-northeast3");
export const storage = getStorage(app);

// 기본 재시도 시간이 길어(작업 2분) 버킷 설정이 잘못된 경우에도
// 화면이 오래 "0%" 에 멈춰 있고 오류가 뜨지 않는다.
// 설정 문제는 재시도해도 풀리지 않으므로 빨리 실패시켜 원인을 보여준다.
// (업로드 자체는 느린 회선을 감안해 조금 더 여유를 준다)
storage.maxOperationRetryTime = 30_000; // 30초
storage.maxUploadRetryTime = 120_000; // 2분

export default app;
