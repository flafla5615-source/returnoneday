/**
 * 최초 관리자 계정 Firestore 문서 생성 스크립트
 *
 * 실행 방법:
 *   1. Firebase Console > 프로젝트 설정 > 서비스 계정 > 새 비공개 키 생성
 *      → serviceAccountKey.json 파일을 프로젝트 루트에 저장
 *   2. npm run create-admin
 *
 * 환경변수로 경로를 지정하는 경우:
 *   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json npm run create-admin
 */

import * as admin from "firebase-admin";

const ADMIN_UID = "IYWQC90Va8UaWDUnrg8ttFQTWLI3";
const ADMIN_EMAIL = "flafla5615@gmail.com";
const ADMIN_NAME = "김예림";

// 서비스 계정 키 경로 — 환경변수 또는 기본값
const CREDENTIALS_PATH =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "./serviceAccountKey.json";

async function createAdmin() {
  // 서비스 계정 파일 존재 확인
  const { existsSync } = await import("fs");
  if (!existsSync(CREDENTIALS_PATH)) {
    console.error(`\n❌ 서비스 계정 키 파일을 찾을 수 없습니다: ${CREDENTIALS_PATH}`);
    console.error("   Firebase Console > 프로젝트 설정 > 서비스 계정에서 다운로드하세요.\n");
    process.exit(1);
  }

  // Firebase Admin 초기화
  admin.initializeApp({
    credential: admin.credential.cert(CREDENTIALS_PATH),
    projectId: "returnoneday",
  });

  const db = admin.firestore();
  const ref = db.collection("users").doc(ADMIN_UID);

  // 기존 문서 확인
  const existing = await ref.get();
  if (existing.exists) {
    console.log("\n⚠️  이미 문서가 존재합니다. 현재 값:");
    console.log(JSON.stringify(existing.data(), null, 2));
    console.log("\n덮어쓰기를 진행합니다...");
  }

  // 문서 생성 (setDoc — merge 없이 전체 덮어쓰기)
  await ref.set({
    uid: ADMIN_UID,
    name: ADMIN_NAME,
    email: ADMIN_EMAIL,
    role: "admin",
    status: "active",
    branchIds: [],
    createdAt: existing.exists
      ? existing.data()!.createdAt          // 기존 createdAt 유지
      : admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`\n✅ 관리자 문서 생성 완료!`);
  console.log(`   경로: users/${ADMIN_UID}`);
  console.log(`   이름: ${ADMIN_NAME}`);
  console.log(`   이메일: ${ADMIN_EMAIL}`);
  console.log(`   역할: admin / 상태: active\n`);

  process.exit(0);
}

createAdmin().catch((e) => {
  console.error("\n❌ 오류:", e.message ?? e);
  process.exit(1);
});
