/**
 * 대시보드 테스트 데이터 삭제 스크립트
 * gymflix-cityhall, gymflix-newjinju 지점과 관련 보고서만 삭제
 * 관리자 계정과 운영 데이터는 건드리지 않음
 *
 * 실행:
 *   npm run cleanup:dashboard-test
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const TEST_BRANCH_IDS = ["gymflix-cityhall", "gymflix-newjinju"];
const PROJECT_ID = "returnoneday";

const { FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY } =
  process.env;

const missing = [];
if (!FIREBASE_ADMIN_PROJECT_ID) missing.push("FIREBASE_ADMIN_PROJECT_ID");
if (!FIREBASE_ADMIN_CLIENT_EMAIL) missing.push("FIREBASE_ADMIN_CLIENT_EMAIL");
if (!FIREBASE_ADMIN_PRIVATE_KEY) missing.push("FIREBASE_ADMIN_PRIVATE_KEY");

if (missing.length > 0) {
  console.error("\n누락된 환경변수:", missing.join(", "));
  process.exit(1);
}

initializeApp({
  credential: cert({
    projectId: FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
  projectId: PROJECT_ID,
});

const db = getFirestore();

async function main() {
  console.log("=".repeat(50));
  console.log("RETURN LIFE — 테스트 데이터 정리");
  console.log("대상:", TEST_BRANCH_IDS.join(", "));
  console.log("=".repeat(50));

  // 1. dailyReports: 테스트 지점 보고서만 삭제
  console.log("\n[1/3] dailyReports 삭제 중...");
  let reportCount = 0;
  for (const branchId of TEST_BRANCH_IDS) {
    const snap = await db.collection("dailyReports").where("branchId", "==", branchId).get();
    for (const doc of snap.docs) {
      await doc.ref.delete();
      reportCount++;
    }
    console.log(`  ${branchId}: ${snap.size}개 삭제`);
  }

  // 2. issues: 테스트 지점 이슈만 삭제
  console.log("\n[2/3] issues 삭제 중...");
  let issueCount = 0;
  for (const branchId of TEST_BRANCH_IDS) {
    const snap = await db.collection("issues").where("branchId", "==", branchId).get();
    for (const doc of snap.docs) {
      await doc.ref.delete();
      issueCount++;
    }
    console.log(`  ${branchId}: ${snap.size}개 삭제`);
  }

  // 3. branches: 테스트 지점만 삭제
  console.log("\n[3/3] branches 삭제 중...");
  let branchCount = 0;
  for (const branchId of TEST_BRANCH_IDS) {
    const ref = db.collection("branches").doc(branchId);
    const snap = await ref.get();
    if (snap.exists) {
      await ref.delete();
      console.log(`  삭제: ${branchId}`);
      branchCount++;
    } else {
      console.log(`  건너뜀 (없음): ${branchId}`);
    }
  }

  console.log("\n" + "=".repeat(50));
  console.log("정리 완료");
  console.log(`  삭제된 지점: ${branchCount}개`);
  console.log(`  삭제된 보고서: ${reportCount}개`);
  console.log(`  삭제된 이슈: ${issueCount}개`);
  console.log("\n주의: 관리자 계정, 운영 지점, 실제 보고서는 변경되지 않았습니다.");
  console.log("=".repeat(50) + "\n");
}

main().catch((err) => {
  console.error("\n정리 실패:", err.message ?? err);
  process.exit(1);
});
