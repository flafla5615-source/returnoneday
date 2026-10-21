/* 주간보고 첨부파일 검증 (Firebase 의존성 없음 — 순수 함수만)

   확장자만 믿지 않는다. 파일 앞부분의 시그니처(매직 바이트)까지 확인해서
   ".pdf" 로 이름만 바꾼 다른 파일을 걸러낸다.

   MIME 타입은 브라우저/OS 에 따라 비거나 application/octet-stream 으로 오는
   경우가 있어, 브라우저가 준 값을 그대로 믿지 않는다. 대신 확장자와 시그니처로
   종류를 확정한 뒤 우리가 정한 표준 contentType 을 붙여 업로드한다.
   → Storage 보안 규칙의 contentType 검사도 그래서 신뢰할 수 있다. */

export const WEEKLY_FILE_MAX_BYTES = 20 * 1024 * 1024; // 파일당 20MB
export const WEEKLY_FILE_MAX_COUNT = 10; // 주차당 10개

export type WeeklyFileKind = "pdf" | "xlsx" | "xls" | "docx";

export const WEEKLY_ALLOWED_EXTENSIONS: readonly string[] = ["pdf", "xlsx", "xls", "docx"];

/** 업로드 시 우리가 직접 지정하는 표준 contentType (브라우저 값 대신 사용) */
export const WEEKLY_CONTENT_TYPE: Record<WeeklyFileKind, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export const WEEKLY_ALLOWED_CONTENT_TYPES: readonly string[] =
  Object.values(WEEKLY_CONTENT_TYPE);

/** 시그니처 판별에 필요한 최소 바이트 수 */
export const WEEKLY_SIGNATURE_BYTES = 8;

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0 || dot === fileName.length - 1) return "";
  return fileName.slice(dot + 1).toLowerCase();
}

export function kindFromExtension(extension: string): WeeklyFileKind | null {
  return (WEEKLY_ALLOWED_EXTENSIONS as string[]).includes(extension)
    ? (extension as WeeklyFileKind)
    : null;
}

export type FileSignature = "pdf" | "zip" | "ole2";

/**
 * 파일 앞부분으로 실제 형식을 판별한다.
 * - PDF  : "%PDF"
 * - ZIP  : "PK\x03\x04"  → xlsx / docx 는 ZIP 컨테이너다
 * - OLE2 : D0 CF 11 E0 A1 B1 1A E1 → 구형 xls(복합 문서) 형식
 */
export function detectSignature(header: Uint8Array): FileSignature | null {
  const startsWith = (bytes: number[]) =>
    header.length >= bytes.length && bytes.every((b, i) => header[i] === b);

  if (startsWith([0x25, 0x50, 0x44, 0x46])) return "pdf"; // %PDF
  if (startsWith([0x50, 0x4b, 0x03, 0x04])) return "zip"; // PK..
  if (startsWith([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "ole2";
  return null;
}

/** 확장자가 가리키는 종류와 실제 시그니처가 맞는지 */
export function signatureMatchesKind(signature: FileSignature | null, kind: WeeklyFileKind): boolean {
  if (signature === null) return false;
  if (kind === "pdf") return signature === "pdf";
  if (kind === "xls") return signature === "ole2";
  // xlsx / docx 는 둘 다 ZIP 컨테이너라 시그니처만으로는 서로 구분되지 않는다.
  // 확장자로 구분하고, 여기서는 ZIP 인지만 확인한다.
  return signature === "zip";
}

export type WeeklyFileValidation =
  | { ok: true; kind: WeeklyFileKind; contentType: string }
  | { ok: false; reason: string; message: string };

/**
 * 업로드 전 검증 — 개수, 크기, 확장자, 실제 형식을 모두 본다.
 * header 는 파일 앞 WEEKLY_SIGNATURE_BYTES 바이트.
 */
export function validateWeeklyFile(input: {
  name: string;
  size: number;
  header: Uint8Array;
  existingCount: number;
}): WeeklyFileValidation {
  const { name, size, header, existingCount } = input;

  if (existingCount >= WEEKLY_FILE_MAX_COUNT) {
    return {
      ok: false,
      reason: "too-many",
      message: `한 주에 최대 ${WEEKLY_FILE_MAX_COUNT}개까지만 첨부할 수 있습니다.`,
    };
  }

  if (size <= 0) {
    return { ok: false, reason: "empty", message: "빈 파일은 첨부할 수 없습니다." };
  }

  if (size > WEEKLY_FILE_MAX_BYTES) {
    return {
      ok: false,
      reason: "too-large",
      message: `파일당 최대 ${formatFileSize(WEEKLY_FILE_MAX_BYTES)}까지 첨부할 수 있습니다. (${formatFileSize(size)})`,
    };
  }

  const extension = extensionOf(name);
  const kind = kindFromExtension(extension);
  if (!kind) {
    return {
      ok: false,
      reason: "extension",
      message: "PDF, XLSX, XLS, DOCX 파일만 첨부할 수 있습니다.",
    };
  }

  const signature = detectSignature(header);
  if (!signatureMatchesKind(signature, kind)) {
    return {
      ok: false,
      reason: "signature",
      message: `파일 내용이 .${extension} 형식과 일치하지 않습니다. 확장자만 바꾼 파일은 첨부할 수 없습니다.`,
    };
  }

  return { ok: true, kind, contentType: WEEKLY_CONTENT_TYPE[kind] };
}

/** 사람이 읽는 파일 크기 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Storage 경로에 쓸 수 있도록 파일명을 정리한다.
 * 경로 구분자와 제어문자를 없애 상위 폴더로 빠져나가지 못하게 한다.
 */
export function safeFileName(fileName: string): string {
  const cleaned = fileName
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[/\\]/g, "_")
    .replace(/\.{2,}/g, ".")
    .trim();
  return cleaned.slice(0, 120) || "file";
}

/** 주차 폴더 경로 — branchWeeklyReports/{branchId}/{weekStartDate}/ */
export function weeklyFileFolder(branchId: string, weekStartDate: string): string {
  return `branchWeeklyReports/${branchId}/${weekStartDate}`;
}

/** 파일 저장 경로. 같은 이름을 여러 번 올려도 충돌하지 않도록 fileId 를 앞에 붙인다. */
export function weeklyFilePath(
  branchId: string,
  weekStartDate: string,
  fileId: string,
  fileName: string
): string {
  return `${weeklyFileFolder(branchId, weekStartDate)}/${fileId}__${safeFileName(fileName)}`;
}
