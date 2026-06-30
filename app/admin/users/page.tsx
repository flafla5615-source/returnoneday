"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { getAllBranches } from "@/services/branches";
import { getAllUsers, updateUserProfileWithBranchAssignments } from "@/services/users";
import { getAllManagerInvites, upsertManagerInvite } from "@/services/managerInvites";
import LoadingState from "@/components/common/LoadingState";
import { cn, formatDate } from "@/lib/utils";
import type { Branch, UserProfile, ManagerInvite, ManagerInviteStatus, UserRole, UserStatus } from "@/types";
import {
  DownloadIcon,
  UploadIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  EditIcon,
  SaveIcon,
  XIcon,
  BuildingIcon,
} from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────────────

const MANAGER_ASSIGNMENTS: { key: string; name: string; branches: string[] }[] = [
  { key: "kim-jeongwon",  name: "김정원", branches: ["머팩 강남점"] },
  { key: "jeong-sunghun", name: "정성훈", branches: ["머팩 경상대점", "팀애플 경상대점"] },
  { key: "kang-daehwan",  name: "강대환", branches: ["머팩 고성점"] },
  { key: "kim-danbi",     name: "김단비", branches: ["머팩 사천본점"] },
  { key: "kim-sunghun",   name: "김승훈", branches: ["머팩 진주혁신점"] },
  { key: "lee-juhwan",    name: "이주환", branches: ["머팩 터미널점"] },
  { key: "lee-seokho",    name: "이석호", branches: ["머팩 하대점"] },
  { key: "kang-gyeongho", name: "강경호", branches: ["머팩 호탄점"] },
  { key: "kim-jihun",     name: "김지훈", branches: ["머팩 정촌점"] },
  { key: "ha-sunghun",    name: "하성훈", branches: ["올드짐 사천점"] },
  { key: "kim-donghwan",  name: "김동환", branches: ["올드짐 하대점"] },
  { key: "kim-minhu",     name: "김민후", branches: ["올드짐 평거점", "어반짐"] },
  { key: "lee-onseok",    name: "이언석", branches: ["올드짐 상동점", "올드짐 아주점"] },
  { key: "bae-jeongjae",  name: "배정재", branches: ["올드짐 수월점"] },
  { key: "choi-urin",     name: "최우린", branches: ["우아 아주점", "벨로바레", "어반요가"] },
  { key: "yun-yujeong",   name: "윤유정", branches: ["우아 상동점"] },
  { key: "kim-hayeon",    name: "김하연", branches: ["우아 죽림점", "우아 북신점"] },
  { key: "choi-jaehyeok", name: "최재혁", branches: ["핏메드"] },
  { key: "kang-jaewoo",   name: "강재우", branches: ["볼드짐"] },
];

const HQ_BRANCHES = ["머팩 벌리점", "머팩 보건대점", "머팩 신진주역점", "짐플릭스 시청점"];

const STATUS_LABEL: Record<ManagerInviteStatus, string> = {
  email_required:  "이메일 필요",
  account_pending: "계정 미생성",
  account_created: "계정 생성 완료",
  password_pending:"비밀번호 설정 대기",
  active:          "활성",
  suspended:       "정지",
};

const STATUS_COLOR: Record<ManagerInviteStatus, string> = {
  email_required:  "bg-gray-100 text-gray-600",
  account_pending: "bg-yellow-100 text-yellow-700",
  account_created: "bg-blue-100 text-blue-700",
  password_pending:"bg-orange-100 text-orange-700",
  active:          "bg-green-100 text-green-700",
  suspended:       "bg-red-100 text-red-700",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function deriveStatus(email: string, matchedUser?: UserProfile): ManagerInviteStatus {
  if (!email) return "email_required";
  if (!matchedUser) return "account_pending";
  if (matchedUser.status === "active") return "active";
  if (matchedUser.status === "suspended") return "suspended";
  return "account_created";
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminUsersPage() {
  const [tab, setTab] = useState<"preparation" | "existing">("preparation");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [invites, setInvites] = useState<Record<string, ManagerInvite>>({});
  const [loading, setLoading] = useState(true);

  // Inline email edit
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  // Preview modal
  const [showPreview, setShowPreview] = useState(false);

  // CSV upload
  const csvRef = useRef<HTMLInputElement>(null);

  // Existing user edit modal
  const [editUser, setEditUser] = useState<UserProfile | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<UserRole>("branch_manager");
  const [editStatus, setEditStatus] = useState<UserStatus>("pending");
  const [editBranchIds, setEditBranchIds] = useState<string[]>([]);
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    Promise.all([getAllBranches(), getAllUsers(), getAllManagerInvites()]).then(
      ([bs, us, inv]) => {
        setBranches(bs);
        setUsers(us);
        setInvites(inv);
        setLoading(false);
      }
    );
  }, []);

  const branchNameToId = useMemo(() => {
    const map: Record<string, string> = {};
    branches.forEach((b) => { map[b.name] = b.id; });
    return map;
  }, [branches]);

  const emailToUser = useMemo(() => {
    const map: Record<string, UserProfile> = {};
    users.forEach((u) => { if (u.email) map[u.email] = u; });
    return map;
  }, [users]);

  // ── Email validation ────────────────────────────────────────────────────────

  function validateEmail(email: string, currentKey: string): string | null {
    if (!email) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "올바른 이메일 형식이 아닙니다";
    const dup = Object.entries(invites).find(
      ([k, inv]) => k !== currentKey && inv.email === email
    );
    if (dup) return `"${dup[1].name}"에 이미 입력된 이메일입니다`;
    const existing = emailToUser[email];
    if (existing) return `기존 Firebase 계정이 존재합니다 (${existing.name || email})`;
    return null;
  }

  // ── Inline edit handlers ────────────────────────────────────────────────────

  function startEdit(key: string) {
    setEditingKey(key);
    setEditEmail(invites[key]?.email ?? "");
    setEmailError(null);
  }

  function cancelEdit() {
    setEditingKey(null);
    setEditEmail("");
    setEmailError(null);
  }

  async function saveEmail(key: string, name: string, branchNames: string[]) {
    const email = editEmail.trim();
    const err = validateEmail(email, key);
    if (err) { setEmailError(err); return; }

    const branchIds = branchNames
      .map((n) => branchNameToId[n])
      .filter((id): id is string => Boolean(id));

    const matchedUser = email ? emailToUser[email] : undefined;
    const status = deriveStatus(email, matchedUser);

    setSaving(key);
    await upsertManagerInvite(key, { name, email, branchIds, status });
    setInvites((prev) => ({
      ...prev,
      [key]: { ...prev[key], name, email, branchIds, status },
    }));
    setEditingKey(null);
    setSaving(null);
  }

  // ── CSV ────────────────────────────────────────────────────────────────────

  function downloadCSV() {
    const rows: string[][] = [["담당자명", "이메일", "담당지점"]];
    MANAGER_ASSIGNMENTS.forEach(({ key, name, branches: bNames }) => {
      rows.push([name, invites[key]?.email ?? "", bNames.join(",")]);
    });
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "manager_assignments.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleCSVUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(Boolean).slice(1); // skip header

    for (const line of lines) {
      // Split by commas outside quotes
      const parts = line
        .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
        .map((p) => p.replace(/^"|"$/g, "").trim());
      const [csvName, csvEmail] = parts;
      if (!csvName) continue;

      const assignment = MANAGER_ASSIGNMENTS.find((m) => m.name === csvName);
      if (!assignment) continue;

      const email = csvEmail ?? "";
      const branchIds = assignment.branches
        .map((n) => branchNameToId[n])
        .filter((id): id is string => Boolean(id));
      const matchedUser = email ? emailToUser[email] : undefined;
      const status = deriveStatus(email, matchedUser);

      await upsertManagerInvite(assignment.key, {
        name: csvName,
        email,
        branchIds,
        status,
      });
      setInvites((prev) => ({
        ...prev,
        [assignment.key]: { ...prev[assignment.key], name: csvName, email, branchIds, status },
      }));
    }

    if (csvRef.current) csvRef.current.value = "";
  }

  // ── Stats & preview ────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    let withEmail = 0, withoutEmail = 0, existingAccount = 0;
    MANAGER_ASSIGNMENTS.forEach(({ key }) => {
      const email = invites[key]?.email?.trim() ?? "";
      if (email) {
        withEmail++;
        if (emailToUser[email]) existingAccount++;
      } else {
        withoutEmail++;
      }
    });
    return {
      total: MANAGER_ASSIGNMENTS.length,
      withEmail,
      withoutEmail,
      existingAccount,
      newAccount: withEmail - existingAccount,
    };
  }, [invites, emailToUser]);

  const preview = useMemo(() => {
    let branchConnections = 0;
    const errorDetails: string[] = [];

    MANAGER_ASSIGNMENTS.forEach(({ key, name, branches: bNames }) => {
      const email = invites[key]?.email?.trim() ?? "";
      bNames.forEach((n) => {
        if (!branchNameToId[n]) {
          errorDetails.push(`${name}: "${n}" 지점명 불일치`);
        } else if (email && !emailToUser[email]) {
          branchConnections++;
        }
      });
    });

    return { ...stats, branchConnections, errors: errorDetails.length, errorDetails };
  }, [stats, invites, emailToUser, branchNameToId]);

  // ── Existing user edit ─────────────────────────────────────────────────────

  function openEditUser(u: UserProfile) {
    setEditUser(u);
    setEditName(u.name);
    setEditRole(u.role);
    setEditStatus(u.status);
    setEditBranchIds(u.branchIds);
  }

  async function saveEditUser() {
    if (!editUser) return;
    const nextBranchIds = editRole === "branch_manager" ? editBranchIds : [];
    setEditSaving(true);
    await updateUserProfileWithBranchAssignments(editUser.uid, {
      name: editName,
      role: editRole,
      status: editStatus,
      branchIds: nextBranchIds,
    });
    setUsers((prev) =>
      prev.map((u) =>
        u.uid === editUser.uid
          ? { ...u, name: editName, role: editRole, status: editStatus, branchIds: nextBranchIds }
          : u
      )
    );
    setEditUser(null);
    setEditSaving(false);
  }

  function toggleBranch(id: string) {
    setEditBranchIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4">
      {/* Header */}
      <h1 className="text-base font-bold text-gray-900">사용자 관리</h1>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        <TabButton
          label={`담당자 계정 준비 (${MANAGER_ASSIGNMENTS.length})`}
          active={tab === "preparation"}
          onClick={() => setTab("preparation")}
        />
        <TabButton
          label={`기존 Firebase 계정 (${users.length})`}
          active={tab === "existing"}
          onClick={() => setTab("existing")}
        />
      </div>

      {/* ── Tab 1: 담당자 계정 준비 ─────────────────────────────────────────── */}
      {tab === "preparation" && (
        <div className="space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="전체 담당자" value={stats.total} colorClass="text-blue-600" />
            <StatCard label="이메일 입력 완료" value={stats.withEmail} colorClass="text-green-600" />
            <StatCard label="이메일 누락" value={stats.withoutEmail} colorClass="text-yellow-600" />
            <StatCard label="기존 계정" value={stats.existingAccount} colorClass="text-purple-600" />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={downloadCSV}
              className="flex items-center gap-1.5 px-3 py-2 text-xs border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
            >
              <DownloadIcon className="w-3.5 h-3.5" />
              CSV 샘플 다운로드
            </button>
            <label className="flex items-center gap-1.5 px-3 py-2 text-xs border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 cursor-pointer">
              <UploadIcon className="w-3.5 h-3.5" />
              CSV 이메일 업로드
              <input
                ref={csvRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleCSVUpload}
              />
            </label>
            <button
              onClick={() => setShowPreview(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304f]"
            >
              <CheckCircleIcon className="w-3.5 h-3.5" />
              계정 생성 준비 확인
            </button>
          </div>

          {/* Manager table */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {["담당자명", "이메일", "상태", "담당 지점", "계정 연결", ""].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {MANAGER_ASSIGNMENTS.map(({ key, name, branches: bNames }) => {
                  const invite = invites[key];
                  const email = invite?.email ?? "";
                  const isEditing = editingKey === key;
                  const matchedUser = email ? emailToUser[email] : undefined;
                  const statusKey = deriveStatus(email, matchedUser);
                  const unresolved = bNames.filter((n) => !branchNameToId[n]);
                  const resolved = bNames.filter((n) => branchNameToId[n]);

                  return (
                    <tr key={key} className="hover:bg-gray-50">
                      {/* Name */}
                      <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                        {name}
                      </td>

                      {/* Email */}
                      <td className="px-4 py-3 min-w-[220px]">
                        {isEditing ? (
                          <div className="space-y-1">
                            <input
                              type="email"
                              value={editEmail}
                              onChange={(e) => {
                                setEditEmail(e.target.value);
                                setEmailError(validateEmail(e.target.value, key));
                              }}
                              placeholder="email@example.com"
                              autoFocus
                              className={cn(
                                "w-full border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1",
                                emailError
                                  ? "border-red-400 focus:ring-red-400"
                                  : "border-gray-300 focus:ring-[#1e3a5f]"
                              )}
                            />
                            {emailError && (
                              <p className="text-xs text-red-500">{emailError}</p>
                            )}
                          </div>
                        ) : (
                          <span
                            className="text-xs cursor-pointer hover:underline"
                            onClick={() => startEdit(key)}
                          >
                            {email ? (
                              <span className="text-gray-700">{email}</span>
                            ) : (
                              <span className="text-gray-400 italic">이메일 없음 — 클릭하여 입력</span>
                            )}
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={cn(
                            "inline-flex px-2 py-0.5 rounded-full text-xs font-medium",
                            STATUS_COLOR[statusKey]
                          )}
                        >
                          {STATUS_LABEL[statusKey]}
                        </span>
                      </td>

                      {/* Branches */}
                      <td className="px-4 py-3 text-xs max-w-[200px]">
                        <div className="space-y-0.5">
                          {resolved.map((n) => (
                            <div key={n} className="text-gray-600">{n}</div>
                          ))}
                          {unresolved.map((n) => (
                            <div key={n} className="text-red-500 flex items-center gap-1">
                              <AlertCircleIcon className="w-3 h-3 shrink-0" />
                              {n}
                            </div>
                          ))}
                        </div>
                      </td>

                      {/* Auth/Firestore link */}
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        {matchedUser ? (
                          <span className="text-green-600 flex items-center gap-1">
                            <CheckCircleIcon className="w-3.5 h-3.5" />
                            연결됨
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {isEditing ? (
                          <div className="flex gap-1">
                            <button
                              onClick={() => saveEmail(key, name, bNames)}
                              disabled={saving === key || !!emailError}
                              className="p-1.5 rounded bg-[#1e3a5f] text-white hover:bg-[#16304f] disabled:opacity-40"
                              title="저장"
                            >
                              <SaveIcon className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="p-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
                              title="취소"
                            >
                              <XIcon className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startEdit(key)}
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
                            title="이메일 수정"
                          >
                            <EditIcon className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* HQ branches notice */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-blue-900 mb-2 flex items-center gap-2">
              <BuildingIcon className="w-4 h-4" />
              본사 직접 관리 지점 — 별도 지점장 계정 미생성
            </h3>
            <div className="flex flex-wrap gap-2">
              {HQ_BRANCHES.map((n) => (
                <span key={n} className="px-2.5 py-1 bg-blue-100 text-blue-700 rounded-lg text-xs font-medium">
                  {n}
                </span>
              ))}
            </div>
            <p className="text-xs text-blue-600 mt-2">
              위 지점은 admin 계정에서 직접 보고 관리를 수행합니다.
            </p>
          </div>
        </div>
      )}

      {/* ── Tab 2: 기존 Firebase 계정 ────────────────────────────────────────── */}
      {tab === "existing" && (
        <div className="space-y-4">
          {users.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">
              등록된 사용자가 없습니다
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
              <table className="w-full text-sm min-w-[600px]">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {["이름", "이메일", "역할", "상태", "담당 지점", "가입일", "액션"].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {users.map((u) => (
                    <tr key={u.uid} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{u.name || "-"}</td>
                      <td className="px-4 py-3 text-gray-600">{u.email}</td>
                      <td className="px-4 py-3 text-xs">
                        {u.role === "admin" ? "관리자" : "지점장"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "inline-flex px-2 py-0.5 rounded-full text-xs font-medium",
                            u.status === "active"
                              ? "bg-green-100 text-green-700"
                              : u.status === "suspended"
                              ? "bg-red-100 text-red-700"
                              : "bg-yellow-100 text-yellow-700"
                          )}
                        >
                          {u.status === "active"
                            ? "활성"
                            : u.status === "suspended"
                            ? "정지"
                            : "승인대기"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {u.branchIds.length > 0
                          ? u.branchIds
                              .map((id) => branches.find((b) => b.id === id)?.name ?? id)
                              .join(", ")
                          : "-"}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">
                        {u.createdAt
                          ? formatDate(u.createdAt.toDate().toISOString().slice(0, 10))
                          : "-"}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => openEditUser(u)}
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
                        >
                          <EditIcon className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Preview Modal ─────────────────────────────────────────────────────── */}
      {showPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowPreview(false)}
          />
          <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-md space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">계정 생성 준비 확인</h3>
              <button
                onClick={() => setShowPreview(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XIcon className="w-4 h-4" />
              </button>
            </div>

            <div className="divide-y divide-gray-100">
              <PreviewRow label="전체 담당자 수" value={`${preview.total}명`} />
              <PreviewRow
                label="이메일 입력 완료"
                value={`${preview.withEmail}명`}
                color="green"
              />
              <PreviewRow
                label="이메일 누락"
                value={`${preview.withoutEmail}명`}
                color={preview.withoutEmail > 0 ? "red" : undefined}
              />
              <PreviewRow label="기존 계정 (이미 존재)" value={`${preview.existingAccount}명`} />
              <PreviewRow
                label="신규 계정 생성 예정"
                value={`${preview.newAccount}명`}
                color="blue"
              />
              <PreviewRow
                label="지점 연결 예정"
                value={`${preview.branchConnections}건`}
                color="blue"
              />
              <PreviewRow
                label="오류 (지점명 불일치)"
                value={`${preview.errors}건`}
                color={preview.errors > 0 ? "red" : undefined}
              />
            </div>

            {preview.errorDetails.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-1">
                <p className="text-xs font-medium text-red-700">지점명 불일치 목록</p>
                {preview.errorDetails.map((d, i) => (
                  <p key={i} className="text-xs text-red-600">
                    • {d}
                  </p>
                ))}
              </div>
            )}

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-800">
              ⚠️ 실제 계정은 아직 생성되지 않습니다. 이메일을 모두 입력한 후 계정 생성 단계를 진행하세요.
            </div>

            <button
              onClick={() => setShowPreview(false)}
              className="w-full py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {/* ── Existing user edit modal ──────────────────────────────────────────── */}
      {editUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setEditUser(null)}
          />
          <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-md space-y-4">
            <h3 className="font-semibold text-gray-900">사용자 수정</h3>

            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">이름</label>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">역할</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as UserRole)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                >
                  <option value="branch_manager">지점장</option>
                  <option value="admin">관리자</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">상태</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as UserStatus)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                >
                  <option value="pending">승인대기</option>
                  <option value="active">활성</option>
                  <option value="suspended">정지</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-700 block mb-2">담당 지점</label>
              <div
                className={cn(
                  "max-h-40 overflow-y-auto space-y-1 border border-gray-200 rounded-lg p-2",
                  editRole === "admin" ? "opacity-50 pointer-events-none" : ""
                )}
              >
                {branches.map((b) => (
                  <label
                    key={b.id}
                    className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 rounded p-1"
                  >
                    <input
                      type="checkbox"
                      checked={editBranchIds.includes(b.id)}
                      onChange={() => toggleBranch(b.id)}
                      className="rounded"
                    />
                    {b.name}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setEditUser(null)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={saveEditUser}
                disabled={editSaving}
                className="px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304f] disabled:opacity-50"
              >
                {editSaving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
        active
          ? "border-[#1e3a5f] text-[#1e3a5f]"
          : "border-transparent text-gray-500 hover:text-gray-700"
      )}
    >
      {label}
    </button>
  );
}

function StatCard({
  label,
  value,
  colorClass,
}: {
  label: string;
  value: number;
  colorClass: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={cn("text-2xl font-bold", colorClass)}>{value}</p>
    </div>
  );
}

function PreviewRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: "green" | "red" | "blue";
}) {
  return (
    <div className="flex justify-between items-center py-2">
      <span className="text-sm text-gray-600">{label}</span>
      <span
        className={cn(
          "font-semibold text-sm",
          color === "green"
            ? "text-green-600"
            : color === "red"
            ? "text-red-600"
            : color === "blue"
            ? "text-blue-600"
            : "text-gray-900"
        )}
      >
        {value}
      </span>
    </div>
  );
}
