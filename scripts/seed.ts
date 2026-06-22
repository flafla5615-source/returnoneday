/**
 * 샘플 데이터 시딩 스크립트
 *
 * 실행 방법:
 *   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json npx tsx scripts/seed.ts
 *
 * 에뮬레이터 사용 시:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx tsx scripts/seed.ts
 *
 * 생성 내용:
 *   - 지점 2개: 짐플릭스 시청점, 짐플릭스 신진주역점
 *   - 관리자 1명 (Firestore 직접 생성 — Firebase Auth UID 연동 필요)
 *   - 지점장 1명 (Firestore 직접 생성 — Firebase Auth UID 연동 필요)
 *   - 7일치 일일 보고 (submitted 상태)
 *   - 캠페인 1개
 *
 * ⚠️  ADMIN_UID / MANAGER_UID는 Firebase Console > Authentication에서
 *     실제 계정을 만든 뒤 해당 UID로 교체해야 합니다.
 */

import * as admin from "firebase-admin";
import { format, subDays } from "date-fns";

// ── 실제 Firebase Auth UID로 교체하세요 ───────────────────────────────────
const ADMIN_UID = "REPLACE_WITH_REAL_ADMIN_UID";
const MANAGER_UID = "REPLACE_WITH_REAL_MANAGER_UID";
// ─────────────────────────────────────────────────────────────────────────

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: "returnoneday",
});

const db = admin.firestore();

const BRANCHES = [
  {
    id: "jf_city",
    name: "짐플릭스 시청점",
    brand: "짐플릭스",
    region: "경남",
  },
  {
    id: "jf_sinjinjustation",
    name: "짐플릭스 신진주역점",
    brand: "짐플릭스",
    region: "경남",
  },
];

async function seed() {
  console.log("🌱 Seeding Firestore (returnoneday)...");
  const now = admin.firestore.Timestamp.now();

  // ─── 1. 지점 ──────────────────────────────────────────────────────────
  console.log("Creating branches...");
  const branchBatch = db.batch();
  BRANCHES.forEach((b, i) => {
    branchBatch.set(db.collection("branches").doc(b.id), {
      ...b,
      active: true,
      managerUids: [MANAGER_UID],
      sortOrder: i,
      createdAt: now,
      updatedAt: now,
    });
  });
  await branchBatch.commit();

  // ─── 2. 관리자 ────────────────────────────────────────────────────────
  console.log("Creating admin user document...");
  await db.collection("users").doc(ADMIN_UID).set({
    uid: ADMIN_UID,
    name: "관리자",
    email: "admin@returnlife.co.kr",
    role: "admin",
    status: "active",
    branchIds: [],
    createdAt: now,
    updatedAt: now,
  });

  // ─── 3. 지점장 ────────────────────────────────────────────────────────
  console.log("Creating branch manager user document...");
  await db.collection("users").doc(MANAGER_UID).set({
    uid: MANAGER_UID,
    name: "김지점",
    email: "manager@returnlife.co.kr",
    role: "branch_manager",
    status: "active",
    branchIds: ["jf_city", "jf_sinjinjustation"],
    createdAt: now,
    updatedAt: now,
  });

  // ─── 4. 7일치 일일 보고 ────────────────────────────────────────────────
  console.log("Creating daily reports (7 days × 2 branches)...");
  const today = new Date();

  for (let day = 0; day < 7; day++) {
    const dateStr = format(subDays(today, day), "yyyy-MM-dd");
    const repBatch = db.batch();

    for (const branch of BRANCHES) {
      const ptConsult = Math.floor(Math.random() * 6) + 2;
      const ptReg = Math.floor(Math.random() * (ptConsult + 1));
      const reportId = `${branch.id}_${dateStr}`;

      // 오늘 보고는 draft, 나머지는 submitted
      const status = day === 0 ? "draft" : "submitted";

      repBatch.set(db.collection("dailyReports").doc(reportId), {
        id: reportId,
        branchId: branch.id,
        reportDate: dateStr,
        writerUid: MANAGER_UID,
        status,
        activeMembers: 380 + Math.floor(Math.random() * 40),
        inquiries: Math.floor(Math.random() * 10) + 3,
        ptConsultations: ptConsult,
        ptRegistrations: ptReg,
        reRegistrations: Math.floor(Math.random() * 3),
        comebackMembers: Math.floor(Math.random() * 2),
        happyCalls: Math.floor(Math.random() * 15) + 5,
        newHappyCalls: Math.floor(Math.random() * 8),
        existingHappyCalls: Math.floor(Math.random() * 8),
        expiringTmCount: Math.floor(Math.random() * 10),
        expiringTmMethods: ["전화", "문자"],
        unregisteredTmCount: Math.floor(Math.random() * 8),
        unregisteredTmMethods: ["전화"],
        offlinePromotionCount: Math.floor(Math.random() * 15),
        offlinePromotionMethods: ["전단지"],
        createdAt: now,
        updatedAt: now,
        ...(status === "submitted" ? { submittedAt: now } : {}),
      });
    }

    await repBatch.commit();
  }

  // ─── 5. 캠페인 ────────────────────────────────────────────────────────
  console.log("Creating campaign...");
  await db.collection("campaigns").doc("campaign_2026_summer").set({
    id: "campaign_2026_summer",
    name: "2026 여름 회원 유치 캠페인",
    description: "여름 성수기 신규 회원 등록 및 재등록 촉진 이벤트",
    startDate: "2026-06-01",
    endDate: "2026-08-31",
    targetBranchIds: BRANCHES.map((b) => b.id),
    metricDefinitions: [
      { key: "newRegistration", label: "신규등록" },
      { key: "reRegistration", label: "재등록" },
      { key: "comeback", label: "컴백회원" },
    ],
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  console.log("✅ Seed 완료!");
  process.exit(0);
}

seed().catch((e) => {
  console.error("❌ Seed 실패:", e);
  process.exit(1);
});
