import type { Branch, MemberImportType, MemberStatus } from "@/types";
import { normalizePhone } from "@/lib/utils";

export type ParsedMemberRow = {
  branchId: string;
  branchName: string;
  name: string;
  phone: string;
  status: MemberStatus;
  startDate?: string;
  endDate?: string;
  lastVisitDate?: string;
  productName?: string;
  managerName?: string;
  memo?: string;
};

export type ParsedSatisfactionRow = {
  branchId: string;
  branchName: string;
  memberName: string;
  phone: string;
  responseDate?: string;
  score?: number;
  responseText?: string;
  needsFollowUp: boolean;
  followUpStatus: "pending";
  memo?: string;
};

export type MemberImportPreviewRow =
  | {
      rowNumber: number;
      importType: "members";
      raw: Record<string, unknown>;
      data: ParsedMemberRow;
      errors: string[];
    }
  | {
      rowNumber: number;
      importType: "satisfaction";
      raw: Record<string, unknown>;
      data: ParsedSatisfactionRow;
      errors: string[];
    };

export type MemberImportParseResult = {
  headers: string[];
  mappedHeaders: Record<string, string | null>;
  rows: MemberImportPreviewRow[];
  warnings: string[];
};

const MEMBER_FIELDS = {
  name: ["회원명", "이름", "성명", "고객명"],
  phone: ["연락처", "휴대폰", "휴대전화", "전화번호", "핸드폰", "고객연락처"],
  branchName: ["지점", "센터", "센터명", "매장", "매장명"],
  status: ["회원상태", "상태", "회원권상태", "등록상태"],
  startDate: ["시작일", "등록일", "회원권시작일", "이용시작일"],
  endDate: ["만료일", "종료일", "회원권만료일", "이용종료일"],
  lastVisitDate: ["최근출석일", "마지막출석일", "최종출석일"],
  productName: ["등록상품", "상품명", "회원권", "이용권", "결제상품"],
  managerName: ["담당자", "담당직원", "상담자", "관리자"],
  memo: ["메모", "비고", "특이사항"],
} as const;

const SATISFACTION_FIELDS = {
  memberName: ["회원명", "이름", "성명", "고객명"],
  phone: ["연락처", "휴대폰", "휴대전화", "전화번호", "핸드폰", "고객연락처"],
  branchName: ["지점", "센터", "센터명", "매장", "매장명"],
  responseDate: ["응답일", "조사일", "작성일", "등록일"],
  score: ["만족도", "점수", "평점", "별점", "만족도점수"],
  responseText: ["응답", "답변", "의견", "내용", "불편사항", "건의사항"],
  memo: ["메모", "비고", "특이사항"],
} as const;

const FOLLOW_UP_KEYWORDS = [
  "불만",
  "환불",
  "불편",
  "별로",
  "최악",
  "개선",
  "항의",
  "컴플레인",
  "클레임",
];

function normalizeKey(value: string): string {
  return value.replace(/[\s._\-()[\]/\\]/g, "").toLowerCase();
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function findHeader(headers: string[], candidates: readonly string[]): string | null {
  const normalized = headers.map((header) => ({
    raw: header,
    key: normalizeKey(header),
  }));

  for (const candidate of candidates) {
    const key = normalizeKey(candidate);
    const exact = normalized.find((header) => header.key === key);
    if (exact) return exact.raw;
  }

  for (const candidate of candidates) {
    const key = normalizeKey(candidate);
    const partial = normalized.find(
      (header) => header.key.includes(key) || key.includes(header.key)
    );
    if (partial) return partial.raw;
  }

  return null;
}

function parseCsv(text: string): Record<string, unknown>[] {
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);

  const [headerRow, ...bodyRows] = rows;
  if (!headerRow) return [];

  const headers = headerRow.map((header) => header.trim());
  return bodyRows.map((bodyRow) =>
    Object.fromEntries(headers.map((header, index) => [header, bodyRow[index] ?? ""]))
  );
}

async function readRows(file: File): Promise<Record<string, unknown>[]> {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "csv") {
    return parseCsv(await file.text());
  }

  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) return [];

  return XLSX.utils.sheet_to_json<Record<string, unknown>>(
    workbook.Sheets[firstSheet],
    { defval: "", raw: false }
  );
}

function parseDate(value: unknown): { value?: string; error?: string } {
  const text = displayValue(value);
  if (!text) return {};

  const compact = text.replace(/\s/g, "");
  const ymd = compact.match(/^(\d{4})(\d{2})(\d{2})$/);
  const normalized = ymd
    ? `${ymd[1]}-${ymd[2]}-${ymd[3]}`
    : compact.replace(/[./]/g, "-");

  const dateOnly = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!dateOnly) return { error: "날짜 형식 오류" };

  const year = Number(dateOnly[1]);
  const month = Number(dateOnly[2]);
  const day = Number(dateOnly[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return { error: "날짜 형식 오류" };
  }

  return {
    value: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

function parseScore(value: unknown): number | undefined {
  const text = displayValue(value);
  if (!text) return undefined;
  const matched = text.match(/\d+(\.\d+)?/);
  if (!matched) return undefined;
  const score = Number(matched[0]);
  return Number.isFinite(score) ? score : undefined;
}

function inferStatus(value: unknown, endDate?: string): MemberStatus {
  const text = displayValue(value);
  if (/미등록/.test(text)) return "unregistered";
  if (/만료\s*임박|만료\s*예정|임박/.test(text)) return "expiring";
  if (/만료|종료|expired/i.test(text)) return "expired";
  if (/유효|정상|이용중|활성|active/i.test(text)) return "active";

  if (endDate) {
    const today = new Date();
    const end = new Date(`${endDate}T00:00:00`);
    const diffDays = Math.ceil((end.getTime() - today.getTime()) / 86400000);
    if (diffDays < 0) return "expired";
    if (diffDays <= 30) return "expiring";
    return "active";
  }

  return "unknown";
}

function mapBranches(branches: Branch[]) {
  const byName = new Map<string, Branch>();
  for (const branch of branches) {
    byName.set(normalizeKey(branch.name), branch);
  }
  return byName;
}

function resolveBranch(
  branchNameValue: unknown,
  branches: Branch[],
  fallbackBranchId?: string
): { branchId: string; branchName: string; error?: string } {
  const branchByName = mapBranches(branches);
  const branchName = displayValue(branchNameValue);
  const matched = branchName ? branchByName.get(normalizeKey(branchName)) : undefined;
  const fallback = fallbackBranchId
    ? branches.find((branch) => branch.id === fallbackBranchId)
    : undefined;

  if (matched) return { branchId: matched.id, branchName: matched.name };
  if (!branchName && fallback) {
    return { branchId: fallback.id, branchName: fallback.name };
  }

  return {
    branchId: "",
    branchName,
    error: branchName ? `지점 매핑 실패: ${branchName}` : "지점 매핑 실패",
  };
}

function buildHeaderMap(
  importType: MemberImportType,
  headers: string[]
): Record<string, string | null> {
  const fields = importType === "members" ? MEMBER_FIELDS : SATISFACTION_FIELDS;
  return Object.fromEntries(
    Object.entries(fields).map(([field, candidates]) => [
      field,
      findHeader(headers, candidates),
    ])
  );
}

function getValue(
  row: Record<string, unknown>,
  mappedHeaders: Record<string, string | null>,
  field: string
): unknown {
  const header = mappedHeaders[field];
  return header ? row[header] : "";
}

function followUpNeeded(score: number | undefined, responseText: string): boolean {
  if (score !== undefined && score <= 3) return true;
  return FOLLOW_UP_KEYWORDS.some((keyword) => responseText.includes(keyword));
}

export async function parseMemberImportFile(params: {
  file: File;
  importType: MemberImportType;
  branches: Branch[];
  allowedBranchIds?: string[];
  fallbackBranchId?: string;
}): Promise<MemberImportParseResult> {
  const rawRows = await readRows(params.file);
  const headers = Object.keys(rawRows[0] ?? {});
  const mappedHeaders = buildHeaderMap(params.importType, headers);
  const warnings = Object.entries(mappedHeaders)
    .filter(([, header]) => !header)
    .map(([field]) => `자동 매핑 실패: ${field}`);

  const allowedBranchIds = new Set(params.allowedBranchIds ?? []);
  const hasBranchRestriction = allowedBranchIds.size > 0;

  const rows = rawRows.map((row, index): MemberImportPreviewRow => {
    const errors: string[] = [];
    const branch = resolveBranch(
      getValue(row, mappedHeaders, "branchName"),
      params.branches,
      params.fallbackBranchId
    );

    if (branch.error) errors.push(branch.error);
    if (
      branch.branchId &&
      hasBranchRestriction &&
      !allowedBranchIds.has(branch.branchId)
    ) {
      errors.push("본인 지점이 아닌 행은 저장할 수 없습니다");
    }

    const phone = normalizePhone(getValue(row, mappedHeaders, "phone"));
    if (!phone) errors.push("연락처 없음");

    if (params.importType === "members") {
      const name = displayValue(getValue(row, mappedHeaders, "name"));
      if (!name) errors.push("회원명 없음");

      const startDate = parseDate(getValue(row, mappedHeaders, "startDate"));
      const endDate = parseDate(getValue(row, mappedHeaders, "endDate"));
      const lastVisitDate = parseDate(getValue(row, mappedHeaders, "lastVisitDate"));

      for (const date of [startDate, endDate, lastVisitDate]) {
        if (date.error) errors.push(date.error);
      }

      return {
        rowNumber: index + 2,
        importType: "members",
        raw: row,
        errors,
        data: {
          branchId: branch.branchId,
          branchName: branch.branchName,
          name,
          phone,
          status: inferStatus(getValue(row, mappedHeaders, "status"), endDate.value),
          startDate: startDate.value,
          endDate: endDate.value,
          lastVisitDate: lastVisitDate.value,
          productName: displayValue(getValue(row, mappedHeaders, "productName")) || undefined,
          managerName: displayValue(getValue(row, mappedHeaders, "managerName")) || undefined,
          memo: displayValue(getValue(row, mappedHeaders, "memo")) || undefined,
        },
      };
    }

    const memberName = displayValue(getValue(row, mappedHeaders, "memberName"));
    if (!memberName) errors.push("회원명 없음");

    const responseDate = parseDate(getValue(row, mappedHeaders, "responseDate"));
    if (responseDate.error) errors.push(responseDate.error);

    const score = parseScore(getValue(row, mappedHeaders, "score"));
    const responseText = displayValue(getValue(row, mappedHeaders, "responseText"));

    return {
      rowNumber: index + 2,
      importType: "satisfaction",
      raw: row,
      errors,
      data: {
        branchId: branch.branchId,
        branchName: branch.branchName,
        memberName,
        phone,
        responseDate: responseDate.value,
        score,
        responseText: responseText || undefined,
        needsFollowUp: followUpNeeded(score, responseText),
        followUpStatus: "pending",
        memo: displayValue(getValue(row, mappedHeaders, "memo")) || undefined,
      },
    };
  });

  return { headers, mappedHeaders, rows, warnings };
}
