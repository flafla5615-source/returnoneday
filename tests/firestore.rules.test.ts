/**
 * Firestore Security Rules 테스트
 *
 * 실행 방법:
 *   1. Firebase 에뮬레이터 실행:
 *      firebase emulators:start --only firestore
 *   2. 테스트 실행:
 *      npx jest tests/firestore.rules.test.ts
 *
 * 테스트 케이스:
 *   1. 비로그인 사용자 — 모든 컬렉션 읽기 거부
 *   2. pending 지점장 — campaigns 읽기 거부 (active 아님)
 *   3. active 지점장 — 자신의 지점 dailyReport 읽기 허용
 *   4. active 지점장 — 타 지점 dailyReport 읽기 거부
 *   5. active 지점장 — locked 보고 수정 거부
 *   6. admin — 모든 보고 상태 변경 허용
 *   7. 회원가입 시 role=admin 강제 생성 거부
 */

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
} from "firebase/firestore";

const PROJECT_ID = "returnoneday-test";
const RULES_PATH = resolve(__dirname, "../firestore.rules");

const BRANCH_ID = "jf_city";
const OTHER_BRANCH_ID = "jf_other";
const ADMIN_UID = "admin_001";
const MANAGER_UID = "mgr_001";
const PENDING_MANAGER_UID = "mgr_pending";
const OTHER_MANAGER_UID = "mgr_002";

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(RULES_PATH, "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });

  // 초기 데이터 세팅 (Rules 비활성화 상태로)
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    // 관리자
    await setDoc(doc(db, "users", ADMIN_UID), {
      uid: ADMIN_UID,
      name: "관리자",
      email: "admin@test.com",
      role: "admin",
      status: "active",
      branchIds: [],
    });

    // active 지점장
    await setDoc(doc(db, "users", MANAGER_UID), {
      uid: MANAGER_UID,
      name: "김지점",
      email: "mgr@test.com",
      role: "branch_manager",
      status: "active",
      branchIds: [BRANCH_ID],
    });

    // pending 지점장
    await setDoc(doc(db, "users", PENDING_MANAGER_UID), {
      uid: PENDING_MANAGER_UID,
      name: "이지점",
      email: "pending@test.com",
      role: "branch_manager",
      status: "pending",
      branchIds: [BRANCH_ID],
    });

    // 타 지점 지점장
    await setDoc(doc(db, "users", OTHER_MANAGER_UID), {
      uid: OTHER_MANAGER_UID,
      name: "박지점",
      email: "other@test.com",
      role: "branch_manager",
      status: "active",
      branchIds: [OTHER_BRANCH_ID],
    });

    // 지점
    await setDoc(doc(db, "branches", BRANCH_ID), {
      id: BRANCH_ID,
      name: "짐플릭스 시청점",
      brand: "짐플릭스",
      active: true,
    });

    // submitted 보고
    await setDoc(doc(db, "dailyReports", `${BRANCH_ID}_2026-06-01`), {
      id: `${BRANCH_ID}_2026-06-01`,
      branchId: BRANCH_ID,
      reportDate: "2026-06-01",
      writerUid: MANAGER_UID,
      status: "submitted",
      activeMembers: 300,
    });

    // locked 보고
    await setDoc(doc(db, "dailyReports", `${BRANCH_ID}_2026-06-02`), {
      id: `${BRANCH_ID}_2026-06-02`,
      branchId: BRANCH_ID,
      reportDate: "2026-06-02",
      writerUid: MANAGER_UID,
      status: "locked",
      activeMembers: 310,
    });

    // 캠페인
    await setDoc(doc(db, "campaigns", "campaign_001"), {
      id: "campaign_001",
      name: "테스트 캠페인",
      status: "active",
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

// ─── 1. 비로그인 사용자 — 모든 읽기 거부 ─────────────────────────────────
describe("Case 1: 비로그인 사용자", () => {
  test("users 읽기 거부", async () => {
    const unauth = testEnv.unauthenticatedContext();
    await assertFails(getDoc(doc(unauth.firestore(), "users", MANAGER_UID)));
  });

  test("dailyReports 읽기 거부", async () => {
    const unauth = testEnv.unauthenticatedContext();
    await assertFails(
      getDoc(doc(unauth.firestore(), "dailyReports", `${BRANCH_ID}_2026-06-01`))
    );
  });

  test("campaigns 읽기 거부", async () => {
    const unauth = testEnv.unauthenticatedContext();
    await assertFails(
      getDoc(doc(unauth.firestore(), "campaigns", "campaign_001"))
    );
  });
});

// ─── 2. pending 지점장 — campaigns 읽기 거부 ─────────────────────────────
describe("Case 2: pending 지점장", () => {
  test("campaigns 읽기 거부 (status=pending → isActive() 실패)", async () => {
    const ctx = testEnv.authenticatedContext(PENDING_MANAGER_UID);
    await assertFails(
      getDoc(doc(ctx.firestore(), "campaigns", "campaign_001"))
    );
  });

  test("자신의 users 문서 읽기는 허용 (any auth)", async () => {
    const ctx = testEnv.authenticatedContext(PENDING_MANAGER_UID);
    await assertSucceeds(
      getDoc(doc(ctx.firestore(), "users", PENDING_MANAGER_UID))
    );
  });
});

// ─── 3. active 지점장 — 자신의 지점 dailyReport 읽기 허용 ────────────────
describe("Case 3: active 지점장 — 자기 지점 보고 접근", () => {
  test("담당 지점 보고 읽기 허용", async () => {
    const ctx = testEnv.authenticatedContext(MANAGER_UID);
    await assertSucceeds(
      getDoc(
        doc(ctx.firestore(), "dailyReports", `${BRANCH_ID}_2026-06-01`)
      )
    );
  });

  test("campaigns 읽기 허용 (active)", async () => {
    const ctx = testEnv.authenticatedContext(MANAGER_UID);
    await assertSucceeds(
      getDoc(doc(ctx.firestore(), "campaigns", "campaign_001"))
    );
  });
});

// ─── 4. active 지점장 — 타 지점 dailyReport 읽기 거부 ────────────────────
describe("Case 4: active 지점장 — 타 지점 보고 접근 거부", () => {
  test("타 지점 보고 읽기 거부", async () => {
    const ctx = testEnv.authenticatedContext(OTHER_MANAGER_UID);
    await assertFails(
      getDoc(
        doc(ctx.firestore(), "dailyReports", `${BRANCH_ID}_2026-06-01`)
      )
    );
  });
});

// ─── 5. active 지점장 — locked 보고 수정 거부 ────────────────────────────
describe("Case 5: locked 보고 수정 거부", () => {
  test("locked 상태 보고 updateDoc 거부", async () => {
    const ctx = testEnv.authenticatedContext(MANAGER_UID);
    await assertFails(
      updateDoc(
        doc(ctx.firestore(), "dailyReports", `${BRANCH_ID}_2026-06-02`),
        { activeMembers: 999 }
      )
    );
  });
});

// ─── 6. admin — 모든 보고 읽기/상태 변경 허용 ────────────────────────────
describe("Case 6: admin 권한", () => {
  test("모든 지점 보고 읽기 허용", async () => {
    const ctx = testEnv.authenticatedContext(ADMIN_UID);
    await assertSucceeds(
      getDoc(
        doc(ctx.firestore(), "dailyReports", `${BRANCH_ID}_2026-06-01`)
      )
    );
  });

  test("locked 보고도 updateDoc 허용", async () => {
    const ctx = testEnv.authenticatedContext(ADMIN_UID);
    await assertSucceeds(
      updateDoc(
        doc(ctx.firestore(), "dailyReports", `${BRANCH_ID}_2026-06-02`),
        { status: "submitted" }
      )
    );
  });
});

// ─── 7. 회원가입 시 role=admin 강제 생성 거부 ────────────────────────────
describe("Case 7: 회원가입 보안 검증", () => {
  const NEW_UID = "new_user_attempt_admin";

  test("role=admin으로 users 문서 생성 거부", async () => {
    const ctx = testEnv.authenticatedContext(NEW_UID);
    await assertFails(
      setDoc(doc(ctx.firestore(), "users", NEW_UID), {
        uid: NEW_UID,
        name: "악의적 관리자",
        email: "evil@test.com",
        role: "admin",           // admin 강제 시도
        status: "active",        // active 강제 시도
        branchIds: [],
      })
    );
  });

  test("role=branch_manager, status=pending으로만 생성 허용", async () => {
    const ctx = testEnv.authenticatedContext(NEW_UID);
    await assertSucceeds(
      setDoc(doc(ctx.firestore(), "users", NEW_UID), {
        uid: NEW_UID,
        name: "정상 가입자",
        email: "normal@test.com",
        role: "branch_manager",  // 올바른 role
        status: "pending",       // 올바른 초기 status
        branchIds: [],
      })
    );
  });
});
