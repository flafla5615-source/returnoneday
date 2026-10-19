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
