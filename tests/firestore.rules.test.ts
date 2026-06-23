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
    const newReportId = reportId(BRANCH_ID, "2026-06-11");

    await assertSucceeds(
      setDoc(doc(db, "dailyReports", newReportId), {
        id: newReportId,
        branchId: BRANCH_ID,
        reportDate: "2026-06-11",
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

    const otherReportId = reportId(OTHER_BRANCH_ID, "2026-06-11");
    await assertFails(
      setDoc(doc(db, "dailyReports", otherReportId), {
        id: otherReportId,
        branchId: OTHER_BRANCH_ID,
        reportDate: "2026-06-11",
        writerUid: MANAGER_UID,
        status: "draft",
        activeMembers: 200,
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
