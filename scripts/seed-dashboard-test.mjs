/**
 * 대시보드 테스트용 Seed 스크립트
 * 지점 2개 + 최근 7일 × 2개 보고서 생성
 *
 * 실행 방법:
 *   npm run seed:dashboard-test
 *
 * 사전 준비 (.env.local에 아래 항목 추가):
 *   FIREBASE_ADMIN_PROJECT_ID=returnoneday
 *   FIREBASE_ADMIN_CLIENT_EMAIL=firebase-adminsdk-xxxx@returnoneday.iam.gserviceaccount.com
 *   FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
 *
 * 서비스 계정 키: Firebase Console > 프로젝트 설정 > 서비스 계정 > 새 비공개 키 생성
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

// ── 상수 ────────────────────────────────────────────────────────────────────

const MANAGER_UID = process.env.TEST_MANAGER_UID;
const PROJECT_ID = "returnoneday";

const BRANCHES = [
  {
    id: "gymflix-cityhall",
    name: "짐플릭스 시청점",
    brand: "짐플릭스",
    region: "진주",
    sortOrder: 1,
  },
  {
    id: "gymflix-newjinju",
    name: "짐플릭스 신진주역점",
    brand: "짐플릭스",
    region: "진주",
    sortOrder: 2,
  },
];

const CITYHALL_DATA = [
  { date: "2026-06-22", activeMembers: 495, inquiries: 8,  ptConsultations: 3, ptRegistrations: 1, reRegistrations: 1, comebackMembers: 0 },
  { date: "2026-06-23", activeMembers: 498, inquiries: 10, ptConsultations: 4, ptRegistrations: 2, reRegistrations: 2, comebackMembers: 1 },
  { date: "2026-06-24", activeMembers: 502, inquiries: 12, ptConsultations: 5, ptRegistrations: 2, reRegistrations: 1, comebackMembers: 0 },
  { date: "2026-06-25", activeMembers: 500, inquiries: 7,  ptConsultations: 2, ptRegistrations: 1, reRegistrations: 0, comebackMembers: 1 },
  { date: "2026-06-26", activeMembers: 503, inquiries: 15, ptConsultations: 6, ptRegistrations: 3, reRegistrations: 2, comebackMembers: 0 },
  { date: "2026-06-27", activeMembers: 500, inquiries: 9,  ptConsultations: 4, ptRegistrations: 1, reRegistrations: 1, comebackMembers: 0 },
  { date: "2026-06-28", activeMembers: 501, inquiries: 12, ptConsultations: 5, ptRegistrations: 2, reRegistrations: 1, comebackMembers: 0 },
];

const NEWJINJU_DATA = [
  { date: "2026-06-22", activeMembers: 301, inquiries: 4, ptConsultations: 2, ptRegistrations: 1, reRegistrations: 0, comebackMembers: 0 },
  { date: "2026-06-23", activeMembers: 303, inquiries: 5, ptConsultations: 2, ptRegistrations: 1, reRegistrations: 1, comebackMembers: 0 },
  { date: "2026-06-24", activeMembers: 305, inquiries: 7, ptConsultations: 3, ptRegistrations: 1, reRegistrations: 1, comebackMembers: 1 },
  { date: "2026-06-25", activeMembers: 304, inquiries: 3, ptConsultations: 1, ptRegistrations: 0, reRegistrations: 0, comebackMembers: 0 },
  { date: "2026-06-26", activeMembers: 307, inquiries: 8, ptConsultations: 4, ptRegistrations: 2, reRegistrations: 2, comebackMembers: 0 },
  { date: "2026-06-27", activeMembers: 309, inquiries: 6, ptConsultations: 3, ptRegistrations: 1, reRegistrations: 1, comebackMembers: 0 },
  { date: "2026-06-28", activeMembers: 312, inquiries: 9, ptConsultations: 4, ptRegistrations: 2, reRegistrations: 1, comebackMembers: 1 },
];

const ALL_DATA = [
  { branchId: "gymflix-cityhall", rows: CITYHALL_DATA },
  { branchId: "gymflix-newjinju", rows: NEWJINJU_DATA },
];

// ── 환경변수 검증 ────────────────────────────────────────────────────────────

const { FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY } =
  process.env;

const missing = [];
if (!FIREBASE_ADMIN_PROJECT_ID) missing.push("FIREBASE_ADMIN_PROJECT_ID");
if (!FIREBASE_ADMIN_CLIENT_EMAIL) missing.push("FIREBASE_ADMIN_CLIENT_EMAIL");
if (!FIREBASE_ADMIN_PRIVATE_KEY) missing.push("FIREBASE_ADMIN_PRIVATE_KEY");
if (!MANAGER_UID) missing.push("TEST_MANAGER_UID");

if (missing.length > 0) {
  console.error("\n누락된 환경변수:");
  missing.forEach((k) => console.error(`  - ${k}`));
  console.error("\n.env.local에 아래 항목을 추가하세요:");
  console.error("  FIREBASE_ADMIN_PROJECT_ID=returnoneday");
  console.error("  FIREBASE_ADMIN_CLIENT_EMAIL=<서비스 계정 이메일>");
  console.error('  FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"');
  console.error("  TEST_MANAGER_UID=<테스트 지점장 Firebase Auth UID>");
  console.error("\n서비스 계정 키: Firebase Console > 프로젝트 설정 > 서비스 계정 > 새 비공개 키 생성\n");
  process.exit(1);
}

// ── Firebase Admin 초기화 ────────────────────────────────────────────────────

initializeApp({
  credential: cert({
    projectId: FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
  projectId: PROJECT_ID,
});

const db = getFirestore();

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

function kstTimestamp(dateStr) {
  return Timestamp.fromDate(new Date(`${dateStr}T09:00:00+09:00`));
}

async function deleteCollection(collectionName) {
  const snap = await db.collection(collectionName).get();
  if (snap.empty) {
    console.log(`  ${collectionName}: 삭제할 문서 없음`);
    return 0;
  }
  for (const doc of snap.docs) {
    await doc.ref.delete();
  }
  console.log(`  ${collectionName}: ${snap.size}개 삭제`);
  return snap.size;
}

// ── 메인 ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(50));
  console.log("RETURN LIFE — 대시보드 테스트 Seed");
  console.log("=".repeat(50));

  // ── 1. 기존 데이터 삭제 ──────────────────────────────────────────────────
  console.log("\n[1/4] 기존 데이터 삭제 중...");
  await deleteCollection("branches");
  await deleteCollection("dailyReports");
  await deleteCollection("issues");

  // ── 2. 지점 생성 ─────────────────────────────────────────────────────────
  console.log("\n[2/4] 지점 생성 중...");
  for (const branch of BRANCHES) {
    await db.collection("branches").doc(branch.id).set({
      id: branch.id,
      name: branch.name,
      brand: branch.brand,
      region: branch.region,
      active: true,
      managerUids: [MANAGER_UID],
      sortOrder: branch.sortOrder,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log(`  생성: ${branch.id} (${branch.name})`);
  }

  // ── 3. 지점장 branchIds 업데이트 ─────────────────────────────────────────
  console.log("\n[3/4] 지점장 branchIds 업데이트 중...");
  await db.collection("users").doc(MANAGER_UID).update({
    branchIds: BRANCHES.map((b) => b.id),
    updatedAt: FieldValue.serverTimestamp(),
  });
  console.log(`  UID ${MANAGER_UID} -> branchIds: [${BRANCHES.map((b) => b.id).join(", ")}]`);

  // ── 4. 보고서 생성 ───────────────────────────────────────────────────────
  console.log("\n[4/4] 보고서 생성 중...");
  let totalReports = 0;

  for (const { branchId, rows } of ALL_DATA) {
    console.log(`\n  ${branchId}:`);
    for (const row of rows) {
      const reportId = `${branchId}_${row.date}`;
      const ts = kstTimestamp(row.date);

      await db.collection("dailyReports").doc(reportId).set({
        id: reportId,
        branchId,
        reportDate: row.date,
        writerUid: MANAGER_UID,
        status: "submitted",
        activeMembers: row.activeMembers,
        inquiries: row.inquiries,
        ptConsultations: row.ptConsultations,
        ptRegistrations: row.ptRegistrations,
        reRegistrations: row.reRegistrations,
        comebackMembers: row.comebackMembers,
        happyCalls: null,
        newHappyCalls: null,
        existingHappyCalls: null,
        expiringTmCount: null,
        expiringTmMethods: [],
        unregisteredTmCount: null,
        unregisteredTmMethods: [],
        offlinePromotionCount: null,
        offlinePromotionMethods: [],
        isTestData: true,
        source: "dashboard-seed",
        createdAt: ts,
        updatedAt: ts,
        submittedAt: ts,
      });

      console.log(`    ${reportId} | 유효회원 ${row.activeMembers} | PT상담 ${row.ptConsultations} | PT등록 ${row.ptRegistrations}`);
      totalReports++;
    }
  }

  // ── 결과 검증 ────────────────────────────────────────────────────────────
  const chToday = CITYHALL_DATA.at(-1);
  const chYesterday = CITYHALL_DATA.at(-2);
  const chFirst = CITYHALL_DATA.at(0);
  const chPtC = CITYHALL_DATA.reduce((s, r) => s + r.ptConsultations, 0);
  const chPtR = CITYHALL_DATA.reduce((s, r) => s + r.ptRegistrations, 0);

  const njToday = NEWJINJU_DATA.at(-1);
  const njYesterday = NEWJINJU_DATA.at(-2);
  const njFirst = NEWJINJU_DATA.at(0);
  const njPtC = NEWJINJU_DATA.reduce((s, r) => s + r.ptConsultations, 0);
  const njPtR = NEWJINJU_DATA.reduce((s, r) => s + r.ptRegistrations, 0);

  const totalPtC = chPtC + njPtC;
  const totalPtR = chPtR + njPtR;

  console.log("\n" + "=".repeat(50));
  console.log("SEED 완료 — 검증 결과");
  console.log("=".repeat(50));

  console.log(`\n생성된 지점: ${BRANCHES.length}개`);
  BRANCHES.forEach((b) => console.log(`  - ${b.id} (${b.name})`));

  console.log(`\n배정된 지점장 UID: ${MANAGER_UID}`);
  console.log(`생성된 보고서: ${totalReports}개 (${BRANCHES.length}개 지점 × 7일)`);

  console.log("\n━━━ 짐플릭스 시청점 예상값 ━━━");
  console.log(`  현재 유효회원: ${chToday.activeMembers}`);
  console.log(`  전일 대비: ${chToday.activeMembers - chYesterday.activeMembers >= 0 ? "+" : ""}${chToday.activeMembers - chYesterday.activeMembers}`);
  console.log(`  7일 시작 대비: +${chToday.activeMembers - chFirst.activeMembers}`);
  console.log(`  7일 PT 상담 합계: ${chPtC}`);
  console.log(`  7일 PT 등록 합계: ${chPtR}`);
  console.log(`  7일 PT 전환율: ${((chPtR / chPtC) * 100).toFixed(1)}%`);

  console.log("\n━━━ 짐플릭스 신진주역점 예상값 ━━━");
  console.log(`  현재 유효회원: ${njToday.activeMembers}`);
  console.log(`  전일 대비: +${njToday.activeMembers - njYesterday.activeMembers}`);
  console.log(`  7일 시작 대비: +${njToday.activeMembers - njFirst.activeMembers}`);
  console.log(`  7일 PT 상담 합계: ${njPtC}`);
  console.log(`  7일 PT 등록 합계: ${njPtR}`);
  console.log(`  7일 PT 전환율: ${((njPtR / njPtC) * 100).toFixed(1)}%`);

  console.log("\n━━━ 관리자 전체 합산 (7일) ━━━");
  console.log(`  오늘 전체 유효회원: ${chToday.activeMembers + njToday.activeMembers}`);
  console.log(`  7일 PT 상담 합계: ${totalPtC}`);
  console.log(`  7일 PT 등록 합계: ${totalPtR}`);
  console.log(`  7일 전체 PT 전환율: ${((totalPtR / totalPtC) * 100).toFixed(1)}% (${totalPtR}/${totalPtC}×100)`);

  console.log("\n배포 URL: https://returnlife-five.vercel.app");
  console.log("=".repeat(50) + "\n");
}

main().catch((err) => {
  console.error("\nSeed 실패:", err.message ?? err);
  process.exit(1);
});
