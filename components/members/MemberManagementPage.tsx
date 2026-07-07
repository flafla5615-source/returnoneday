"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FirebaseError } from "firebase/app";
import { useAuth } from "@/contexts/AuthContext";
import { getAllBranches, getBranchesByIds } from "@/services/branches";
import {
  getFollowUpSurveys,
  getMemberImportJobs,
  getMembers,
  saveMemberImport,
} from "@/services/members";
import { parseMemberImportFile, type MemberImportPreviewRow } from "@/lib/memberImport";
import { cn, formatPhoneNumber } from "@/lib/utils";
import LoadingState from "@/components/common/LoadingState";
import type {
  Branch,
  Member,
  MemberImportJob,
  MemberImportType,
  MemberStatus,
} from "@/types";
import {
  AlertCircleIcon,
  CheckCircleIcon,
  FileSpreadsheetIcon,
  RefreshCwIcon,
  SearchIcon,
  UploadIcon,
} from "lucide-react";

const STATUS_LABEL: Record<MemberStatus, string> = {
  active: "유효",
  expiring: "만료임박",
  expired: "만료",
  unregistered: "미등록",
  unknown: "미확인",
};

const STATUS_COLOR: Record<MemberStatus, string> = {
  active: "bg-green-100 text-green-700",
  expiring: "bg-yellow-100 text-yellow-700",
  expired: "bg-red-100 text-red-700",
  unregistered: "bg-gray-100 text-gray-600",
  unknown: "bg-slate-100 text-slate-600",
};

type Mode = "admin" | "manager";

type Props = {
  mode: Mode;
};

export default function MemberManagementPage({ mode }: Props) {
  const { user, profile } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [jobs, setJobs] = useState<MemberImportJob[]>([]);
  const [followUpCount, setFollowUpCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [importType, setImportType] = useState<MemberImportType>("members");
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [mappedHeaders, setMappedHeaders] = useState<Record<string, string | null>>({});
  const [previewRows, setPreviewRows] = useState<MemberImportPreviewRow[]>([]);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [branchFilter, setBranchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");

  const managerBranchIds = useMemo(
    () => (mode === "manager" ? profile?.branchIds ?? [] : []),
    [mode, profile]
  );

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;

    async function loadBase() {
      setLoading(true);
      setError(null);
      try {
        const bs = mode === "admin"
          ? await getAllBranches()
          : await getBranchesByIds(profile!.branchIds);

        if (cancelled) return;
        setBranches(bs);
        const defaultBranchId = mode === "manager" ? bs[0]?.id ?? "" : "";
        setSelectedBranchId(defaultBranchId);
        setBranchFilter(defaultBranchId);
      } catch (err) {
        console.error("[Members] base load failed", err);
        if (!cancelled) setError("지점 정보를 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadBase();
    return () => {
      cancelled = true;
    };
  }, [mode, profile]);

  useEffect(() => {
    if (!profile || loading) return;
    let cancelled = false;

    async function loadLists() {
      setListLoading(true);
      try {
        const filters =
          mode === "admin"
            ? {}
            : {
                branchIds: managerBranchIds,
                branchId: branchFilter || undefined,
              };

        const [memberRows, surveys, importJobs] = await Promise.all([
          getMembers(filters),
          getFollowUpSurveys(filters),
          getMemberImportJobs(filters),
        ]);

        if (cancelled) return;
        setMembers(memberRows);
        setFollowUpCount(surveys.length);
        setJobs(importJobs.slice(0, 5));
      } catch (err) {
        console.error("[Members] list load failed", err);
        if (cancelled) return;
        if (err instanceof FirebaseError && err.code === "permission-denied") {
          setError("회원관리 조회 권한이 없습니다.");
        } else {
          setError("회원 데이터를 불러오지 못했습니다.");
        }
      } finally {
        if (!cancelled) setListLoading(false);
      }
    }

    void loadLists();
    return () => {
      cancelled = true;
    };
  }, [branchFilter, loading, managerBranchIds, mode, profile]);

  const validRows = useMemo(
    () => previewRows.filter((row) => row.errors.length === 0),
    [previewRows]
  );

  const invalidRows = previewRows.length - validRows.length;

  const filteredMembers = useMemo(() => {
    const queryText = search.trim().toLowerCase();
    return members.filter((member) => {
      if (mode === "admin" && branchFilter && member.branchId !== branchFilter) {
        return false;
      }
      if (statusFilter && member.status !== statusFilter) return false;
      if (queryText) {
        const haystack = `${member.name} ${member.phone}`.toLowerCase();
        if (!haystack.includes(queryText)) return false;
      }
      return true;
    });
  }, [branchFilter, members, mode, search, statusFilter]);

  const stats = useMemo(() => {
    const base = mode === "admin" ? members : filteredMembers;
    return {
      total: base.length,
      active: base.filter((member) => member.status === "active").length,
      expiring: base.filter((member) => member.status === "expiring").length,
      expired: base.filter((member) => member.status === "expired").length,
      unregistered: base.filter((member) => member.status === "unregistered").length,
      followUp: followUpCount,
    };
  }, [filteredMembers, followUpCount, members, mode]);

  async function refreshLists() {
    setListLoading(true);
    try {
      const filters =
        mode === "admin"
          ? {}
          : {
              branchIds: managerBranchIds,
              branchId: branchFilter || undefined,
            };
      const [memberRows, surveys, importJobs] = await Promise.all([
        getMembers(filters),
        getFollowUpSurveys(filters),
        getMemberImportJobs(filters),
      ]);
      setMembers(memberRows);
      setFollowUpCount(surveys.length);
      setJobs(importJobs.slice(0, 5));
    } finally {
      setListLoading(false);
    }
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setParsing(true);
    setSaveMessage(null);
    setError(null);
    setFileName(file.name);

    try {
      const result = await parseMemberImportFile({
        file,
        importType,
        branches,
        allowedBranchIds: mode === "manager" ? managerBranchIds : undefined,
        fallbackBranchId: mode === "manager" ? selectedBranchId : undefined,
      });
      setMappedHeaders(result.mappedHeaders);
      setParseWarnings(result.warnings);
      setPreviewRows(result.rows);
    } catch (err) {
      console.error("[Members] parse failed", err);
      setPreviewRows([]);
      setMappedHeaders({});
      setParseWarnings([]);
      setError("파일을 읽지 못했습니다. 엑셀 또는 CSV 형식을 확인하세요.");
    } finally {
      setParsing(false);
    }
  }

  function resetPreview() {
    setFileName("");
    setPreviewRows([]);
    setMappedHeaders({});
    setParseWarnings([]);
    setSaveMessage(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleSave() {
    if (!user || !profile || validRows.length === 0) return;

    const selectedBranch = selectedBranchId
      ? branches.find((branch) => branch.id === selectedBranchId)
      : undefined;

    setSaving(true);
    setSaveMessage(null);
    setError(null);

    try {
      await saveMemberImport({
        importType,
        fileName,
        uploadedByUid: user.uid,
        uploadedByRole: profile.role,
        branchId: mode === "manager" ? selectedBranch?.id : undefined,
        branchName: mode === "manager" ? selectedBranch?.name : undefined,
        totalRows: previewRows.length,
        validRows: validRows.length,
        invalidRows,
        memberRows:
          importType === "members"
            ? validRows
                .filter((row) => row.importType === "members")
                .map((row) => row.data)
            : undefined,
        satisfactionRows:
          importType === "satisfaction"
            ? validRows
                .filter((row) => row.importType === "satisfaction")
                .map((row) => row.data)
            : undefined,
      });
      setSaveMessage(`${validRows.length}개 행을 저장했습니다.`);
      resetPreview();
      await refreshLists();
    } catch (err) {
      console.error("[Members] save failed", err);
      if (err instanceof FirebaseError && err.code === "permission-denied") {
        setError("저장 권한이 없습니다.");
      } else {
        setError("저장 중 오류가 발생했습니다.");
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState />;

  const title = mode === "admin" ? "회원관리" : "내 지점 회원관리";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-base font-bold text-gray-900">{title}</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            바디코디 엑셀 기반 회원/고객만족도 데이터
          </p>
        </div>
        <button
          type="button"
          onClick={refreshLists}
          disabled={listLoading}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs border border-gray-300 rounded-lg text-gray-600 bg-white hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCwIcon className={cn("w-3.5 h-3.5", listLoading && "animate-spin")} />
          새로고침
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {saveMessage && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {saveMessage}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label={mode === "admin" ? "전체 회원 수" : "내 지점 전체 회원"} value={stats.total} />
        <StatCard label="유효회원" value={stats.active} tone="green" />
        <StatCard label="만료임박" value={stats.expiring} tone="yellow" />
        <StatCard label="만료회원" value={stats.expired} tone="red" />
        {mode === "admin" && <StatCard label="미등록" value={stats.unregistered} />}
        <StatCard label="만족도 조치 필요" value={stats.followUp} tone="blue" />
      </div>

      <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-4">
        <div className="flex items-center gap-2">
          <FileSpreadsheetIcon className="w-4 h-4 text-[#1e3a5f]" />
          <h2 className="text-sm font-semibold text-gray-900">엑셀 업로드</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[180px_1fr_auto] gap-3 items-end">
          <label className="space-y-1">
            <span className="text-xs font-medium text-gray-600">업로드 유형</span>
            <select
              value={importType}
              onChange={(event) => {
                setImportType(event.target.value as MemberImportType);
                resetPreview();
              }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
            >
              <option value="members">회원 목록</option>
              <option value="satisfaction">고객만족도 조사</option>
            </select>
          </label>

          {mode === "manager" && (
            <label className="space-y-1">
              <span className="text-xs font-medium text-gray-600">업로드 지점</span>
              <select
                value={selectedBranchId}
                onChange={(event) => {
                  setSelectedBranchId(event.target.value);
                  setBranchFilter(event.target.value);
                  resetPreview();
                }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
              >
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
            </label>
          )}

          <label className="space-y-1">
            <span className="text-xs font-medium text-gray-600">파일</span>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileChange}
              className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-[#1e3a5f] file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-[#16304f]"
            />
          </label>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving || validRows.length === 0}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304f] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <UploadIcon className="w-4 h-4" />
            {saving ? "저장 중..." : "저장하기"}
          </button>
        </div>

        {parsing && <LoadingState />}

        {(parseWarnings.length > 0 || previewRows.length > 0) && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {fileName && (
                <span className="px-2 py-1 rounded bg-gray-100 text-gray-600">{fileName}</span>
              )}
              <span className="px-2 py-1 rounded bg-green-100 text-green-700">
                유효 {validRows.length}
              </span>
              <span className="px-2 py-1 rounded bg-red-100 text-red-700">
                오류 {invalidRows}
              </span>
            </div>

            {parseWarnings.length > 0 && (
              <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-yellow-800 mb-1">
                  <AlertCircleIcon className="w-3.5 h-3.5" />
                  매핑 경고
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {parseWarnings.map((warning) => (
                    <span key={warning} className="px-2 py-1 rounded bg-white text-xs text-yellow-700 border border-yellow-100">
                      {warning}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <MappingSummary mappedHeaders={mappedHeaders} />
            <PreviewTable rows={previewRows} importType={importType} />
          </div>
        )}
      </section>

      <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-900">회원 목록</h2>
            <span className="text-xs text-gray-400">{filteredMembers.length}명</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {mode === "admin" && (
              <select
                value={branchFilter}
                onChange={(event) => setBranchFilter(event.target.value)}
                className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white"
              >
                <option value="">전체 지점</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
            )}
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white"
            >
              <option value="">전체 상태</option>
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <div className="relative">
              <SearchIcon className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="회원명·연락처 검색"
                className="border border-gray-300 rounded-lg pl-8 pr-3 py-1.5 text-xs w-48 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
              />
            </div>
          </div>
        </div>

        {listLoading ? (
          <LoadingState />
        ) : filteredMembers.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">
            저장된 회원 데이터가 없습니다.
          </div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm min-w-[960px]">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {[
                      "지점",
                      "회원명",
                      "연락처",
                      "상태",
                      "시작일",
                      "만료일",
                      "최근출석일",
                      "등록상품",
                      "담당자",
                      "메모",
                    ].map((header) => (
                      <th key={header} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredMembers.map((member) => (
                    <tr key={member.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2.5 text-xs text-gray-500">{member.branchName}</td>
                      <td className="px-3 py-2.5 font-medium text-gray-900">{member.name}</td>
                      <td className="px-3 py-2.5 text-gray-600">{formatPhoneNumber(member.phone)}</td>
                      <td className="px-3 py-2.5"><StatusPill status={member.status} /></td>
                      <td className="px-3 py-2.5 text-gray-600">{member.startDate ?? "-"}</td>
                      <td className="px-3 py-2.5 text-gray-600">{member.endDate ?? "-"}</td>
                      <td className="px-3 py-2.5 text-gray-600">{member.lastVisitDate ?? "-"}</td>
                      <td className="px-3 py-2.5 text-gray-600">{member.productName ?? "-"}</td>
                      <td className="px-3 py-2.5 text-gray-600">{member.managerName ?? "-"}</td>
                      <td className="px-3 py-2.5 text-gray-500 max-w-[180px] truncate">{member.memo ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="md:hidden divide-y divide-gray-100">
              {filteredMembers.map((member) => (
                <div key={member.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{member.name}</p>
                      <p className="text-xs text-gray-400">{member.branchName}</p>
                    </div>
                    <StatusPill status={member.status} />
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-500">
                    <span>{formatPhoneNumber(member.phone)}</span>
                    <span>만료 {member.endDate ?? "-"}</span>
                    <span>최근 {member.lastVisitDate ?? "-"}</span>
                    <span>{member.productName ?? "-"}</span>
                  </div>
                  {member.memo && <p className="text-xs text-gray-400">{member.memo}</p>}
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">업로드 이력</h2>
        {jobs.length === 0 ? (
          <p className="text-sm text-gray-400">업로드 이력이 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {jobs.map((job) => (
              <div key={job.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2 text-xs">
                <div className="min-w-0">
                  <p className="font-medium text-gray-700 truncate">{job.fileName}</p>
                  <p className="text-gray-400">
                    {job.importType === "members" ? "회원 목록" : "고객만족도 조사"} ·{" "}
                    {job.branchName ?? "전체 지점"}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-gray-500">
                  <span>유효 {job.validRows}</span>
                  <span>오류 {job.invalidRows}</span>
                  <CheckCircleIcon className="w-4 h-4 text-green-500" />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {mode === "manager" && branches.length === 0 && (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
          배정된 지점이 없습니다.
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "green" | "yellow" | "red" | "blue";
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p
        className={cn(
          "text-2xl font-bold",
          tone === "green"
            ? "text-green-600"
            : tone === "yellow"
            ? "text-yellow-600"
            : tone === "red"
            ? "text-red-600"
            : tone === "blue"
            ? "text-blue-600"
            : "text-gray-900"
        )}
      >
        {value.toLocaleString("ko-KR")}
      </p>
    </div>
  );
}

function StatusPill({ status }: { status: MemberStatus }) {
  return (
    <span className={cn("inline-flex px-2 py-0.5 rounded-full text-xs font-medium", STATUS_COLOR[status])}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function MappingSummary({ mappedHeaders }: { mappedHeaders: Record<string, string | null> }) {
  const entries = Object.entries(mappedHeaders);
  if (entries.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([field, header]) => (
        <span
          key={field}
          className={cn(
            "px-2 py-1 rounded text-xs border",
            header
              ? "bg-green-50 border-green-100 text-green-700"
              : "bg-gray-50 border-gray-100 text-gray-400"
          )}
        >
          {field}: {header ?? "-"}
        </span>
      ))}
    </div>
  );
}

function PreviewTable({
  rows,
  importType,
}: {
  rows: MemberImportPreviewRow[];
  importType: MemberImportType;
}) {
  if (rows.length === 0) return null;

  const visibleRows = rows.slice(0, 50);

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-xs min-w-[920px]">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            {(importType === "members"
              ? [
                  "행",
                  "검증",
                  "회원명",
                  "연락처",
                  "지점",
                  "상태",
                  "시작일",
                  "만료일",
                  "최근출석일",
                  "등록상품",
                  "담당자",
                  "메모",
                ]
              : [
                  "행",
                  "검증",
                  "회원명",
                  "연락처",
                  "지점",
                  "응답일",
                  "점수",
                  "응답 내용",
                  "조치 필요",
                  "조치 상태",
                  "메모",
                ]
            ).map((header) => (
              <th key={header} className="px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {visibleRows.map((row) => (
            <tr key={row.rowNumber} className={row.errors.length > 0 ? "bg-red-50/60" : "bg-white"}>
              <td className="px-3 py-2 text-gray-400">{row.rowNumber}</td>
              <td className="px-3 py-2">
                {row.errors.length === 0 ? (
                  <span className="text-green-600">유효</span>
                ) : (
                  <span className="text-red-600">{row.errors.join(", ")}</span>
                )}
              </td>
              {row.importType === "members" ? (
                <>
                  <td className="px-3 py-2 font-medium text-gray-800">{row.data.name || "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{formatPhoneNumber(row.data.phone)}</td>
                  <td className="px-3 py-2 text-gray-600">{row.data.branchName || "-"}</td>
                  <td className="px-3 py-2"><StatusPill status={row.data.status} /></td>
                  <td className="px-3 py-2 text-gray-600">{row.data.startDate ?? "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{row.data.endDate ?? "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{row.data.lastVisitDate ?? "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{row.data.productName ?? "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{row.data.managerName ?? "-"}</td>
                  <td className="px-3 py-2 text-gray-500 max-w-[160px] truncate">{row.data.memo ?? "-"}</td>
                </>
              ) : (
                <>
                  <td className="px-3 py-2 font-medium text-gray-800">{row.data.memberName || "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{formatPhoneNumber(row.data.phone)}</td>
                  <td className="px-3 py-2 text-gray-600">{row.data.branchName || "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{row.data.responseDate ?? "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{row.data.score ?? "-"}</td>
                  <td className="px-3 py-2 text-gray-600 max-w-[220px] truncate">{row.data.responseText ?? "-"}</td>
                  <td className="px-3 py-2 text-gray-600">{row.data.needsFollowUp ? "필요" : "아니오"}</td>
                  <td className="px-3 py-2 text-gray-600">대기</td>
                  <td className="px-3 py-2 text-gray-500 max-w-[160px] truncate">{row.data.memo ?? "-"}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > visibleRows.length && (
        <div className="px-3 py-2 text-xs text-gray-400 bg-gray-50 border-t border-gray-100">
          미리보기는 처음 50행만 표시됩니다.
        </div>
      )}
    </div>
  );
}
