/**
 * 최초 관리자 계정 Firestore 문서 생성/업데이트 스크립트
 *
 * 실행 방법:
 *   npm run create-admin
 *
 * 사전 준비 (.env.local에 아래 항목 추가):
 *   FIREBASE_ADMIN_PROJECT_ID=returnoneday
 *   FIREBASE_ADMIN_CLIENT_EMAIL=firebase-adminsdk-xxxx@returnoneday.iam.gserviceaccount.com
 *   FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
 *
 * 서비스 계정 키 발급:
 *   Firebase Console > 프로젝트 설정 > 서비스 계정 > 새 비공개 키 생성
 *
 * 동작:
 *   1. Firebase Auth에서 이메일로 UID 조회 (UID를 코드에 하드코딩하지 않음)
 *   2. users 컬렉션에서 같은 이메일의 중복 문서 경고
 *   3. 기존 문서 있으면 현재 값 출력 후 merge 업데이트
 *   4. 없으면 신규 생성
 *   5. 결과 (UID, 이메일, role, status) 출력
 *
 * 요구 Node.js: 20.6 이상 (--env-file 플래그 사용)
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const TARGET_EMAIL = "flafla5615@gmail.com";
const TARGET_NAME = "김예림";
const PROJECT_ID = "returnoneday";

// ── 환경변수 검증 ────────────────────────────────────────────────────────────
const { FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY } =
  process.env;

const missing = [];
if (!FIREBASE_ADMIN_PROJECT_ID) missing.push("FIREBASE_ADMIN_PROJECT_ID");
if (!FIREBASE_ADMIN_CLIENT_EMAIL) missing.push("FIREBASE_ADMIN_CLIENT_EMAIL");
if (!FIREBASE_ADMIN_PRIVATE_KEY) missing.push("FIREBASE_ADMIN_PRIVATE_KEY");

if (missing.length > 0) {
  console.error("\n❌ 누락된 환경변수:");
  missing.forEach((k) => console.error(`   - ${k}`));
  console.error("\n.env.local 파일에 아래 항목을 추가해주세요:");
  console.error("  FIREBASE_ADMIN_PROJECT_ID=returnoneday");
  console.error("  FIREBASE_ADMIN_CLIENT_EMAIL=<서비스 계정 이메일>");
  console.error('  FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"');
  console.error("\n서비스 계정 키: Firebase Console > 프로젝트 설정 > 서비스 계정 > 새 비공개 키 생성\n");
  process.exit(1);
}

// ── Firebase Admin 초기화 ────────────────────────────────────────────────────
initializeApp({
  credential: cert({
    projectId: FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: FIREBASE_ADMIN_CLIENT_EMAIL,
    // 환경변수의 리터럴 \n을 실제 줄바꿈으로 변환
    privateKey: FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
  projectId: PROJECT_ID,
});

const adminAuth = getAuth();
const db = getFirestore();

async function main() {
  console.log(`\n🔍 Firebase Auth에서 ${TARGET_EMAIL} 조회 중...`);

  // ── 1. 이메일로 UID 조회 ──────────────────────────────────────────────────
  let userRecord;
  try {
    userRecord = await adminAuth.getUserByEmail(TARGET_EMAIL);
  } catch {
    console.error(`\n❌ Firebase Auth에서 사용자를 찾을 수 없습니다: ${TARGET_EMAIL}`);
    console.error("   Firebase Console > Authentication에서 먼저 계정을 생성해주세요.\n");
    process.exit(1);
  }

  const uid = userRecord.uid;
  console.log(`✓ UID 확인: ${uid}`);
  console.log(`✓ 이메일:   ${userRecord.email}`);

  // ── 2. 같은 이메일의 중복 문서 경고 ─────────────────────────────────────
  const usersCol = db.collection("users");
  const dupSnap = await usersCol.where("email", "==", TARGET_EMAIL).get();
  const dupDocs = dupSnap.docs.filter((d) => d.id !== uid);

  if (dupDocs.length > 0) {
    console.warn(`\n⚠️  같은 이메일(${TARGET_EMAIL})을 가진 다른 users 문서가 있습니다:`);
    for (const d of dupDocs) {
      const data = d.data();
      console.warn(`   users/${d.id}  role=${data.role}  status=${data.status}`);
    }
    console.warn("   → 이 문서들은 수동으로 삭제하거나 비활성화하세요.\n");
  }

  // ── 3. 기존 문서 확인 ────────────────────────────────────────────────────
  const docRef = usersCol.doc(uid);
  const existing = await docRef.get();

  if (existing.exists) {
    console.log("\n⚠️  이미 문서가 존재합니다. 현재 값:");
    const d = existing.data();
    console.log(
      JSON.stringify(
        { role: d.role, status: d.status, name: d.name, email: d.email, branchIds: d.branchIds },
        null,
        2
      )
    );
    console.log("\nmerge 방식으로 업데이트합니다...");
  }

  // ── 4. 문서 생성 또는 업데이트 ───────────────────────────────────────────
  const payload = {
    uid,
    name: TARGET_NAME,
    email: TARGET_EMAIL,
    role: "admin",
    status: "active",
    branchIds: [],          // 반드시 진짜 빈 배열
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (!existing.exists) {
    // 신규 생성: createdAt 포함
    await docRef.set({ ...payload, createdAt: FieldValue.serverTimestamp() });
  } else {
    // 기존 문서 업데이트: createdAt 보존
    await docRef.set(payload, { merge: true });
  }

  // ── 5. 결과 출력 ─────────────────────────────────────────────────────────
  console.log("\n✅ 관리자 문서 생성/업데이트 완료!");
  console.log(`   경로:   users/${uid}`);
  console.log(`   UID:    ${uid}`);
  console.log(`   이메일: ${TARGET_EMAIL}`);
  console.log(`   이름:   ${TARGET_NAME}`);
  console.log(`   role:   admin`);
  console.log(`   status: active`);
  console.log(`   branchIds: []\n`);
  console.log("이제 앱에서 로그인하면 /admin 대시보드로 이동합니다.\n");
}

main().catch((e) => {
  console.error("\n❌ 오류:", e.message ?? e);
  process.exit(1);
});
