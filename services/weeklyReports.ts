import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytesResumable,
} from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import type {
  BranchWeeklyReport,
  WeeklyFileChange,
  WeeklyReportFile,
  WeeklyReportStatus,
} from "@/types";
import { isValidDateKey } from "@/lib/utils";
import { weekEndOf, weekStartOf } from "@/lib/weekSchedule";
import { resolveWeeklyState } from "@/lib/weeklyReportWrite";
import {
  WEEKLY_SIGNATURE_BYTES,
  validateWeeklyFile,
  weeklyFilePath,
} from "@/lib/weeklyFiles";

export { resolveWeeklyState };

/* ══════════════════════════════════════════════════════════════════════════
   주간보고 (월~일, KST) — 파일 첨부 방식

   1. 문서 ID = {branchId}_{weekStartDate}
      같은 지점·같은 주차 문서가 하나뿐이라 중복 생성이 구조적으로 불가능하다.
   2. 실제 파일은 Firebase Storage, Firestore 에는 메타데이터만 둔다.
   3. 다운로드 URL 은 저장하지 않는다. 조회 시점에 Storage 규칙을 통과한
      사용자에게만 발급한다.
   4. 업로드가 끝난 뒤에야 메타데이터를 기록한다 →
      실패한 파일이 "제출 완료"에 포함되지 않는다.
   5. branchShiftReports / dailyReports / promotions / KPI 는 건드리지 않는다.
   ══════════════════════════════════════════════════════════════════════════ */

const COLLECTION = "branchWeeklyReports";

export function weeklyReportId(branchId: string, weekStartDate: string): string {
  return `${branchId}_${weekStartDate}`.replaceAll("/", "-");
}

// ─── 조회 ────────────────────────────────────────────────────────────────────

export async function getWeeklyReport(
  branchId: string,
  weekStartDate: string
): Promise<BranchWeeklyReport | null> {
  const snap = await getDoc(doc(db, COLLECTION, weeklyReportId(branchId, weekStartDate)));
  return snap.exists() ? (snap.data() as BranchWeeklyReport) : null;
}

export async function getWeeklyReportsInRange(params: {
  fromWeekStart: string;
  toWeekStart: string;
  branchId?: string;
}): Promise<BranchWeeklyReport[]> {
  const { fromWeekStart, toWeekStart, branchId } = params;
  const constraints = [
    ...(branchId ? [where("branchId", "==", branchId)] : []),
    where("weekStartDate", ">=", fromWeekStart),
    where("weekStartDate", "<=", toWeekStart),
    orderBy("weekStartDate", "desc"),
  ];
  const snap = await getDocs(query(collection(db, COLLECTION), ...constraints));
  return snap.docs.map((d) => d.data() as BranchWeeklyReport);
}

/**
 * 첨부파일 다운로드 URL — 저장해 두지 않고 필요할 때 발급한다.
 * Storage 규칙을 통과하지 못하면 여기서 실패한다.
 */
export async function getWeeklyFileUrl(file: WeeklyReportFile): Promise<string> {
  return getDownloadURL(storageRef(storage, file.storagePath));
}

// ─── 문서 생성 보조 ──────────────────────────────────────────────────────────

function assertWeek(weekStartDate: string) {
  if (!isValidDateKey(weekStartDate)) throw new Error("week-invalid");
  if (weekStartOf(weekStartDate) !== weekStartDate) throw new Error("week-not-monday");
}

/** 문서가 없으면 빈 임시저장 문서를 만든다 (파일 업로드 전에 필요). */
async function ensureWeeklyDoc(params: {
  branchId: string;
  branchName: string;
  weekStartDate: string;
  uid: string;
  name: string;
}): Promise<BranchWeeklyReport | null> {
  const { branchId, branchName, weekStartDate, uid, name } = params;
  const id = weeklyReportId(branchId, weekStartDate);
  const ref = doc(db, COLLECTION, id);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data() as BranchWeeklyReport;

  await setDoc(ref, {
    id,
    branchId,
    branchName,
    weekStartDate,
    weekEndDate: weekEndOf(weekStartDate),
    files: [],
    fileHistory: [],
    status: "draft",
    editCount: 0,
    editHistory: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
    updatedByName: name,
  });
  return null;
}

// ─── 파일 업로드 ─────────────────────────────────────────────────────────────

export interface UploadWeeklyFileInput {
  branchId: string;
  branchName: string;
  weekStartDate: string;
  file: File;
  uid: string;
  name: string;
  /** 0~100 */
  onProgress?: (percent: number) => void;
}

/** 파일 앞부분을 읽어 실제 형식을 확인하기 위한 헤더 */
async function readHeader(file: File): Promise<Uint8Array> {
  const slice = file.slice(0, WEEKLY_SIGNATURE_BYTES);
  return new Uint8Array(await slice.arrayBuffer());
}

function randomFileId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 파일 1개 업로드 + 메타데이터 기록.
 * 업로드가 완전히 끝난 뒤에만 Firestore 에 기록하므로,
 * 실패한 파일이 목록에 남거나 제출 완료로 집계되지 않는다.
 */
export async function uploadWeeklyFile(
  input: UploadWeeklyFileInput
): Promise<WeeklyReportFile> {
  const { branchId, branchName, weekStartDate, file, uid, name, onProgress } = input;

  if (!branchId) throw new Error("branchId is missing");
  if (!uid) throw new Error("uid is missing");
  assertWeek(weekStartDate);

  const existing = await ensureWeeklyDoc({ branchId, branchName, weekStartDate, uid, name });
  const existingCount = existing?.files?.length ?? 0;

  const header = await readHeader(file);
  const check = validateWeeklyFile({
    name: file.name,
    size: file.size,
    header,
    existingCount,
  });
  if (!check.ok) {
    const error = new Error(check.reason);
    (error as Error & { userMessage?: string }).userMessage = check.message;
    throw error;
  }

  const fileId = randomFileId();
  const path = weeklyFilePath(branchId, weekStartDate, fileId, file.name);

  // 브라우저가 준 MIME 대신 검증으로 확정한 표준 contentType 을 붙인다.
  // Storage 규칙의 contentType 검사가 의미를 가지려면 이 값이 신뢰 가능해야 한다.
  const task = uploadBytesResumable(storageRef(storage, path), file, {
    contentType: check.contentType,
  });

  await new Promise<void>((resolve, reject) => {
    task.on(
      "state_changed",
      (snap) => {
        if (onProgress && snap.totalBytes > 0) {
          onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
        }
      },
      reject,
      () => resolve()
    );
  });

  const meta: WeeklyReportFile = {
    fileId,
    name: file.name,
    size: file.size,
    contentType: check.contentType,
    storagePath: path,
    // 배열 원소에는 serverTimestamp 를 넣을 수 없다. 권위 있는 시각은
    // 문서의 updatedAt / submittedAt (서버 시각) 이다.
    uploadedAt: Timestamp.now(),
    uploadedByUid: uid,
    uploadedByName: name,
  };

  const change: WeeklyFileChange = {
    action: "added",
    fileId,
    fileName: file.name,
    at: Timestamp.now(),
    byUid: uid,
    byName: name,
  };

  // 업로드가 끝난 뒤에만 메타데이터를 쓴다
  const ref = doc(db, COLLECTION, weeklyReportId(branchId, weekStartDate));
  const current = (await getDoc(ref)).data() as BranchWeeklyReport | undefined;
  await updateDoc(ref, {
    files: [...(current?.files ?? []), meta],
    fileHistory: [...(current?.fileHistory ?? []), change].slice(-100),
    branchName,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
    updatedByName: name,
  });

  return meta;
}

/**
 * 첨부파일 삭제 — Storage 와 Firestore 메타데이터를 함께 정리한다.
 * Storage 삭제가 실패해도 목록에서는 빼서 화면과 데이터가 어긋나지 않게 한다.
 * (지워지지 않은 파일은 규칙상 담당자·본사만 접근 가능하므로 노출되지 않는다.)
 */
export async function deleteWeeklyFile(params: {
  branchId: string;
  weekStartDate: string;
  fileId: string;
  uid: string;
  name: string;
}): Promise<void> {
  const { branchId, weekStartDate, fileId, uid, name } = params;
  const ref = doc(db, COLLECTION, weeklyReportId(branchId, weekStartDate));
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const current = snap.data() as BranchWeeklyReport;
  const target = (current.files ?? []).find((f) => f.fileId === fileId);
  if (!target) return;

  try {
    await deleteObject(storageRef(storage, target.storagePath));
  } catch (error) {
    // 이미 지워진 파일이면 메타데이터 정리만 계속한다
    console.error("[weeklyReports] storage delete failed", target.storagePath, error);
  }

  const change: WeeklyFileChange = {
    action: "removed",
    fileId,
    fileName: target.name,
    at: Timestamp.now(),
    byUid: uid,
    byName: name,
  };

  const nextFiles = (current.files ?? []).filter((f) => f.fileId !== fileId);

  await updateDoc(ref, {
    files: nextFiles,
    fileHistory: [...(current.fileHistory ?? []), change].slice(-100),
    // 첨부가 하나도 남지 않으면 제출 상태를 유지할 수 없다 (규칙에서도 막힌다)
    ...(nextFiles.length === 0 && current.status === "submitted"
      ? { status: "draft" as WeeklyReportStatus }
      : {}),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
    updatedByName: name,
  });
}

// ─── 제출 ────────────────────────────────────────────────────────────────────

/**
 * 제출 처리. 첨부파일이 하나도 없으면 제출할 수 없다.
 * 최초 제출 시각은 한 번만 기록하고, 이후 수정은 횟수만 올린다.
 */
export async function submitWeeklyReport(params: {
  branchId: string;
  branchName: string;
  weekStartDate: string;
  uid: string;
  name: string;
}): Promise<void> {
  const { branchId, branchName, weekStartDate, uid, name } = params;
  assertWeek(weekStartDate);

  const ref = doc(db, COLLECTION, weeklyReportId(branchId, weekStartDate));
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("no-files");

  const current = snap.data() as BranchWeeklyReport;
  if ((current.files ?? []).length === 0) throw new Error("no-files");

  const alreadySubmitted = current.status === "submitted";

  await updateDoc(ref, {
    status: "submitted",
    branchName,
    // 제출 이후의 재제출은 수정으로 센다
    editCount: (current.editCount ?? 0) + (alreadySubmitted ? 1 : 0),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
    updatedByName: name,
    // 최초 제출 시각은 한 번만 기록한다
    ...(current.submittedAt
      ? {}
      : { submittedAt: serverTimestamp(), submittedBy: uid, submittedByName: name }),
  });
}
