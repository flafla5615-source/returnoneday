/**
 * 테스트용 지점장 계정 생성 스크립트
 *
 * 실행 전 준비:
 *   Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성
 *   다운로드한 JSON을 프로젝트 루트에 serviceAccountKey.json 으로 저장
 *
 * 실행:
 *   node scripts/create-test-manager.mjs
 */

import admin from "firebase-admin";
import { createRequire } from "module";
import { existsSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = join(__dirname, "..");
const keyPath = join(rootDir, "serviceAccountKey.json");

if (!existsSync(keyPath)) {
  console.error("❌ serviceAccountKey.json 파일이 없습니다.");
  console.error("   Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성");
  console.error(`   저장 위치: ${keyPath}`);
  process.exit(1);
}

const require = createRequire(import.meta.url);
const serviceAccount = require(keyPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const auth = admin.auth();
const db = admin.firestore();

const EMAIL = "manager@test.com";
const PASSWORD = "Test1234!";
const NAME = "테스트 지점장";
const BRANCH_NAME = "짐플릭스 시청점";
const BRAND = "짐플릭스";
const REGION = "진주";

async function main() {
  console.log("──────────────────────────────────────────");
  console.log("  RETURN LIFE 테스트 지점장 계정 생성 스크립트");
  console.log("──────────────────────────────────────────\n");

  // ── 1. Firebase Auth 계정 생성 또는 기존 계정 조회 ────────────────────
  let uid;
  try {
    const existing = await auth.getUserByEmail(EMAIL);
    uid = existing.uid;
    console.log(`[Auth] 기존 계정 발견 → UID: ${uid}`);
  } catch {
    const newUser = await auth.createUser({
      email: EMAIL,
      password: PASSWORD,
      displayName: NAME,
    });
    uid = newUser.uid;
    console.log(`[Auth] 새 계정 생성 완료 → UID: ${uid}`);
  }

  // ── 2. 지점 문서 확인 또는 생성 ──────────────────────────────────────
  const branchSnap = await db
    .collection("branches")
    .where("name", "==", BRANCH_NAME)
    .limit(1)
    .get();

  let branchId;
  if (!branchSnap.empty) {
    branchId = branchSnap.docs[0].id;
    console.log(`[Branch] 기존 지점 발견 → ${branchId}`);
    await db.collection("branches").doc(branchId).update({
      managerUids: admin.firestore.FieldValue.arrayUnion(uid),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`[Branch] managerUids에 UID 추가 완료`);
  } else {
    const newBranchRef = db.collection("branches").doc();
    branchId = newBranchRef.id;
    await newBranchRef.set({
      name: BRANCH_NAME,
      brand: BRAND,
      region: REGION,
      active: true,
      managerUids: [uid],
      sortOrder: 1,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`[Branch] 새 지점 생성 완료 → ${branchId}`);
  }

  // ── 3. Firestore users 문서 생성 또는 업데이트 ───────────────────────
  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();

  if (userSnap.exists()) {
    await userRef.update({
      name: NAME,
      role: "branch_manager",
      status: "active",
      branchIds: [branchId],
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`[Firestore] 기존 사용자 문서 업데이트 완료`);
  } else {
    await userRef.set({
      uid,
      name: NAME,
      email: EMAIL,
      role: "branch_manager",
      status: "active",
      branchIds: [branchId],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`[Firestore] 사용자 문서 신규 생성 완료`);
  }

  // ── 4. 결과 출력 ──────────────────────────────────────────────────────
  console.log("\n✅ 계정 생성 완료!");
  console.log("──────────────────────────────────────────");
  console.log(`  이메일    : ${EMAIL}`);
  console.log(`  비밀번호  : ${PASSWORD}`);
  console.log(`  UID       : ${uid}`);
  console.log(`  지점명    : ${BRANCH_NAME}`);
  console.log(`  branchId  : ${branchId}`);
  console.log("──────────────────────────────────────────");
  console.log("\n로그인 테스트: https://returnlife-five.vercel.app/login");
}

main()
  .catch((err) => {
    console.error("\n❌ 오류 발생:", err.message);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
