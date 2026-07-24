"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { getAllBranches } from "@/services/branches";
import { getAllUsers, updateUserProfileWithBranchAssignments } from "@/services/users";
import { getAllManagerInvites, upsertManagerInvite } from "@/services/managerInvites";
import {
  createBranchAccounts,
  setBranchAccountPassword,
  type BranchAccountCreationMethod,
  type BranchAccountResult,
} from "@/services/branchAccounts";
import { resetPassword } from "@/lib/auth";
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
  KeyRoundIcon,
  LockIcon,
} from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────────────

// 운영 계정은 개인이 아니라 지점 기준으로 생성한다 (지점 1개 = 운영계정 1개).
// 지점장이 바뀌어도 계정은 지점에 귀속되어 유지된다.
// 계정 목록은 branches 컬렉션에서 런타임에 생성 — operationalAccounts 참조.

const HQ_BRANCHES = ["머팩 벌리점", "머팩 보건대점", "머팩 신진주역점", "짐플릭스 시청점"];

const EMAIL_DOMAIN = "returnlife.co.kr";

// branchId 기반 이메일 생성 — 이메일에 쓸 수 없는 문자는 하이픈으로 변환
function branchEmailOf(branchId: string): string {
  const local = branchId
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return `${local}@${EMAIL_DOMAIN}`;
}

type OperationalAccount = {
  key: string;          // branch.id — managerInvites 문서 키
  branchId: string;
  name: string;         // 지점명 (users.name으로 저장될 값)
  brand: string;
  branches: string[];   // 담당 지점명 (기본 1개)
  defaultEmail: string; // {branchId}@returnlife.co.kr
};

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

function validateStrongPassword(password: string): string | null {
  if (
    password.length < 8 ||
    !/[A-Za-z]/.test(password) ||
    !/\d/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    return "비밀번호 조건을 확인해주세요.";
  }
  return null;
}

function validateResetPassword(password: string, confirm: string): string | null {
  if (!password || !confirm) return "비밀번호를 입력해주세요.";
  const strength = validateStrongPassword(password);
  if (strength) return strength;
  if (password !== confirm) return "비밀번호가 일치하지 않습니다.";
  return null;
}

function resetPasswordErrorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code ?? "";
  if (code.includes("permission-denied")) return "권한이 없습니다.";
  if (code.includes("not-found")) return "대상 계정을 찾을 수 없습니다.";
  if (code.includes("failed-precondition")) return "지점 운영계정만 변경할 수 있습니다.";
  if (code.includes("invalid-argument")) return "비밀번호 조건을 확인해주세요.";
  if (code.includes("unauthenticated")) return "다시 로그인 후 시도해주세요.";
  return "잠시 후 다시 시도해주세요.";
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

  // Branch account creation
  const [creationMethod, setCreationMethod] =
    useState<BranchAccountCreationMethod>("temporary_password");
  const [initialPassword, setInitialPassword] = useState("");
  const [initialPasswordConfirm, setInitialPasswordConfirm] = useState("");
  const [creatingAccounts, setCreatingAccounts] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createResults, setCreateResults] = useState<BranchAccountResult[]>([]);
  // 실수로 전 지점 계정이 한 번에 생성되지 않도록 기본값은 전체 미선택 —
  // 체크한 지점만 "계정 생성"에 포함된다.
  const [selectedForCreation, setSelectedForCreation] = useState<string[]>([]);

  // CSV upload
  const csvRef = useRef<HTMLInputElement>(null);

  // Existing user edit modal
  const [editUser, setEditUser] = useState<UserProfile | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<UserRole>("branch_manager");
  const [editStatus, setEditStatus] = useState<UserStatus>("pending");
  const [editBranchIds, setEditBranchIds] = useState<string[]>([]);
  const [editSaving, setEditSaving] = useState(false);

  // Branch account password reset (admin 전용)
  const [pwTarget, setPwTarget] = useState<{ uid: string; email: string; branchName: string } | null>(null);
  const [pwValue, setPwValue] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwSuccessNotice, setPwSuccessNotice] = useState<string | null>(null);

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

  // 지점 1개 = 운영계정 1개. HQ 직접 관리 지점은 별도 계정을 만들지 않는다.
  const operationalAccounts = useMemo<OperationalAccount[]>(
    () =>
      branches
        .filter((b) => !HQ_BRANCHES.includes(b.name))
        .map((b) => ({
          key: b.id,
          branchId: b.id,
          name: b.name,
          brand: b.brand,
          branches: [b.name],
          defaultEmail: branchEmailOf(b.id),
        })),
    [branches]
  );

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
    const rows: string[][] = [["지점명", "브랜드", "branchId", "이메일", "계정상태"]];
    operationalAccounts.forEach(({ key, name, brand, branchId }) => {
      const email = invites[key]?.email ?? "";
      const status = deriveStatus(email, email ? emailToUser[email] : undefined);
      rows.push([name, brand, branchId, email, STATUS_LABEL[status]]);
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
    const lines = text.split(/\r?\n/).filter(Boolean);
    const header = lines[0]
      ?.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
      .map((p) => p.replace(/^"|"$/g, "").trim());
    const branchNameIndex = header?.findIndex((h) => h === "지점명") ?? 0;
    const branchIdIndex = header?.findIndex((h) => h === "branchId") ?? -1;
    const emailIndex = header?.findIndex((h) => h === "이메일") ?? 1;

    for (const line of lines.slice(1)) {
      // Split by commas outside quotes
      const parts = line
        .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
        .map((p) => p.replace(/^"|"$/g, "").trim());
      const csvName = parts[branchNameIndex] ?? "";
      const csvBranchId = branchIdIndex >= 0 ? parts[branchIdIndex] : "";
      const csvEmail = parts[emailIndex] ?? "";
      if (!csvName) continue;

      const assignment = operationalAccounts.find(
        (m) => m.name === csvName || (csvBranchId && m.branchId === csvBranchId)
      );
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
    operationalAccounts.forEach(({ key }) => {
      const email = invites[key]?.email?.trim() ?? "";
      if (email) {
        withEmail++;
        if (emailToUser[email]) existingAccount++;
      } else {
        withoutEmail++;
      }
    });
    return {
      total: operationalAccounts.length,
      withEmail,
      withoutEmail,
      existingAccount,
      newAccount: withEmail - existingAccount,
    };
  }, [operationalAccounts, invites, emailToUser]);

  const preview = useMemo(() => {
    let branchConnections = 0;
    const errorDetails: string[] = [];

    operationalAccounts.forEach(({ key, name, branches: bNames }) => {
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
  }, [stats, operationalAccounts, invites, emailToUser, branchNameToId]);

  const accountCreationTargets = useMemo(
    () =>
      operationalAccounts
        .map((acc) => ({
          ...acc,
          email: invites[acc.key]?.email?.trim() ?? "",
        }))
        .filter((acc) => acc.email && selectedForCreation.includes(acc.key)),
    [operationalAccounts, invites, selectedForCreation]
  );

  const passwordError = useMemo(() => {
    if (creationMethod !== "temporary_password") return null;
    const strength = validateStrongPassword(initialPassword);
    if (strength) return strength;
    if (initialPassword !== initialPasswordConfirm) {
      return "비밀번호가 일치하지 않습니다.";
    }
    return null;
  }, [creationMethod, initialPassword, initialPasswordConfirm]);

  async function refreshUserData() {
    const [us, inv] = await Promise.all([getAllUsers(), getAllManagerInvites()]);
    setUsers(us);
    setInvites(inv);
  }

  async function handleCreateBranchAccounts() {
    if (accountCreationTargets.length === 0) {
      setCreateError("생성할 지점을 표에서 선택하고, 이메일이 입력되어 있는지 확인해주세요.");
      return;
    }
    if (passwordError) {
      setCreateError(passwordError);
      return;
    }

    setCreatingAccounts(true);
    setCreateError(null);
    setCreateResults([]);

    try {
      const results = await createBranchAccounts({
        method: creationMethod,
        password: creationMethod === "temporary_password" ? initialPassword : undefined,
        accounts: accountCreationTargets.map((acc) => ({
          branchId: acc.branchId,
          branchName: acc.name,
          email: acc.email,
        })),
      });

      const nextResults: BranchAccountResult[] = [];
      for (const result of results) {
        if (creationMethod !== "reset_email" || result.status === "failed") {
          nextResults.push(result);
          continue;
        }

        try {
          await resetPassword(result.email);
          nextResults.push({
            ...result,
            resetEmailSent: true,
            message: `${result.message ?? ""} 비밀번호 재설정 메일을 발송했습니다.`.trim(),
          });
        } catch {
          nextResults.push({
            ...result,
            resetEmailSent: false,
            message: `${result.message ?? ""} 비밀번호 재설정 메일 발송에 실패했습니다.`.trim(),
          });
        }
      }

      setCreateResults(nextResults);
      await refreshUserData();
      setShowPreview(false);
      setSelectedForCreation([]);
    } catch (error) {
      console.error("[AdminUsers] create branch accounts failed", error);
      const message = (error as { message?: string }).message;
      setCreateError(message || "계정 생성 중 오류가 발생했습니다.");
    } finally {
      setCreatingAccounts(false);
    }
  }

  // 이메일이 비어 있는 운영계정에 {branchId}@returnlife.co.kr 기본 이메일을 일괄 적용
  const [bulkApplying, setBulkApplying] = useState(false);

  async function applyDefaultEmails() {
    setBulkApplying(true);
    try {
      for (const acc of operationalAccounts) {
        const current = invites[acc.key]?.email?.trim() ?? "";
        if (current) continue;
        const email = acc.defaultEmail;
        if (emailToUser[email]) continue; // 기존 계정과 충돌하면 건너뜀
        const status = deriveStatus(email, undefined);
        await upsertManagerInvite(acc.key, {
          name: acc.name,
          email,
          branchIds: [acc.key],
          status,
        });
        setInvites((prev) => ({
          ...prev,
          [acc.key]: { ...prev[acc.key], name: acc.name, email, branchIds: [acc.key], status },
        }));
      }
    } finally {
      setBulkApplying(false);
    }
  }

  // ── Existing user edit ─────────────────────────────────────────────────────

  function openEditUser(u: UserProfile) {
    setEditUser(u);
    setEditName(u.name);
    setEditRole(u.role);
    setEditStatus(u.status);
    setEditBranchIds(u.branchIds ?? []);
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

  // ── Branch account password reset ──────────────────────────────────────────

  function openPasswordModal(target: { uid: string; email: string; branchName: string }) {
    setPwTarget(target);
    setPwValue("");
    setPwConfirm("");
    setPwError(null);
  }

  function closePasswordModal() {
    setPwTarget(null);
    setPwValue("");
    setPwConfirm("");
    setPwError(null);
  }

  async function submitPasswordReset() {
    if (!pwTarget) return;
    const validationError = validateResetPassword(pwValue, pwConfirm);
    if (validationError) {
      setPwError(validationError);
      return;
    }

    setPwSaving(true);
    setPwError(null);
    try {
      await setBranchAccountPassword({
        targetUid: pwTarget.uid,
        newPassword: pwValue,
      });
      closePasswordModal();
      setPwSuccessNotice("비밀번호가 변경되었습니다.");
      setTimeout(() => setPwSuccessNotice(null), 4000);
    } catch (error) {
      console.error("[AdminUsers] password reset failed", error);
      setPwError(resetPasswordErrorMessage(error));
    } finally {
      setPwSaving(false);
    }
  }

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4">
      {/* Header */}
      <h1 className="text-base font-bold text-gray-900">사용자 관리</h1>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        <TabButton
          label={`지점 운영계정 준비 (${operationalAccounts.length})`}
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
            <StatCard label="전체 운영계정" value={stats.total} colorClass="text-blue-600" />
            <StatCard label="이메일 입력 완료" value={stats.withEmail} colorClass="text-green-600" />
            <StatCard label="이메일 누락" value={stats.withoutEmail} colorClass="text-yellow-600" />
            <StatCard label="기존 계정" value={stats.existingAccount} colorClass="text-purple-600" />
          </div>

          {/* Action buttons */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">계정 생성 방식</h2>
              <p className="text-xs text-gray-500 mt-1">
                비밀번호는 계정 생성 시에만 사용하며 Firestore에 저장하지 않습니다.
              </p>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <label
                className={cn(
                  "border rounded-lg p-3 cursor-pointer transition-colors",
                  creationMethod === "temporary_password"
                    ? "border-[#1e3a5f] bg-blue-50"
                    : "border-gray-200 bg-white hover:bg-gray-50"
                )}
              >
                <input
                  type="radio"
                  name="creationMethod"
                  value="temporary_password"
                  checked={creationMethod === "temporary_password"}
                  onChange={() => setCreationMethod("temporary_password")}
                  className="sr-only"
                />
                <span className="text-sm font-medium text-gray-900">관리자가 초기 비밀번호 직접 설정</span>
                <span className="block text-xs text-gray-500 mt-1">
                  생성 후 최초 로그인 시 비밀번호 변경을 요구합니다.
                </span>
              </label>
              <label
                className={cn(
                  "border rounded-lg p-3 cursor-pointer transition-colors",
                  creationMethod === "reset_email"
                    ? "border-[#1e3a5f] bg-blue-50"
                    : "border-gray-200 bg-white hover:bg-gray-50"
                )}
              >
                <input
                  type="radio"
                  name="creationMethod"
                  value="reset_email"
                  checked={creationMethod === "reset_email"}
                  onChange={() => setCreationMethod("reset_email")}
                  className="sr-only"
                />
                <span className="text-sm font-medium text-gray-900">비밀번호 재설정 메일 발송</span>
                <span className="block text-xs text-gray-500 mt-1">
                  해당 이메일을 실제로 수신할 수 있어야 비밀번호 재설정 메일을 받을 수 있습니다.
                </span>
              </label>
            </div>

            {creationMethod === "temporary_password" && (
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-700 block mb-1">초기 비밀번호</label>
                  <input
                    type="password"
                    value={initialPassword}
                    onChange={(e) => setInitialPassword(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                    autoComplete="new-password"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700 block mb-1">초기 비밀번호 확인</label>
                  <input
                    type="password"
                    value={initialPasswordConfirm}
                    onChange={(e) => setInitialPasswordConfirm(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                    autoComplete="new-password"
                  />
                </div>
                <p className="md:col-span-2 text-xs text-gray-500">
                  초기 비밀번호는 계정 생성 시에만 사용되며 저장되지 않습니다. 생성 후 지점 담당자에게 별도로 전달해주세요.
                </p>
                {passwordError && (initialPassword || initialPasswordConfirm) && (
                  <p className="md:col-span-2 text-xs text-red-600">{passwordError}</p>
                )}
              </div>
            )}

            {createError && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                {createError}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={applyDefaultEmails}
              disabled={bulkApplying}
              className="flex items-center gap-1.5 px-3 py-2 text-xs border border-[#1e3a5f] text-[#1e3a5f] rounded-lg hover:bg-[#1e3a5f]/5 disabled:opacity-50"
            >
              <CheckCircleIcon className="w-3.5 h-3.5" />
              {bulkApplying ? "적용 중..." : "기본 이메일 일괄 적용"}
            </button>
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
              계정 생성 확인 ({selectedForCreation.length}개 선택)
            </button>
          </div>

          {createResults.length > 0 && (
            <CreationResultsTable results={createResults} />
          )}

          {pwSuccessNotice && (
            <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              {pwSuccessNotice}
            </p>
          )}

          {/* Manager table */}
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <button
              onClick={() =>
                setSelectedForCreation(
                  operationalAccounts
                    .filter((acc) => (invites[acc.key]?.email ?? "").trim())
                    .map((acc) => acc.key)
                )
              }
              className="px-2.5 py-1 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              전체 선택
            </button>
            <button
              onClick={() => setSelectedForCreation([])}
              className="px-2.5 py-1 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              전체 해제
            </button>
            <span>선택됨: {selectedForCreation.length}개 지점</span>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left">
                    <span className="sr-only">선택</span>
                  </th>
                  {["운영 계정 (지점명)", "이메일", "상태", "담당 지점", "계정 연결", ""].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {operationalAccounts.map(({ key, name, branches: bNames }) => {
                  const invite = invites[key];
                  const email = invite?.email ?? "";
                  const isEditing = editingKey === key;
                  const matchedUser = email ? emailToUser[email] : undefined;
                  const statusKey = deriveStatus(email, matchedUser);
                  const unresolved = bNames.filter((n) => !branchNameToId[n]);
                  const resolved = bNames.filter((n) => branchNameToId[n]);

                  return (
                    <tr key={key} className="hover:bg-gray-50">
                      {/* Select for creation */}
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedForCreation.includes(key)}
                          disabled={!email}
                          title={!email ? "이메일을 먼저 입력해주세요" : undefined}
                          onChange={(e) =>
                            setSelectedForCreation((prev) =>
                              e.target.checked ? [...prev, key] : prev.filter((k) => k !== key)
                            )
                          }
                          className="rounded border-gray-300 disabled:opacity-30"
                        />
                      </td>

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
                          <div className="flex gap-1">
                            <button
                              onClick={() => startEdit(key)}
                              className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
                              title="이메일 수정"
                            >
                              <EditIcon className="w-3.5 h-3.5" />
                            </button>
                            {matchedUser && matchedUser.role === "branch_manager" && (
                              <button
                                onClick={() =>
                                  openPasswordModal({ uid: matchedUser.uid, email, branchName: name })
                                }
                                className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
                                title="비밀번호 재설정"
                              >
                                <KeyRoundIcon className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
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
            <p className="text-xs text-blue-600 mt-1">
              비밀번호는 코드·Firestore에 저장하지 않습니다. 초기 비밀번호 방식은 생성 시에만
              Firebase Auth로 전달하고, 재설정 메일 방식은 실제 수신 가능한 이메일이 필요합니다.
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
                        {u.role === "admin"
                          ? "전 지점"
                          : (u.branchIds ?? []).length > 0
                            ? (u.branchIds ?? [])
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
              <h3 className="font-semibold text-gray-900">계정 생성 확인</h3>
              <button
                onClick={() => setShowPreview(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XIcon className="w-4 h-4" />
              </button>
            </div>

            <div className="divide-y divide-gray-100">
              <PreviewRow label="전체 운영계정 수" value={`${preview.total}개`} />
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

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-1">
              <p className="text-xs font-medium text-blue-800">
                이번에 실제로 생성/연결될 지점 ({accountCreationTargets.length}개)
              </p>
              {accountCreationTargets.length === 0 ? (
                <p className="text-xs text-blue-600">
                  선택된 지점이 없습니다. 표에서 체크박스로 지점을 선택해주세요.
                </p>
              ) : (
                <p className="text-xs text-blue-700">
                  {accountCreationTargets.map((t) => t.name).join(", ")}
                </p>
              )}
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-800">
              {creationMethod === "temporary_password"
                ? "초기 비밀번호 값은 저장되지 않으며, 생성 후 결과 화면에도 표시하지 않습니다."
                : "재설정 메일 방식은 해당 이메일을 실제로 수신할 수 있어야 합니다."}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowPreview(false)}
                className="flex-1 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
              >
                닫기
              </button>
              <button
                onClick={handleCreateBranchAccounts}
                disabled={
                  creatingAccounts ||
                  accountCreationTargets.length === 0 ||
                  (creationMethod === "temporary_password" && !!passwordError)
                }
                className="flex-1 py-2 bg-[#1e3a5f] text-white rounded-lg text-sm hover:bg-[#16304f] disabled:opacity-50"
              >
                {creatingAccounts ? "생성 중..." : "계정 생성"}
              </button>
            </div>
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

      {/* ── 지점 운영계정 비밀번호 변경 모달 (admin 전용) ──────────────────────── */}
      {pwTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={closePasswordModal} />
          <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-md space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <LockIcon className="w-4 h-4 text-gray-500" />
                지점 운영계정 비밀번호 설정
              </h3>
              <button onClick={closePasswordModal} className="text-gray-400 hover:text-gray-600">
                <XIcon className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-gray-50 rounded-lg p-3 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">지점명</span>
                <span className="text-gray-900 font-medium">{pwTarget.branchName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">운영계정 이메일</span>
                <span className="text-gray-900 font-medium">{pwTarget.email}</span>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">새 비밀번호</label>
              <input
                type="password"
                value={pwValue}
                onChange={(e) => { setPwValue(e.target.value); setPwError(null); }}
                autoComplete="new-password"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">새 비밀번호 확인</label>
              <input
                type="password"
                value={pwConfirm}
                onChange={(e) => { setPwConfirm(e.target.value); setPwError(null); }}
                autoComplete="new-password"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
              />
            </div>

            <p className="text-xs text-gray-500">
              비밀번호는 8자 이상이며 영문, 숫자, 특수문자를 각각 1개 이상 포함해야 합니다.
            </p>
            <p className="text-xs text-gray-400">
              비밀번호는 본사에서 관리하며 저장되지 않습니다. 변경 후 지점 담당자에게 별도로 전달해주세요.
            </p>

            {pwError && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{pwError}</p>
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={closePasswordModal}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={submitPasswordReset}
                disabled={pwSaving}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304f] disabled:opacity-50"
              >
                <KeyRoundIcon className="w-3.5 h-3.5" />
                {pwSaving ? "변경 중..." : "비밀번호 변경"}
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

function CreationResultsTable({ results }: { results: BranchAccountResult[] }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
      <div className="px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">계정 생성 결과</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          초기 비밀번호 값은 다시 표시하지 않습니다.
        </p>
      </div>
      <table className="w-full text-sm min-w-[820px]">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            {[
              "지점명",
              "이메일",
              "생성 상태",
              "users 문서",
              "branches.managerUids",
              "초기 비밀번호",
              "메시지",
            ].map((header) => (
              <th key={header} className="px-4 py-3 text-left text-xs font-medium text-gray-500">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {results.map((result) => (
            <tr key={`${result.branchId}-${result.email}`} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-medium text-gray-900">{result.branchName}</td>
              <td className="px-4 py-3 text-gray-600">{result.email}</td>
              <td className="px-4 py-3">
                <span
                  className={cn(
                    "inline-flex px-2 py-0.5 rounded-full text-xs font-medium",
                    result.status === "failed"
                      ? "bg-red-100 text-red-700"
                      : result.status === "created"
                      ? "bg-green-100 text-green-700"
                      : "bg-blue-100 text-blue-700"
                  )}
                >
                  {result.status === "created"
                    ? "신규 생성"
                    : result.status === "linked_existing"
                    ? "기존 계정 연결"
                    : "실패"}
                </span>
              </td>
              <td className="px-4 py-3 text-xs">
                {result.userDocumentLinked ? "연결됨" : "미연결"}
              </td>
              <td className="px-4 py-3 text-xs">
                {result.branchManagerUidsLinked ? "연결됨" : "미연결"}
              </td>
              <td className="px-4 py-3 text-xs">
                {result.initialPasswordSet ? "설정됨" : "미설정"}
              </td>
              <td className="px-4 py-3 text-xs text-gray-500 max-w-[260px]">
                {result.message ?? "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
