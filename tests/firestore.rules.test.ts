import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { getKoreaToday, getKoreaYesterday } from "@/lib/utils";

const PROJECT_ID = "returnoneday-test";
const RULES_PATH = resolve(__dirname, "../firestore.rules");

const BRANCH_ID = "gymflix_sicheong";
const OTHER_BRANCH_ID = "gymflix_newjinju_station";
const ADMIN_UID = "admin_001";
const MANAGER_UID = "manager_001";
const MULTI_MANAGER_UID = "manager_multi";
const PENDING_MANAGER_UID = "manager_pending";
const OTHER_MANAGER_UID = "manager_002";

let testEnv: RulesTestEnvironment;

function authedDb(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}

function unauthDb() {
  return testEnv.unauthenticatedContext().firestore();
}

function reportId(branchId: string, date: string) {
  return `${branchId}_${date}`;
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(RULES_PATH, "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    await setDoc(doc(db, "users", ADMIN_UID), {
      uid: ADMIN_UID,
      name: "Admin",
      email: "admin@test.com",
      role: "admin",
      status: "active",
      branchIds: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, "users", MANAGER_UID), {
      uid: MANAGER_UID,
      name: "Branch Manager",
      email: "manager@test.com",
      role: "branch_manager",
      status: "active",
      branchIds: [BRANCH_ID],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, "users", MULTI_MANAGER_UID), {
      uid: MULTI_MANAGER_UID,
      name: "Multi Branch Manager",
      email: "multi@test.com",
      role: "branch_manager",
      status: "active",
      branchIds: [BRANCH_ID, OTHER_BRANCH_ID],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, "users", PENDING_MANAGER_UID), {
      uid: PENDING_MANAGER_UID,
      name: "Pending Manager",
      email: "pending@test.com",
      role: "branch_manager",
      status: "pending",
      branchIds: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, "users", OTHER_MANAGER_UID), {
      uid: OTHER_MANAGER_UID,
      name: "Other Manager",
      email: "other@test.com",
      role: "branch_manager",
      status: "active",
      branchIds: [OTHER_BRANCH_ID],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, "branches", BRANCH_ID), {
      id: BRANCH_ID,
      name: "Gymflix Sicheong",
      brand: "Gymflix",
      region: "Jinju",
      active: true,
      managerUids: [MANAGER_UID, MULTI_MANAGER_UID],
      sortOrder: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, "branches", OTHER_BRANCH_ID), {
      id: OTHER_BRANCH_ID,
      name: "Gymflix New Jinju Station",
      brand: "Gymflix",
      region: "Jinju",
      active: true,
      managerUids: [OTHER_MANAGER_UID, MULTI_MANAGER_UID],
      sortOrder: 2,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, "dailyReports", reportId(BRANCH_ID, "2026-06-01")), {
      id: reportId(BRANCH_ID, "2026-06-01"),
      branchId: BRANCH_ID,
      reportDate: "2026-06-01",
      writerUid: MANAGER_UID,
      status: "submitted",
      activeMembers: 300,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      submittedAt: serverTimestamp(),
    });

    await setDoc(doc(db, "dailyReports", reportId(BRANCH_ID, "2026-06-02")), {
      id: reportId(BRANCH_ID, "2026-06-02"),
      branchId: BRANCH_ID,
      reportDate: "2026-06-02",
      writerUid: MANAGER_UID,
      status: "locked",
      activeMembers: 310,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(
      doc(db, "dailyReports", reportId(OTHER_BRANCH_ID, "2026-06-01")),
      {
        id: reportId(OTHER_BRANCH_ID, "2026-06-01"),
        branchId: OTHER_BRANCH_ID,
        reportDate: "2026-06-01",
        writerUid: OTHER_MANAGER_UID,
        status: "submitted",
        activeMembers: 120,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        submittedAt: serverTimestamp(),
      }
    );

    await setDoc(doc(db, "campaigns", "campaign_001"), {
      id: "campaign_001",
      name: "Summer Campaign",
      status: "active",
      startDate: "2026-06-01",
      endDate: "2026-06-30",
      targetBranchIds: [BRANCH_ID, OTHER_BRANCH_ID],
      metricDefinitions: [{ key: "leads", label: "Leads" }],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe("unauthenticated access", () => {
  test("cannot read protected collections", async () => {
    const db = unauthDb();

    await assertFails(getDoc(doc(db, "users", MANAGER_UID)));
    await assertFails(getDoc(doc(db, "branches", BRANCH_ID)));
    await assertFails(
      getDoc(doc(db, "dailyReports", reportId(BRANCH_ID, "2026-06-01")))
    );
    await assertFails(getDoc(doc(db, "campaigns", "campaign_001")));
  });
});

describe("signup and pending manager access", () => {
  test("new users can only create a pending branch manager profile for themselves", async () => {
    const newUid = "new_signup_user";
    const db = authedDb(newUid);

    await assertFails(
      setDoc(doc(db, "users", newUid), {
        uid: newUid,
        name: "Attempted Admin",
        email: "attempted-admin@test.com",
        role: "admin",
        status: "active",
        branchIds: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    await assertSucceeds(
      setDoc(doc(db, "users", newUid), {
        uid: newUid,
        name: "Pending Signup",
        email: "pending-signup@test.com",
        role: "branch_manager",
        status: "pending",
        branchIds: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("pending managers can read their own profile but cannot read active-only data", async () => {
    const db = authedDb(PENDING_MANAGER_UID);

    await assertSucceeds(getDoc(doc(db, "users", PENDING_MANAGER_UID)));
    await assertFails(getDoc(doc(db, "campaigns", "campaign_001")));
    await assertFails(getDoc(doc(db, "branches", BRANCH_ID)));
  });

  test("users cannot approve themselves or assign branches", async () => {
    const db = authedDb(PENDING_MANAGER_UID);

    await assertFails(
      updateDoc(doc(db, "users", PENDING_MANAGER_UID), {
        status: "active",
      })
    );
    await assertFails(
      updateDoc(doc(db, "users", PENDING_MANAGER_UID), {
        branchIds: [BRANCH_ID],
      })
    );
  });
});

describe("branch manager report access", () => {
  test("active managers can read their own branch data", async () => {
    const db = authedDb(MANAGER_UID);

    await assertSucceeds(getDoc(doc(db, "branches", BRANCH_ID)));
    await assertSucceeds(
      getDoc(doc(db, "dailyReports", reportId(BRANCH_ID, "2026-06-01")))
    );
    await assertSucceeds(getDoc(doc(db, "campaigns", "campaign_001")));
  });

  test("active managers cannot directly read another branch report", async () => {
    const db = authedDb(MANAGER_UID);

    await assertFails(
      getDoc(
        doc(db, "dailyReports", reportId(OTHER_BRANCH_ID, "2026-06-01"))
      )
    );
  });

  test("active managers can query only their own branch reports", async () => {
    const db = authedDb(MANAGER_UID);

    await assertSucceeds(
      getDocs(
        query(
          collection(db, "dailyReports"),
          where("branchId", "==", BRANCH_ID)
        )
      )
    );
    await assertFails(
      getDocs(
        query(
          collection(db, "dailyReports"),
          where("branchId", "==", OTHER_BRANCH_ID)
        )
      )
    );
  });

  test("multi-branch managers can read each assigned branch", async () => {
    const db = authedDb(MULTI_MANAGER_UID);

    await assertSucceeds(getDoc(doc(db, "branches", BRANCH_ID)));
    await assertSucceeds(getDoc(doc(db, "branches", OTHER_BRANCH_ID)));
    await assertSucceeds(
      getDoc(doc(db, "dailyReports", reportId(BRANCH_ID, "2026-06-01")))
    );
    await assertSucceeds(
      getDoc(
        doc(db, "dailyReports", reportId(OTHER_BRANCH_ID, "2026-06-01"))
      )
    );
  });

  test("active managers can get a missing assigned-branch report before creating it", async () => {
    const db = authedDb(MANAGER_UID);

    await assertSucceeds(
      getDoc(doc(db, "dailyReports", reportId(BRANCH_ID, "2026-06-10")))
    );
  });

  test("active managers can create and submit draft reports for assigned branches only", async () => {
    const db = authedDb(MANAGER_UID);
    const today = getKoreaToday();
    const newReportId = reportId(BRANCH_ID, today);

    await assertSucceeds(
      setDoc(doc(db, "dailyReports", newReportId), {
        id: newReportId,
        branchId: BRANCH_ID,
        reportDate: today,
        writerUid: MANAGER_UID,
        status: "draft",
        activeMembers: 320,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    await assertSucceeds(
      updateDoc(doc(db, "dailyReports", newReportId), {
        activeMembers: 321,
        status: "submitted",
        updatedAt: serverTimestamp(),
        submittedAt: serverTimestamp(),
      })
    );

    const otherReportId = reportId(OTHER_BRANCH_ID, today);
    await assertFails(
      setDoc(doc(db, "dailyReports", otherReportId), {
        id: otherReportId,
        branchId: OTHER_BRANCH_ID,
        reportDate: today,
        writerUid: MANAGER_UID,
        status: "draft",
        activeMembers: 200,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("active managers can create a draft report for yesterday (KST) but not further in the past or future", async () => {
    const db = authedDb(MANAGER_UID);
    const yesterday = getKoreaYesterday();
    const yReportId = reportId(BRANCH_ID, yesterday);

    await assertSucceeds(
      setDoc(doc(db, "dailyReports", yReportId), {
        id: yReportId,
        branchId: BRANCH_ID,
        reportDate: yesterday,
        writerUid: MANAGER_UID,
        status: "draft",
        activeMembers: 300,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    const oldDate = "2020-01-01";
    const oldReportId = reportId(BRANCH_ID, oldDate);
    await assertFails(
      setDoc(doc(db, "dailyReports", oldReportId), {
        id: oldReportId,
        branchId: BRANCH_ID,
        reportDate: oldDate,
        writerUid: MANAGER_UID,
        status: "draft",
        activeMembers: 100,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    const futureDate = "2099-01-01";
    const futureReportId = reportId(BRANCH_ID, futureDate);
    await assertFails(
      setDoc(doc(db, "dailyReports", futureReportId), {
        id: futureReportId,
        branchId: BRANCH_ID,
        reportDate: futureDate,
        writerUid: MANAGER_UID,
        status: "draft",
        activeMembers: 100,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("managers cannot edit submitted or locked reports unless revision is requested", async () => {
    const db = authedDb(MANAGER_UID);

    await assertFails(
      updateDoc(doc(db, "dailyReports", reportId(BRANCH_ID, "2026-06-01")), {
        activeMembers: 999,
      })
    );
    await assertFails(
      updateDoc(doc(db, "dailyReports", reportId(BRANCH_ID, "2026-06-02")), {
        activeMembers: 999,
      })
    );
  });
});

describe("admin access", () => {
  test("admins can read and update reports across branches", async () => {
    const db = authedDb(ADMIN_UID);

    await assertSucceeds(
      getDoc(doc(db, "dailyReports", reportId(BRANCH_ID, "2026-06-01")))
    );
    await assertSucceeds(
      getDoc(
        doc(db, "dailyReports", reportId(OTHER_BRANCH_ID, "2026-06-01"))
      )
    );
    await assertSucceeds(
      updateDoc(doc(db, "dailyReports", reportId(BRANCH_ID, "2026-06-02")), {
        status: "revision_required",
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("admins can create a branch_manager profile for an existing Auth uid", async () => {
    const db = authedDb(ADMIN_UID);
    const newUid = "auth_console_created_001";

    await assertSucceeds(
      setDoc(doc(db, "users", newUid), {
        uid: newUid,
        name: "머팩 벌리점",
        email: "beolli@returnlife.co.kr",
        role: "branch_manager",
        status: "active",
        active: true,
        branchIds: [BRANCH_ID],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("admins cannot mint an admin account through the link path", async () => {
    const db = authedDb(ADMIN_UID);
    const newUid = "auth_console_created_002";

    await assertFails(
      setDoc(doc(db, "users", newUid), {
        uid: newUid,
        name: "가짜 관리자",
        email: "fake@returnlife.co.kr",
        role: "admin",
        status: "active",
        active: true,
        branchIds: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // uid 가 문서 ID 와 다르면 거부된다
    await assertFails(
      setDoc(doc(db, "users", "auth_console_created_003"), {
        uid: "someone_else",
        name: "불일치",
        email: "x@returnlife.co.kr",
        role: "branch_manager",
        status: "active",
        active: true,
        branchIds: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("managers still cannot create profiles for other uids", async () => {
    const db = authedDb(MANAGER_UID);

    await assertFails(
      setDoc(doc(db, "users", "someone_else_999"), {
        uid: "someone_else_999",
        name: "머팩 벌리점",
        email: "beolli@returnlife.co.kr",
        role: "branch_manager",
        status: "active",
        active: true,
        branchIds: [BRANCH_ID],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("admins can approve users and assign branches", async () => {
    const db = authedDb(ADMIN_UID);

    await assertSucceeds(
      updateDoc(doc(db, "users", PENDING_MANAGER_UID), {
        status: "active",
        branchIds: [BRANCH_ID],
        updatedAt: serverTimestamp(),
      })
    );
  });
});

/* ── branchShiftReports (지점별 일일보고 — 오전/마감) ────────────────────────
   2단계에서 지점장 계정을 지점별로 배정하므로, 담당 지점 외 접근이 실제로
   막히는지 규칙 수준에서 확인한다.                                           */

function shiftId(branchId: string, date: string, shift: "morning" | "closing") {
  return `${branchId}_${date}_${shift}`;
}

function shiftPayload(
  branchId: string,
  date: string,
  shift: "morning" | "closing",
  writerUid: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    id: shiftId(branchId, date, shift),
    branchId,
    branchName: "테스트 지점",
    reportDate: date,
    shift,
    content: "오늘 특이사항 없습니다.",
    status: "draft",
    writerUid,
    writerName: "테스트 지점",
    editCount: 0,
    edits: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

describe("branch shift reports — 담당 지점만 작성·조회", () => {
  test("담당 지점의 오전·마감 보고를 작성할 수 있다", async () => {
    const db = authedDb(MANAGER_UID);
    const today = getKoreaToday();

    await assertSucceeds(
      setDoc(
        doc(db, "branchShiftReports", shiftId(BRANCH_ID, today, "morning")),
        shiftPayload(BRANCH_ID, today, "morning", MANAGER_UID)
      )
    );
    await assertSucceeds(
      setDoc(
        doc(db, "branchShiftReports", shiftId(BRANCH_ID, today, "closing")),
        shiftPayload(BRANCH_ID, today, "closing", MANAGER_UID, {
          status: "submitted",
          submittedAt: serverTimestamp(),
        })
      )
    );
  });

  test("타 지점 보고는 작성할 수 없다", async () => {
    const db = authedDb(MANAGER_UID);
    const today = getKoreaToday();

    await assertFails(
      setDoc(
        doc(db, "branchShiftReports", shiftId(OTHER_BRANCH_ID, today, "morning")),
        shiftPayload(OTHER_BRANCH_ID, today, "morning", MANAGER_UID)
      )
    );
  });

  test("타 지점 보고는 조회할 수 없다 (단건·목록 모두)", async () => {
    const today = getKoreaToday();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "branchShiftReports", shiftId(OTHER_BRANCH_ID, today, "morning")),
        shiftPayload(OTHER_BRANCH_ID, today, "morning", OTHER_MANAGER_UID)
      );
    });

    const db = authedDb(MANAGER_UID);
    await assertFails(
      getDoc(doc(db, "branchShiftReports", shiftId(OTHER_BRANCH_ID, today, "morning")))
    );
    await assertFails(
      getDocs(
        query(collection(db, "branchShiftReports"), where("branchId", "==", OTHER_BRANCH_ID))
      )
    );
    await assertSucceeds(
      getDocs(query(collection(db, "branchShiftReports"), where("branchId", "==", BRANCH_ID)))
    );
  });

  test("타 지점 보고를 수정하거나 자기 지점으로 옮길 수 없다", async () => {
    const today = getKoreaToday();
    const db = authedDb(MANAGER_UID);

    await assertFails(
      updateDoc(
        doc(db, "branchShiftReports", shiftId(OTHER_BRANCH_ID, today, "morning")),
        { content: "남의 지점 보고 수정 시도", updatedAt: serverTimestamp() }
      )
    );
    // 지점 재귀속 차단: branchId 를 자기 지점으로 바꾸는 것도 막혀야 한다
    await assertFails(
      updateDoc(
        doc(db, "branchShiftReports", shiftId(OTHER_BRANCH_ID, today, "morning")),
        { branchId: BRANCH_ID, updatedAt: serverTimestamp() }
      )
    );
  });

  test("과거 보고일은 소급 작성할 수 있고 미래 보고일은 막힌다", async () => {
    const db = authedDb(MANAGER_UID);
    const past = "2026-01-05";
    const future = "2099-01-01";

    await assertSucceeds(
      setDoc(
        doc(db, "branchShiftReports", shiftId(BRANCH_ID, past, "morning")),
        shiftPayload(BRANCH_ID, past, "morning", MANAGER_UID)
      )
    );
    await assertFails(
      setDoc(
        doc(db, "branchShiftReports", shiftId(BRANCH_ID, future, "morning")),
        shiftPayload(BRANCH_ID, future, "morning", MANAGER_UID)
      )
    );
  });

  test("문서 ID가 지점·날짜·유형과 어긋나면 거부된다 (중복/위조 방지)", async () => {
    const db = authedDb(MANAGER_UID);
    const today = getKoreaToday();

    await assertFails(
      setDoc(
        doc(db, "branchShiftReports", `${BRANCH_ID}_${today}_morning_2`),
        shiftPayload(BRANCH_ID, today, "morning", MANAGER_UID, {
          id: `${BRANCH_ID}_${today}_morning_2`,
        })
      )
    );
  });

  test("제출 시각은 서버 시각으로만 기록된다 (정시 위조 차단)", async () => {
    const db = authedDb(MANAGER_UID);
    const yesterday = getKoreaYesterday();

    await assertFails(
      setDoc(
        doc(db, "branchShiftReports", shiftId(BRANCH_ID, yesterday, "closing")),
        shiftPayload(BRANCH_ID, yesterday, "closing", MANAGER_UID, {
          status: "submitted",
          // 기한 안에 낸 것처럼 보이게 만든 임의 시각
          submittedAt: new Date("2026-01-01T00:00:00Z"),
        })
      )
    );
  });

  test("최초 제출 시각은 수정해도 바뀌지 않는다", async () => {
    const date = "2026-02-10";
    const id = shiftId(BRANCH_ID, date, "closing");

    // 서버 시각으로 제출된 상태를 만들어 둔다
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "branchShiftReports", id),
        shiftPayload(BRANCH_ID, date, "closing", MANAGER_UID, {
          status: "submitted",
          submittedAt: new Date("2026-02-10T11:50:00Z"),
        })
      );
    });

    const db = authedDb(MANAGER_UID);

    // 본문 수정은 되지만 submittedAt 을 함께 바꾸려 하면 거부된다
    await assertFails(
      updateDoc(doc(db, "branchShiftReports", id), {
        content: "수정본",
        submittedAt: new Date("2026-02-10T11:00:00Z"), // 정시였던 것처럼 앞당기기
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      updateDoc(doc(db, "branchShiftReports", id), {
        submittedAt: serverTimestamp(), // 지금 시각으로 덮어쓰기
        updatedAt: serverTimestamp(),
      })
    );
    // submittedAt 을 건드리지 않는 본문 수정은 허용된다
    await assertSucceeds(
      updateDoc(doc(db, "branchShiftReports", id), {
        content: "수정본",
        editCount: 1,
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("다지점 담당자는 배정된 모든 지점에 쓸 수 있다", async () => {
    const db = authedDb(MULTI_MANAGER_UID);
    const today = getKoreaToday();

    await assertSucceeds(
      setDoc(
        doc(db, "branchShiftReports", shiftId(OTHER_BRANCH_ID, today, "closing")),
        shiftPayload(OTHER_BRANCH_ID, today, "closing", MULTI_MANAGER_UID)
      )
    );
  });

  test("본사(admin)는 전 지점 보고를 조회할 수 있다", async () => {
    const db = authedDb(ADMIN_UID);
    const today = getKoreaToday();

    await assertSucceeds(
      getDoc(doc(db, "branchShiftReports", shiftId(BRANCH_ID, today, "morning")))
    );
    await assertSucceeds(
      getDoc(doc(db, "branchShiftReports", shiftId(OTHER_BRANCH_ID, today, "morning")))
    );
    await assertSucceeds(getDocs(collection(db, "branchShiftReports")));
  });

  test("로그인하지 않으면 접근할 수 없다", async () => {
    const db = unauthDb();
    const today = getKoreaToday();

    await assertFails(
      getDoc(doc(db, "branchShiftReports", shiftId(BRANCH_ID, today, "morning")))
    );
    await assertFails(
      setDoc(
        doc(db, "branchShiftReports", shiftId(BRANCH_ID, today, "morning")),
        shiftPayload(BRANCH_ID, today, "morning", "anonymous")
      )
    );
  });
});

/* ── branchWeeklyReports (주간보고) ──────────────────────────────────────────
   담당 지점만 작성·조회되는지, 미래 주차가 막히는지, 최초 제출 시각이
   보존되는지를 규칙 수준에서 확인한다.                                        */

function weeklyId(branchId: string, weekStart: string) {
  return `${branchId}_${weekStart}`;
}

function weeklyPayload(
  branchId: string,
  weekStart: string,
  weekEnd: string,
  uid: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    id: weeklyId(branchId, weekStart),
    branchId,
    branchName: "테스트 지점",
    weekStartDate: weekStart,
    weekEndDate: weekEnd,
    content: "이번 주 운영 내용입니다.",
    status: "draft",
    updatedAt: serverTimestamp(),
    updatedBy: uid,
    updatedByName: "테스트 지점",
    createdAt: serverTimestamp(),
    editCount: 0,
    editHistory: [],
    ...overrides,
  };
}

describe("branch weekly reports — 담당 지점만 작성·조회", () => {
  const PAST_WEEK = "2026-01-05"; // 월요일
  const PAST_WEEK_END = "2026-01-11";
  const FUTURE_WEEK = "2099-01-04";
  const FUTURE_WEEK_END = "2099-01-10";

  test("담당 지점의 지난 주차 보고를 작성할 수 있다", async () => {
    const db = authedDb(MANAGER_UID);
    await assertSucceeds(
      setDoc(
        doc(db, "branchWeeklyReports", weeklyId(BRANCH_ID, PAST_WEEK)),
        weeklyPayload(BRANCH_ID, PAST_WEEK, PAST_WEEK_END, MANAGER_UID)
      )
    );
  });

  test("미래 주차는 작성할 수 없다", async () => {
    const db = authedDb(MANAGER_UID);
    await assertFails(
      setDoc(
        doc(db, "branchWeeklyReports", weeklyId(BRANCH_ID, FUTURE_WEEK)),
        weeklyPayload(BRANCH_ID, FUTURE_WEEK, FUTURE_WEEK_END, MANAGER_UID)
      )
    );
  });

  test("타 지점 주간보고는 작성·조회·수정할 수 없다", async () => {
    const week = "2026-02-02";
    const weekEnd = "2026-02-08";
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "branchWeeklyReports", weeklyId(OTHER_BRANCH_ID, week)),
        weeklyPayload(OTHER_BRANCH_ID, week, weekEnd, OTHER_MANAGER_UID)
      );
    });

    const db = authedDb(MANAGER_UID);
    await assertFails(
      setDoc(
        doc(db, "branchWeeklyReports", weeklyId(OTHER_BRANCH_ID, "2026-02-09")),
        weeklyPayload(OTHER_BRANCH_ID, "2026-02-09", "2026-02-15", MANAGER_UID)
      )
    );
    await assertFails(
      getDoc(doc(db, "branchWeeklyReports", weeklyId(OTHER_BRANCH_ID, week)))
    );
    await assertFails(
      getDocs(
        query(collection(db, "branchWeeklyReports"), where("branchId", "==", OTHER_BRANCH_ID))
      )
    );
    await assertFails(
      updateDoc(doc(db, "branchWeeklyReports", weeklyId(OTHER_BRANCH_ID, week)), {
        content: "남의 지점 수정 시도",
        updatedAt: serverTimestamp(),
      })
    );
    // 자기 지점 목록 조회는 된다
    await assertSucceeds(
      getDocs(query(collection(db, "branchWeeklyReports"), where("branchId", "==", BRANCH_ID)))
    );
  });

  test("문서 ID가 지점·주차와 어긋나면 거부된다 (중복 생성 방지)", async () => {
    const db = authedDb(MANAGER_UID);
    await assertFails(
      setDoc(
        doc(db, "branchWeeklyReports", `${BRANCH_ID}_${PAST_WEEK}_2`),
        weeklyPayload(BRANCH_ID, PAST_WEEK, PAST_WEEK_END, MANAGER_UID, {
          id: `${BRANCH_ID}_${PAST_WEEK}_2`,
        })
      )
    );
  });

  test("빈 내용은 제출할 수 없다", async () => {
    const db = authedDb(MANAGER_UID);
    await assertFails(
      setDoc(
        doc(db, "branchWeeklyReports", weeklyId(BRANCH_ID, "2026-03-02")),
        weeklyPayload(BRANCH_ID, "2026-03-02", "2026-03-08", MANAGER_UID, {
          content: "",
          status: "submitted",
          submittedAt: serverTimestamp(),
        })
      )
    );
  });

  test("제출 시각은 서버 시각으로만 기록되고, 이후 수정해도 유지된다", async () => {
    const week = "2026-04-06";
    const weekEnd = "2026-04-12";
    const id = weeklyId(BRANCH_ID, week);
    const db = authedDb(MANAGER_UID);

    // 임의 시각으로 제출 시각을 위조할 수 없다
    await assertFails(
      setDoc(
        doc(db, "branchWeeklyReports", id),
        weeklyPayload(BRANCH_ID, week, weekEnd, MANAGER_UID, {
          status: "submitted",
          submittedAt: new Date("2026-04-06T00:00:00Z"),
        })
      )
    );

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "branchWeeklyReports", id),
        weeklyPayload(BRANCH_ID, week, weekEnd, MANAGER_UID, {
          status: "submitted",
          submittedAt: new Date("2026-04-10T05:00:00Z"),
        })
      );
    });

    // 최초 제출 시각을 바꾸려는 수정은 거부된다
    await assertFails(
      updateDoc(doc(db, "branchWeeklyReports", id), {
        content: "수정본",
        submittedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    // 제출된 보고를 임시저장으로 되돌릴 수 없다
    await assertFails(
      updateDoc(doc(db, "branchWeeklyReports", id), {
        status: "draft",
        updatedAt: serverTimestamp(),
      })
    );
    // 제출 시각을 건드리지 않는 본문 수정은 허용된다
    await assertSucceeds(
      updateDoc(doc(db, "branchWeeklyReports", id), {
        content: "수정본",
        editCount: 1,
        updatedAt: serverTimestamp(),
        updatedBy: MANAGER_UID,
      })
    );
  });

  test("본사(admin)는 전 지점 주간보고를 조회할 수 있다", async () => {
    const db = authedDb(ADMIN_UID);
    await assertSucceeds(getDocs(collection(db, "branchWeeklyReports")));
  });

  test("로그인하지 않으면 접근할 수 없다", async () => {
    const db = unauthDb();
    await assertFails(
      getDoc(doc(db, "branchWeeklyReports", weeklyId(BRANCH_ID, PAST_WEEK)))
    );
    await assertFails(
      setDoc(
        doc(db, "branchWeeklyReports", weeklyId(BRANCH_ID, "2026-05-04")),
        weeklyPayload(BRANCH_ID, "2026-05-04", "2026-05-10", "anonymous")
      )
    );
  });
});
