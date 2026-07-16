import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as nodemailer from "nodemailer";
import { JWT } from "google-auth-library";
import * as crypto from "crypto";

admin.initializeApp();
const db = admin.firestore();

// ─── Admin account creation ──────────────────────────────────────────────────
type BranchAccountCreationMethod = "temporary_password" | "reset_email";

interface BranchAccountInput {
  branchId?: string;
  branchName?: string;
  email?: string;
}

interface BranchAccountResult {
  branchId: string;
  branchName: string;
  email: string;
  status: "created" | "linked_existing" | "failed";
  uid?: string;
  userDocumentLinked: boolean;
  branchManagerUidsLinked: boolean;
  initialPasswordSet: boolean;
  message?: string;
}

function validPassword(password: string): boolean {
  return password.length >= 8 &&
    /[A-Za-z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password);
}

async function requireAdmin(uid: string | undefined): Promise<void> {
  if (!uid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  const userDoc = await db.doc(`users/${uid}`).get();
  const user = userDoc.data();
  if (!user || user.role !== "admin" || user.status !== "active") {
    throw new HttpsError("permission-denied", "관리자만 사용할 수 있는 기능입니다.");
  }
}

async function getOrCreateBranchAuthUser(params: {
  email: string;
  branchName: string;
  method: BranchAccountCreationMethod;
  password?: string;
}): Promise<{ uid: string; created: boolean; initialPasswordSet: boolean }> {
  try {
    const existing = await admin.auth().getUserByEmail(params.email);
    return { uid: existing.uid, created: false, initialPasswordSet: false };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "auth/user-not-found") throw error;
  }

  const createRequest: admin.auth.CreateRequest = {
    email: params.email,
    displayName: params.branchName,
    emailVerified: false,
    disabled: false,
  };

  if (params.method === "temporary_password" && params.password) {
    createRequest.password = params.password;
  }

  const created = await admin.auth().createUser(createRequest);
  return {
    uid: created.uid,
    created: true,
    initialPasswordSet: params.method === "temporary_password",
  };
}

export const createBranchAccounts = onCall(
  { region: "asia-northeast3", timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    await requireAdmin(request.auth?.uid);

    const method = request.data?.method as BranchAccountCreationMethod | undefined;
    const password = String(request.data?.password ?? "");
    const accounts = (request.data?.accounts ?? []) as BranchAccountInput[];

    if (method !== "temporary_password" && method !== "reset_email") {
      throw new HttpsError("invalid-argument", "계정 생성 방식을 확인해주세요.");
    }
    if (method === "temporary_password" && !validPassword(password)) {
      throw new HttpsError("invalid-argument", "초기 비밀번호 조건을 확인해주세요.");
    }
    if (!Array.isArray(accounts) || accounts.length === 0) {
      throw new HttpsError("invalid-argument", "생성할 계정이 없습니다.");
    }

    const results: BranchAccountResult[] = [];

    for (const account of accounts) {
      const branchId = String(account.branchId ?? "").trim();
      const branchName = String(account.branchName ?? "").trim();
      const email = String(account.email ?? "").trim().toLowerCase();

      if (!branchId || !branchName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        results.push({
          branchId,
          branchName,
          email,
          status: "failed",
          userDocumentLinked: false,
          branchManagerUidsLinked: false,
          initialPasswordSet: false,
          message: "지점명 또는 이메일이 누락되었습니다.",
        });
        continue;
      }

      try {
        const branchRef = db.doc(`branches/${branchId}`);
        const branchDoc = await branchRef.get();
        if (!branchDoc.exists) {
          throw new Error("branch-not-found");
        }

        const authUser = await getOrCreateBranchAuthUser({
          email,
          branchName,
          method,
          password,
        });

        const now = admin.firestore.FieldValue.serverTimestamp();
        const userRef = db.doc(`users/${authUser.uid}`);
        const existingUserProfile = await userRef.get();

        if (existingUserProfile.exists && existingUserProfile.data()?.role === "admin") {
          results.push({
            branchId,
            branchName,
            email,
            status: "failed",
            uid: authUser.uid,
            userDocumentLinked: false,
            branchManagerUidsLinked: false,
            initialPasswordSet: false,
            message: "해당 이메일은 admin 계정입니다. 운영계정으로 사용할 수 없습니다.",
          });
          continue;
        }

        // 비밀번호는 Firestore에 저장하지 않는다. 초기 비밀번호는 admin이 관리하며,
        // branch_manager에게 변경을 강제하지 않으므로 mustChangePassword는 기록하지 않는다.
        if (existingUserProfile.exists) {
          await userRef.update({
            name: branchName,
            email,
            role: "branch_manager",
            status: "active",
            active: true,
            branchIds: admin.firestore.FieldValue.arrayUnion(branchId),
            updatedAt: now,
          });
        } else {
          await userRef.set({
            uid: authUser.uid,
            name: branchName,
            email,
            role: "branch_manager",
            status: "active",
            active: true,
            branchIds: [branchId],
            createdAt: now,
            updatedAt: now,
          });
        }

        await branchRef.update({
          managerUids: admin.firestore.FieldValue.arrayUnion(authUser.uid),
          updatedAt: now,
        });

        await db.doc(`managerInvites/${branchId}`).set(
          {
            name: branchName,
            email,
            branchIds: [branchId],
            status: "active",
            updatedAt: now,
          },
          { merge: true }
        );

        results.push({
          branchId,
          branchName,
          email,
          status: authUser.created ? "created" : "linked_existing",
          uid: authUser.uid,
          userDocumentLinked: true,
          branchManagerUidsLinked: true,
          initialPasswordSet: authUser.initialPasswordSet,
          message: authUser.created
            ? "신규 Auth 계정을 생성했습니다."
            : "기존 Auth 계정에 지점 권한을 연결했습니다.",
        });
      } catch (error) {
        console.error("[createBranchAccounts] failed", { branchId, email, error });
        results.push({
          branchId,
          branchName,
          email,
          status: "failed",
          userDocumentLinked: false,
          branchManagerUidsLinked: false,
          initialPasswordSet: false,
          message: "계정 생성 중 오류가 발생했습니다.",
        });
      }
    }

    return { results };
  }
);

// ─── 지점 운영계정 비밀번호 변경 (admin 전용) ────────────────────────────────
// 비밀번호는 Firestore에 저장하지 않고 Firebase Auth에만 반영한다.
// console/오류 메시지/응답 어디에도 비밀번호 원문을 남기지 않는다.

export const setBranchAccountPassword = onCall(
  { region: "asia-northeast3", timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    // 1~4. 호출자 인증 + admin + active 확인
    await requireAdmin(request.auth?.uid);

    const targetUid =
      typeof request.data?.targetUid === "string" ? request.data.targetUid.trim() : "";
    const email =
      typeof request.data?.email === "string"
        ? request.data.email.trim().toLowerCase()
        : "";
    const newPassword = String(request.data?.newPassword ?? "");

    if (!targetUid && !email) {
      throw new HttpsError("invalid-argument", "대상 계정을 지정해주세요.");
    }
    if (!validPassword(newPassword)) {
      throw new HttpsError("invalid-argument", "비밀번호 조건을 확인해주세요.");
    }

    // 5. targetUid 우선 사용, email도 함께 왔으면 일치 여부를 명확히 검증
    let authUser: admin.auth.UserRecord;
    try {
      if (targetUid) {
        authUser = await admin.auth().getUser(targetUid);
        if (email && authUser.email?.toLowerCase() !== email) {
          throw new HttpsError(
            "invalid-argument",
            "targetUid와 email이 서로 다른 계정을 가리킵니다."
          );
        }
      } else {
        authUser = await admin.auth().getUserByEmail(email);
      }
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      const code = (error as { code?: string }).code;
      if (code === "auth/user-not-found") {
        throw new HttpsError("not-found", "대상 계정을 찾을 수 없습니다.");
      }
      console.error("[setBranchAccountPassword] lookup failed", { targetUid, email, code });
      throw new HttpsError("internal", "대상 계정 조회 중 오류가 발생했습니다.");
    }

    // 6~8. 대상 users 문서 확인 — branch_manager만 허용, admin 계정은 제외
    const targetUserRef = db.doc(`users/${authUser.uid}`);
    const targetUserSnap = await targetUserRef.get();
    const targetUser = targetUserSnap.data();

    if (!targetUserSnap.exists || !targetUser) {
      throw new HttpsError("not-found", "대상 계정 정보를 찾을 수 없습니다.");
    }
    if (targetUser.role === "admin") {
      throw new HttpsError("failed-precondition", "관리자 계정은 이 기능으로 변경할 수 없습니다.");
    }
    if (targetUser.role !== "branch_manager") {
      throw new HttpsError("failed-precondition", "지점 운영계정만 변경할 수 있습니다.");
    }

    // 10. Firebase Admin SDK로 비밀번호 변경 (Firestore에는 기록하지 않음)
    try {
      await admin.auth().updateUser(authUser.uid, { password: newPassword });
    } catch {
      console.error("[setBranchAccountPassword] updateUser failed", { uid: authUser.uid });
      throw new HttpsError("internal", "비밀번호 변경 중 오류가 발생했습니다.");
    }

    return { success: true, uid: authUser.uid };
  }
);

// ─── 트레이너 명단 구글시트 불러오기 미리보기 (admin 전용) ──────────────────────
// 이 단계에서는 Firestore trainers 컬렉션에 아무것도 쓰지 않는다 — 읽기 전용 미리보기.
// 주민번호·계좌번호·급여 등 민감 컬럼은 애초에 요청하지 않는다: 헤더 행에서
// 필요한 5개 컬럼(이름/지점명/직급/연락처/현재 상태)의 위치만 찾아 그 열만
// 개별적으로 조회하므로, 시트에 다른 민감 컬럼이 있어도 서버로 전달되지 않는다.

const GOOGLE_SHEETS_SPREADSHEET_ID = defineSecret("GOOGLE_SHEETS_SPREADSHEET_ID");
const GOOGLE_SERVICE_ACCOUNT_EMAIL = defineSecret("GOOGLE_SERVICE_ACCOUNT_EMAIL");
const GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = defineSecret("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");

const TRAINER_SHEET_NAME = "인력 현황";
const TR_JOB_TITLES = ["프로TR", "시니어TR", "파트TR", "주니어TR"];
const SHEETS_COLUMN_HEADERS = {
  name: "이름",
  branch: "지점명",
  job: "직급",
  phone: "연락처",
  status: "현재 상태",
} as const;

interface TrainerImportRow {
  sourceRow: number;
  originalName: string;
  normalizedName: string;
  branchName: string;
  jobTitle: string;
  phoneLast4: string;
  status: string;
}

class SheetsImportError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

// 0-based 열 인덱스 → A1 표기 열 문자 (0→A, 25→Z, 26→AA ...)
function columnLetter(index: number): string {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

// 이름 끝의 "1" 또는 "2" 한 글자만 제거한다 (김동현1 → 김동현). 자동 병합에는 사용하지 않고
// 화면에 정리된 이름 후보로만 표시한다.
function normalizeTrainerName(name: string): string {
  return name.trim().replace(/([12])$/, "").trim();
}

function extractPhoneLast4(raw: string): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.slice(-4);
}

async function fetchSheetsAccessToken(email: string, privateKey: string): Promise<string> {
  const client = new JWT({
    email,
    key: privateKey.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  try {
    const token = await client.getAccessToken();
    if (!token.token) throw new SheetsImportError("invalid-credentials", "no-access-token");
    return token.token;
  } catch (error) {
    if (error instanceof SheetsImportError) throw error;
    // 서비스 계정 이메일/개인키 형식이 잘못됐거나 계정 자체가 유효하지 않은 경우
    console.error("[previewTrainerImport] JWT auth failed", (error as Error).message);
    throw new SheetsImportError("invalid-credentials", (error as Error).message);
  }
}

// 403 응답 본문으로 "API 자체가 비활성화"인지 "시트가 서비스 계정에 공유되지 않음"인지 구분한다.
async function classify403(res: Response): Promise<SheetsImportError> {
  const bodyText = await res.text().catch(() => "");
  if (/has not been used in project|SERVICE_DISABLED|is disabled/i.test(bodyText)) {
    return new SheetsImportError("sheets-api-disabled", "sheets api disabled");
  }
  return new SheetsImportError("sheets-access-denied", "access denied");
}

async function sheetsValuesGet(
  spreadsheetId: string,
  range: string,
  accessToken: string
): Promise<string[][]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    if (res.status === 403) throw await classify403(res);
    if (res.status === 404 || res.status === 400) {
      throw new SheetsImportError("sheet-not-found", "sheet/range not found");
    }
    throw new SheetsImportError("sheets-fetch-failed", `http ${res.status}`);
  }
  const body = (await res.json()) as { values?: string[][] };
  return body.values ?? [];
}

async function sheetsValuesBatchGet(
  spreadsheetId: string,
  ranges: string[],
  accessToken: string
): Promise<string[][][]> {
  const query = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join("&");
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}/values:batchGet?${query}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    if (res.status === 403) throw await classify403(res);
    if (res.status === 404 || res.status === 400) {
      throw new SheetsImportError("sheet-not-found", "sheet/range not found");
    }
    throw new SheetsImportError("sheets-fetch-failed", `http ${res.status}`);
  }
  const body = (await res.json()) as { valueRanges?: { values?: string[][] }[] };
  return (body.valueRanges ?? []).map((vr) => vr.values ?? []);
}

export const previewTrainerImport = onCall(
  {
    region: "asia-northeast3",
    timeoutSeconds: 60,
    memory: "256MiB",
    secrets: [
      GOOGLE_SHEETS_SPREADSHEET_ID,
      GOOGLE_SERVICE_ACCOUNT_EMAIL,
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    ],
  },
  async (request): Promise<{ rows: TrainerImportRow[] }> => {
    await requireAdmin(request.auth?.uid);

    const spreadsheetId = GOOGLE_SHEETS_SPREADSHEET_ID.value();
    const serviceAccountEmail = GOOGLE_SERVICE_ACCOUNT_EMAIL.value();
    const serviceAccountPrivateKey = GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.value();

    if (!spreadsheetId || !serviceAccountEmail || !serviceAccountPrivateKey) {
      throw new HttpsError("failed-precondition", "sheets-not-configured");
    }

    try {
      const accessToken = await fetchSheetsAccessToken(
        serviceAccountEmail,
        serviceAccountPrivateKey
      );

      // 1) 헤더 행만 조회해 필요한 컬럼의 위치를 찾는다.
      const headerRows = await sheetsValuesGet(
        spreadsheetId,
        `${TRAINER_SHEET_NAME}!1:1`,
        accessToken
      );
      const header = headerRows[0] ?? [];
      const colIndex = {
        name: header.indexOf(SHEETS_COLUMN_HEADERS.name),
        branch: header.indexOf(SHEETS_COLUMN_HEADERS.branch),
        job: header.indexOf(SHEETS_COLUMN_HEADERS.job),
        phone: header.indexOf(SHEETS_COLUMN_HEADERS.phone),
        status: header.indexOf(SHEETS_COLUMN_HEADERS.status),
      };
      if (
        colIndex.name < 0 ||
        colIndex.branch < 0 ||
        colIndex.job < 0 ||
        colIndex.phone < 0 ||
        colIndex.status < 0
      ) {
        throw new SheetsImportError("columns-not-found", "required columns missing");
      }

      // 2) 필요한 5개 컬럼만 개별 조회한다 — 다른(민감) 컬럼은 요청 자체를 하지 않는다.
      const ranges = [
        `${TRAINER_SHEET_NAME}!${columnLetter(colIndex.name)}:${columnLetter(colIndex.name)}`,
        `${TRAINER_SHEET_NAME}!${columnLetter(colIndex.branch)}:${columnLetter(colIndex.branch)}`,
        `${TRAINER_SHEET_NAME}!${columnLetter(colIndex.job)}:${columnLetter(colIndex.job)}`,
        `${TRAINER_SHEET_NAME}!${columnLetter(colIndex.phone)}:${columnLetter(colIndex.phone)}`,
        `${TRAINER_SHEET_NAME}!${columnLetter(colIndex.status)}:${columnLetter(colIndex.status)}`,
      ];
      const [nameCol, branchCol, jobCol, phoneCol, statusCol] = await sheetsValuesBatchGet(
        spreadsheetId,
        ranges,
        accessToken
      );

      const rowCount = Math.max(
        nameCol.length,
        branchCol.length,
        jobCol.length,
        phoneCol.length,
        statusCol.length
      );

      const cellAt = (col: string[][], i: number) => (col[i]?.[0] ?? "").toString().trim();

      const results: TrainerImportRow[] = [];
      // i = 0은 헤더 행이므로 1부터 시작
      for (let i = 1; i < rowCount; i++) {
        const jobTitle = cellAt(jobCol, i);
        if (!TR_JOB_TITLES.includes(jobTitle)) continue; // FC/청소/알바/매니저/TR 아닌 팀장 등은 애초에 대상이 아님

        const originalName = cellAt(nameCol, i);
        if (!originalName) continue;

        results.push({
          sourceRow: i + 1,
          originalName,
          normalizedName: normalizeTrainerName(originalName),
          branchName: cellAt(branchCol, i),
          jobTitle,
          phoneLast4: extractPhoneLast4(cellAt(phoneCol, i)),
          status: cellAt(statusCol, i),
        });
      }

      if (results.length === 0) {
        throw new SheetsImportError("no-data", "no TR rows found");
      }

      return { rows: results };
    } catch (error) {
      if (error instanceof SheetsImportError) {
        // 원인별 코드는 서버 로그에만 남기고, 클라이언트에는 안전한 코드 토큰만 전달한다
        // (비밀키 원문·전체 스택은 절대 message에 담지 않는다).
        console.error("[previewTrainerImport] failed", error.code, error.message);
        const httpsCode: Record<string, "permission-denied" | "not-found" | "failed-precondition" | "internal"> = {
          "sheets-access-denied": "permission-denied",
          "sheet-not-found": "not-found",
          "no-data": "not-found",
          "columns-not-found": "failed-precondition",
          "sheets-api-disabled": "failed-precondition",
          "invalid-credentials": "failed-precondition",
        };
        throw new HttpsError(httpsCode[error.code] ?? "internal", error.code);
      }
      console.error("[previewTrainerImport] unexpected error", (error as Error).message);
      throw new HttpsError("internal", "sheets-fetch-failed");
    }
  }
);

// ─── 트레이너 명단 수기 일괄 등록 — 최종 승인 처리 (admin 전용) ─────────────────
// 구글시트 연동과 무관한 별도 경로. 미리보기·중복 확인은 클라이언트에서 계산하지만,
// 실제 Firestore 쓰기는 반드시 이 함수를 통해서만 일어난다. 클라이언트가 보낸 결정을
// 그대로 신뢰하지 않고, 서버가 기존 trainers 컬렉션을 다시 조회해 독립적으로 재검증한다.
// 이름 유사도로 자동 병합하지 않는다 — 확정된 예외는 "김동현_2" → "김동현" 단 하나뿐이다.

const TRAINER_NAME_ALIASES: Record<string, string> = {
  "김동현_2": "김동현",
};

function normalizeRosterName(raw: string): string {
  const trimmed = raw.trim();
  return TRAINER_NAME_ALIASES[trimmed] ?? trimmed;
}

type RosterImportAction = "use_existing" | "create_new" | "merge" | "exclude";

interface RosterImportDecisionInput {
  finalName?: string;
  action?: RosterImportAction;
  matchedTrainerId?: string;
  mergeKeepTrainerId?: string;
  mergeFromTrainerIds?: string[];
}

interface RosterImportItemResult {
  finalName: string;
  action: string;
  status: "success" | "skipped" | "failed";
  trainerId?: string;
  message?: string;
}

// trainerSessions는 최대 500건 batch 제약이 있어 400건씩 나눠 처리한다.
async function reassignTrainerSessions(
  fromTrainerId: string,
  toTrainerId: string,
  finalName: string
): Promise<number> {
  const snap = await db
    .collection("trainerSessions")
    .where("trainerId", "==", fromTrainerId)
    .get();

  const docs = snap.docs;
  let moved = 0;
  for (let i = 0; i < docs.length; i += 400) {
    const chunk = docs.slice(i, i + 400);
    const batch = db.batch();
    chunk.forEach((d) => {
      batch.update(d.ref, {
        trainerId: toTrainerId,
        trainerName: finalName,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
    moved += chunk.length;
  }
  return moved;
}

export const commitTrainerRosterImport = onCall(
  { region: "asia-northeast3", timeoutSeconds: 300, memory: "256MiB" },
  async (
    request
  ): Promise<{ batchId: string; alreadyProcessed: boolean; results: RosterImportItemResult[] }> => {
    await requireAdmin(request.auth?.uid);
    const adminUid = request.auth!.uid;

    const rawText = String(request.data?.rawText ?? "");
    const decisionsInput = (request.data?.decisions ?? []) as RosterImportDecisionInput[];

    if (!rawText.trim()) {
      throw new HttpsError("invalid-argument", "명단이 비어 있습니다.");
    }
    if (!Array.isArray(decisionsInput) || decisionsInput.length === 0) {
      throw new HttpsError("invalid-argument", "등록 대상이 없습니다.");
    }

    // 같은 명단(원본 텍스트) 재승인은 fingerprint로 차단한다 — 중복 생성 방지.
    const fingerprint = crypto.createHash("sha256").update(rawText.trim()).digest("hex");
    const batchRef = db.doc(`trainerImportBatches/${fingerprint}`);
    const existingBatch = await batchRef.get();
    if (existingBatch.exists) {
      return {
        batchId: fingerprint,
        alreadyProcessed: true,
        results: (existingBatch.data()?.results ?? []) as RosterImportItemResult[],
      };
    }

    // 서버가 독립적으로 기존 트레이너 전체를 다시 조회해 재검증한다.
    const existingSnap = await db.collection("trainers").get();
    const existingByName = new Map<string, string[]>(); // name -> trainerId[]
    existingSnap.docs.forEach((d) => {
      const name = (d.data().name as string) ?? "";
      const arr = existingByName.get(name) ?? [];
      arr.push(d.id);
      existingByName.set(name, arr);
    });

    const now = admin.firestore.FieldValue.serverTimestamp();
    const results: RosterImportItemResult[] = [];

    for (const decision of decisionsInput) {
      const finalName = normalizeRosterName(String(decision.finalName ?? ""));
      const action = decision.action;

      if (!finalName || !action) {
        results.push({ finalName: finalName || "(빈 이름)", action: "unknown", status: "failed", message: "잘못된 요청입니다." });
        continue;
      }

      try {
        if (action === "exclude") {
          results.push({ finalName, action, status: "skipped" });
          continue;
        }

        if (action === "create_new") {
          // 재검증: 그 사이 동일 이름이 이미 생겼으면 신규 생성을 취소하고 기존 사용으로 전환한다.
          const already = existingByName.get(finalName) ?? [];
          if (already.length === 1) {
            results.push({
              finalName,
              action: "use_existing",
              status: "success",
              trainerId: already[0],
              message: "서버 재검증 중 이미 존재하는 이름으로 확인되어 기존 트레이너를 사용했습니다.",
            });
            continue;
          }
          if (already.length > 1) {
            results.push({ finalName, action, status: "failed", message: "동일 이름이 여러 명 존재해 자동 생성을 건너뛰었습니다." });
            continue;
          }
          const ref = await db.collection("trainers").add({
            name: finalName,
            active: true,
            identifierMemo: "본사 확정 명단 일괄 등록",
            createdBy: adminUid,
            createdAt: now,
            updatedAt: now,
          });
          existingByName.set(finalName, [ref.id]);
          results.push({ finalName, action, status: "success", trainerId: ref.id });
          continue;
        }

        if (action === "use_existing") {
          const targetId = decision.matchedTrainerId;
          if (!targetId) {
            results.push({ finalName, action, status: "failed", message: "연결할 트레이너가 지정되지 않았습니다." });
            continue;
          }
          const targetRef = db.doc(`trainers/${targetId}`);
          const targetSnap = await targetRef.get();
          if (!targetSnap.exists) {
            results.push({ finalName, action, status: "failed", message: "대상 트레이너를 찾을 수 없습니다." });
            continue;
          }
          if ((targetSnap.data()?.name as string) !== finalName) {
            await targetRef.update({ name: finalName, updatedAt: now });
          }
          results.push({ finalName, action, status: "success", trainerId: targetId });
          continue;
        }

        if (action === "merge") {
          const keepId = decision.mergeKeepTrainerId;
          const fromIds = (decision.mergeFromTrainerIds ?? []).filter((id) => id && id !== keepId);
          if (!keepId || fromIds.length === 0) {
            results.push({ finalName, action, status: "failed", message: "통합 대상이 올바르지 않습니다." });
            continue;
          }
          const keepSnap = await db.doc(`trainers/${keepId}`).get();
          if (!keepSnap.exists) {
            results.push({ finalName, action, status: "failed", message: "유지할 트레이너를 찾을 수 없습니다." });
            continue;
          }

          let totalMoved = 0;
          for (const fromId of fromIds) {
            const fromRef = db.doc(`trainers/${fromId}`);
            const fromSnap = await fromRef.get();
            if (!fromSnap.exists) continue;

            const moved = await reassignTrainerSessions(fromId, keepId, finalName);
            totalMoved += moved;

            const prevMemo = (fromSnap.data()?.identifierMemo as string) ?? "";
            const mergeNote = `${finalName}(${keepId})로 통합됨 ${new Date().toISOString().slice(0, 10)}`;
            await fromRef.update({
              active: false,
              identifierMemo: prevMemo ? `${prevMemo} / ${mergeNote}` : mergeNote,
              updatedAt: now,
            });
          }

          await db.doc(`trainers/${keepId}`).update({ name: finalName, active: true, updatedAt: now });

          results.push({
            finalName,
            action,
            status: "success",
            trainerId: keepId,
            message: `세션 ${totalMoved}건 이전 완료`,
          });
          continue;
        }

        results.push({ finalName, action, status: "failed", message: "알 수 없는 처리 방식입니다." });
      } catch (error) {
        console.error("[commitTrainerRosterImport] item failed", finalName, (error as Error).message);
        results.push({ finalName, action, status: "failed", message: "처리 중 오류가 발생했습니다." });
      }
    }

    await batchRef.set({
      fingerprint,
      createdBy: adminUid,
      createdAt: now,
      results,
    });

    return { batchId: fingerprint, alreadyProcessed: false, results };
  }
);

// ─── KakaoTalk i-builder v2 types ─────────────────────────────────────────────
interface KakaoRequestBody {
  userRequest?: { utterance?: string };
}
interface KakaoResponse {
  version: "2.0";
  template: { outputs: Array<{ simpleText: { text: string } }> };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function simpleText(text: string): KakaoResponse {
  return { version: "2.0", template: { outputs: [{ simpleText: { text } }] } };
}

function nowKST(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function todayKST(): string {
  return nowKST().toISOString().slice(0, 10);
}

function yesterdayKST(): string {
  const d = nowKST();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function fmt(v: number | null | undefined, unit: string): string {
  return v !== null && v !== undefined ? `${v}${unit}` : "-";
}

function ptRate(c: number | null | undefined, r: number | null | undefined): string {
  if (!c || !r) return "-";
  return `${Math.round((r / c) * 100)}%`;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "작성 중",
  submitted: "제출 완료 ✅",
  revision_required: "수정 요청 ⚠️",
  locked: "잠금 🔒",
};

const SEVERITY_LABEL: Record<string, string> = {
  low: "낮음", medium: "중간", high: "높음", critical: "긴급 🚨",
};

const ISSUE_TYPE_LABEL: Record<string, string> = {
  claim: "클레임", staff: "인력", facility: "시설",
};

// ─── Intent detection ─────────────────────────────────────────────────────────
type Intent =
  | "help"
  | "allSummary"
  | "reportStatus"
  | "campaigns"
  | "trend"
  | "issues"
  | "tm"
  | "yesterday"
  | "today";

function detectIntent(u: string): Intent {
  const s = u.toLowerCase().replace(/\s/g, "");
  if (/(도움말|사용법|명령어|help)/.test(s)) return "help";
  if (/(전체현황|전체요약|전지점요약|모든지점|전지점)/.test(s)) return "allSummary";
  if (/(보고현황|제출현황|오늘보고현황|보고상태)/.test(s)) return "reportStatus";
  if (/(추이|트렌드|7일|주간)/.test(s)) return "trend";
  if (/(이슈|클레임)/.test(s)) return "issues";
  if (/(tm|티엠)/.test(s)) return "tm";
  if (/캠페인/.test(s)) return "campaigns";
  if (/어제/.test(s)) return "yesterday";
  return "today";
}

// ─── Branch matching ──────────────────────────────────────────────────────────
type BranchDoc = admin.firestore.QueryDocumentSnapshot;

function matchBranch(docs: BranchDoc[], query: string): BranchDoc | null {
  const q = query.trim();
  if (!q) return null;
  const exact = docs.find((d) => (d.data().name as string) === q);
  if (exact) return exact;
  const partial = docs
    .filter((d) => {
      const name = d.data().name as string;
      return name.includes(q) || q.includes(name);
    })
    .sort((a, b) => (b.data().name as string).length - (a.data().name as string).length);
  return partial[0] ?? null;
}

function extractBranchQuery(utterance: string): string {
  return utterance
    .replace(/(대시보드|현황|보고서|오늘|어제|실적|조회|알려줘|보여줘|추이|트렌드|7일|주간|이슈|클레임|TM|tm|티엠|캠페인)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Firestore data types ─────────────────────────────────────────────────────
interface TmBreakdown {
  phone: number;
  sms: number;
  kakao: number;
  other: number;
}

interface ReportData {
  branchId: string;
  reportDate: string;
  status: string;
  activeMembers: number | null;
  inquiries: number | null;
  ptConsultations: number | null;
  ptRegistrations: number | null;
  reRegistrations: number | null;
  comebackMembers: number | null;
  happyCalls: number | null;
  expiringTm?: TmBreakdown;
  expiringTmTotal?: number;
  unregisteredTm?: TmBreakdown;
  unregisteredTmTotal?: number;
  offlinePromotionTotal?: number;
}

// ─── Shared dashboard formatter ───────────────────────────────────────────────
function formatDashboard(branchName: string, report: ReportData, dayLabel?: string): string {
  const today = todayKST();
  const dateLabel = dayLabel ?? (report.reportDate === today ? "오늘" : report.reportDate);
  const status = STATUS_LABEL[report.status] ?? report.status;
  const tmTotal = (report.expiringTmTotal ?? 0) + (report.unregisteredTmTotal ?? 0);
  const promoTotal = report.offlinePromotionTotal ?? 0;

  const lines = [
    `📊 ${branchName} ${dateLabel} 실적`,
    `📅 ${report.reportDate} · ${status}`,
    ``,
    `👥 유효회원  ${fmt(report.activeMembers, "명")}`,
    `📋 문의      ${fmt(report.inquiries, "건")}`,
    `💬 PT 상담   ${fmt(report.ptConsultations, "건")}`,
    `✍️ PT 등록   ${fmt(report.ptRegistrations, "건")}`,
    `📈 전환율    ${ptRate(report.ptConsultations, report.ptRegistrations)}`,
    `🔄 재등록    ${fmt(report.reRegistrations, "명")}`,
    `🏃 컴백      ${fmt(report.comebackMembers, "명")}`,
    `📞 해피콜    ${fmt(report.happyCalls, "건")}`,
  ];
  if (tmTotal > 0) lines.push(``, `📱 TM 총합   ${tmTotal}건`);
  if (promoTotal > 0) lines.push(`📣 홍보 총합 ${promoTotal}개`);
  return lines.join("\n");
}

// ─── Handler: 도움말 ─────────────────────────────────────────────────────────
function handleHelp(): string {
  return [
    `📱 리턴라이프 챗봇 사용법`,
    ``,
    `🔹 오늘 대시보드`,
    `   {지점명} 대시보드`,
    `   예) 어반요가 대시보드`,
    ``,
    `🔹 어제 실적`,
    `   {지점명} 어제`,
    `   예) 어반요가 어제`,
    ``,
    `🔹 7일 추이`,
    `   {지점명} 추이`,
    `   예) 어반요가 추이`,
    ``,
    `🔹 TM 상세 현황`,
    `   {지점명} TM`,
    `   예) 어반요가 TM`,
    ``,
    `🔹 운영 이슈 조회`,
    `   {지점명} 이슈`,
    `   예) 어반요가 이슈`,
    ``,
    `🔹 전 지점 오늘 요약`,
    `   전체 현황`,
    ``,
    `🔹 보고 제출 현황`,
    `   보고 현황`,
    ``,
    `🔹 캠페인 현황`,
    `   캠페인 현황`,
    `   {지점명} 캠페인`,
    ``,
    `🔹 이 도움말`,
    `   도움말`,
  ].join("\n");
}

// ─── Handler: 전 지점 보고 현황 ──────────────────────────────────────────────
async function handleReportStatus(): Promise<string> {
  const today = todayKST();
  const branchesSnap = await db.collection("branches").where("active", "==", true).get();
  if (branchesSnap.empty) return "등록된 활성 지점이 없습니다.";

  const branches = branchesSnap.docs;
  const refs = branches.map((b) => db.doc(`dailyReports/${b.id}_${today}`));
  const reportDocs = await db.getAll(...refs);

  const done: string[] = [];
  const inProgress: string[] = [];
  const none: string[] = [];

  branches.forEach((b, i) => {
    const name = b.data().name as string;
    const rd = reportDocs[i];
    const st = rd.exists ? (rd.data()?.status as string) : null;
    if (st === "submitted" || st === "locked") {
      done.push(`✅ ${name}`);
    } else if (st === "draft" || st === "revision_required") {
      inProgress.push(`🔄 ${name} (${STATUS_LABEL[st] ?? st})`);
    } else {
      none.push(`❌ ${name}`);
    }
  });

  const lines = [
    `📋 ${today} 보고 제출 현황`,
    ``,
    ...done,
    ...inProgress,
    ...none,
    ``,
    `제출 완료 ${done.length}  /  전체 ${branches.length}개 지점`,
  ];
  return lines.join("\n");
}

// ─── Handler: 전 지점 오늘 요약 ──────────────────────────────────────────────
async function handleAllSummary(): Promise<string> {
  const today = todayKST();
  const branchesSnap = await db.collection("branches").where("active", "==", true).get();
  if (branchesSnap.empty) return "등록된 활성 지점이 없습니다.";

  const branches = branchesSnap.docs;
  const refs = branches.map((b) => db.doc(`dailyReports/${b.id}_${today}`));
  const reportDocs = await db.getAll(...refs);

  const lines = [`🏢 전 지점 오늘 요약`, `📅 ${today} 기준`, ``];

  branches.forEach((b, i) => {
    const name = b.data().name as string;
    const rd = reportDocs[i];
    if (rd.exists) {
      const r = rd.data() as ReportData;
      const icon = r.status === "submitted" ? "✅" : r.status === "draft" ? "🔄" : "⚠️";
      const members = r.activeMembers !== null ? `${r.activeMembers}명` : "-";
      const conv = ptRate(r.ptConsultations, r.ptRegistrations);
      lines.push(`${icon} ${name}`);
      lines.push(`   유효 ${members} · 전환율 ${conv}`);
    } else {
      lines.push(`❌ ${name}`);
      lines.push(`   미제출`);
    }
  });

  return lines.join("\n");
}

// ─── Handler: 7일 추이 ───────────────────────────────────────────────────────
async function handleTrend(branchId: string, branchName: string): Promise<string> {
  const snap = await db.collection("dailyReports")
    .where("branchId", "==", branchId)
    .orderBy("reportDate", "desc")
    .limit(7)
    .get();

  if (snap.empty) return `${branchName}\n\n최근 7일 보고 데이터가 없습니다.`;

  const lines = [`📈 ${branchName} 7일 추이`, ``];

  snap.docs
    .slice()
    .reverse()
    .forEach((d) => {
      const r = d.data() as ReportData;
      const date = r.reportDate.slice(5);
      const members = r.activeMembers !== null ? `${r.activeMembers}명` : " -  ";
      const conv = ptRate(r.ptConsultations, r.ptRegistrations);
      const icon = r.status === "submitted" ? "✅" : r.status === "draft" ? "🔄" : "❌";
      lines.push(`${icon} ${date}  유효 ${members} · 전환율 ${conv}`);
    });

  return lines.join("\n");
}

// ─── Handler: 운영 이슈 조회 ─────────────────────────────────────────────────
async function handleIssues(branchId: string, branchName: string): Promise<string> {
  const snap = await db.collection("issues").where("branchId", "==", branchId).get();
  const open = snap.docs.filter((d) =>
    ["open", "in_progress"].includes(d.data().status as string)
  );

  const lines = [`⚠️ ${branchName} 운영 이슈`, ``];

  if (open.length === 0) {
    lines.push("현재 미해결 이슈가 없습니다 👍");
    return lines.join("\n");
  }

  open.forEach((d) => {
    const iss = d.data();
    const type = ISSUE_TYPE_LABEL[iss.type as string] ?? (iss.type as string);
    const sev = SEVERITY_LABEL[iss.severity as string] ?? (iss.severity as string);
    const st = iss.status === "in_progress" ? "처리 중" : "미해결";
    lines.push(`[${type} · ${sev} · ${st}]`);
    lines.push(`${iss.description as string}`);
    if (iss.category) lines.push(`카테고리: ${iss.category as string}`);
    lines.push(``);
  });

  return lines.join("\n").trimEnd();
}

// ─── Handler: TM 상세 현황 ───────────────────────────────────────────────────
async function handleTm(branchId: string, branchName: string): Promise<string> {
  const today = todayKST();
  const doc = await db.doc(`dailyReports/${branchId}_${today}`).get();

  if (!doc.exists) return `${branchName}\n\n오늘 보고서가 없습니다.`;

  const r = doc.data() as ReportData;
  const et = r.expiringTm;
  const ut = r.unregisteredTm;

  const lines = [`📱 ${branchName} TM 현황`, `📅 ${today} 기준`, ``];

  if (et) {
    const sub = et.phone + et.sms + et.kakao + et.other;
    lines.push(`─ 만료·홀드 TM ─`);
    lines.push(`  전화   ${et.phone}건`);
    lines.push(`  문자   ${et.sms}건`);
    lines.push(`  카카오 ${et.kakao}건`);
    lines.push(`  기타   ${et.other}건`);
    lines.push(`  소계   ${sub}건`);
    lines.push(``);
  }

  if (ut) {
    const sub = ut.phone + ut.sms + ut.kakao + ut.other;
    lines.push(`─ 미등록 TM ─`);
    lines.push(`  전화   ${ut.phone}건`);
    lines.push(`  문자   ${ut.sms}건`);
    lines.push(`  카카오 ${ut.kakao}건`);
    lines.push(`  기타   ${ut.other}건`);
    lines.push(`  소계   ${sub}건`);
    lines.push(``);
  }

  if (!et && !ut) {
    lines.push("오늘 TM 데이터가 없습니다.");
    return lines.join("\n");
  }

  const total = (r.expiringTmTotal ?? 0) + (r.unregisteredTmTotal ?? 0);
  lines.push(`전체 TM 합계: ${total}건`);
  return lines.join("\n");
}

// ─── Handler: 캠페인 현황 ────────────────────────────────────────────────────
async function handleCampaigns(branchId?: string, branchName?: string): Promise<string> {
  const baseQuery = db.collection("campaigns").where("status", "==", "active");
  const snap = await baseQuery.get();

  // branchId 필드가 있는 경우 클라이언트 필터링
  let docs = snap.docs;
  if (branchId) {
    const filtered = docs.filter((d) => (d.data().branchId as string | undefined) === branchId);
    if (filtered.length > 0) docs = filtered;
  }

  const prefix = branchName ? `${branchName} ` : "";
  const lines = [`📣 ${prefix}캠페인 현황`, ``];

  if (docs.length === 0) {
    lines.push("현재 진행 중인 캠페인이 없습니다.");
    return lines.join("\n");
  }

  docs.forEach((d) => {
    const c = d.data();
    lines.push(`▶ ${c.name as string}`);
    lines.push(`  기간: ${c.startDate as string} ~ ${c.endDate as string}`);
    lines.push(``);
  });

  return lines.join("\n").trimEnd();
}

// ─── Scheduled: 미제출 지점 이메일 알림 (매일 21:00 KST = 12:00 UTC) ────────
export const dailyMissingReportAlert = onSchedule(
  { schedule: "0 12 * * *", timeZone: "Asia/Seoul", region: "asia-northeast3", timeoutSeconds: 30, memory: "256MiB" },
  async () => {
    const today = todayKST();
    const branchesSnap = await db.collection("branches").where("active", "==", true).get();
    if (branchesSnap.empty) return;

    const branches = branchesSnap.docs;
    const refs = branches.map((b) => db.doc(`dailyReports/${b.id}_${today}`));
    const reportDocs = await db.getAll(...refs);

    const missing: string[] = [];
    branches.forEach((b, i) => {
      const rd = reportDocs[i];
      const status = rd.exists ? (rd.data()?.status as string) : null;
      if (!status || status === "draft" || status === "revision_required") {
        const label = !status ? "미제출" : status === "draft" ? "작성 중" : "수정 요청";
        missing.push(`• ${b.data().name as string} (${label})`);
      }
    });

    if (missing.length === 0) return;

    const adminEmail = process.env.ADMIN_EMAIL;
    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_PASS;

    if (!adminEmail || !gmailUser || !gmailPass) {
      console.warn("이메일 환경변수 미설정 — ADMIN_EMAIL, GMAIL_USER, GMAIL_PASS 확인");
      return;
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailPass },
    });

    const subject = `[RETURN LIFE] ${today} 보고 미제출 알림 — ${missing.length}개 지점`;
    const text = [
      `오늘(${today}) 오후 9시 기준 미제출 또는 미완료 지점입니다.`,
      ``,
      ...missing,
      ``,
      `관리자 대시보드: https://returnlife-five.vercel.app/admin`,
    ].join("\n");

    await transporter.sendMail({ from: gmailUser, to: adminEmail, subject, text });
    console.log(`알림 이메일 발송 완료 → ${adminEmail} (${missing.length}개 지점)`);
  }
);

// ─── Main Cloud Function ──────────────────────────────────────────────────────
export const kakaoDashboard = onRequest(
  { region: "asia-northeast3", timeoutSeconds: 15, memory: "256MiB" },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json(simpleText("지원하지 않는 요청 방식입니다."));
      return;
    }

    const body = req.body as KakaoRequestBody;
    const utterance = (body?.userRequest?.utterance ?? "").trim();
    const intent = detectIntent(utterance);

    // ── Global intents (지점명 불필요) ────────────────────────────────────────
    if (intent === "help") {
      res.json(simpleText(handleHelp()));
      return;
    }
    if (intent === "reportStatus") {
      res.json(simpleText(await handleReportStatus()));
      return;
    }
    if (intent === "allSummary") {
      res.json(simpleText(await handleAllSummary()));
      return;
    }

    // ── Campaigns: 지점명 있으면 필터, 없으면 전체 ───────────────────────────
    if (intent === "campaigns") {
      const q = extractBranchQuery(utterance);
      if (q) {
        const bSnap = await db.collection("branches").where("active", "==", true).get();
        const m = matchBranch(bSnap.docs, q);
        res.json(simpleText(await handleCampaigns(m?.id, m?.data().name as string | undefined)));
      } else {
        res.json(simpleText(await handleCampaigns()));
      }
      return;
    }

    // ── Branch-specific intents ───────────────────────────────────────────────
    const branchQuery = extractBranchQuery(utterance);

    const intentHint: Record<string, string> = {
      yesterday: "어제", trend: "추이", issues: "이슈", tm: "TM",
    };

    if (!branchQuery) {
      const example = intentHint[intent] ?? "대시보드";
      res.json(simpleText(
        `지점명을 함께 입력해주세요.\n예) 어반요가 ${example}\n\n"도움말" 을 입력하면 전체 명령어를 볼 수 있습니다.`
      ));
      return;
    }

    const branchesSnap = await db.collection("branches").where("active", "==", true).get();
    const matched = matchBranch(branchesSnap.docs, branchQuery);

    if (!matched) {
      res.json(simpleText(
        `'${branchQuery}' 지점을 찾을 수 없습니다.\n정확한 지점명을 입력해주세요.\n\n"도움말" 을 입력하면 사용법을 볼 수 있습니다.`
      ));
      return;
    }

    const branchId = matched.id;
    const branchName = matched.data().name as string;

    switch (intent) {
      case "yesterday": {
        const ydate = yesterdayKST();
        const doc = await db.doc(`dailyReports/${branchId}_${ydate}`).get();
        if (!doc.exists) {
          res.json(simpleText(`${branchName}\n\n어제(${ydate}) 보고서가 없습니다.`));
          return;
        }
        res.json(simpleText(formatDashboard(branchName, doc.data() as ReportData, "어제")));
        return;
      }

      case "trend":
        res.json(simpleText(await handleTrend(branchId, branchName)));
        return;

      case "issues":
        res.json(simpleText(await handleIssues(branchId, branchName)));
        return;

      case "tm":
        res.json(simpleText(await handleTm(branchId, branchName)));
        return;

      default: {
        // "today" — 오늘 대시보드 (기존)
        const snap = await db.collection("dailyReports")
          .where("branchId", "==", branchId)
          .orderBy("reportDate", "desc")
          .limit(3)
          .get();

        if (snap.empty) {
          res.json(simpleText(`${branchName}\n\n아직 제출된 보고서가 없습니다.`));
          return;
        }

        const best =
          snap.docs.find((d) => d.data().status === "submitted") ?? snap.docs[0];
        res.json(simpleText(formatDashboard(branchName, best.data() as ReportData)));
        return;
      }
    }
  }
);
