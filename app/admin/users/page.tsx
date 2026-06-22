"use client";

import { useEffect, useState } from "react";
import { getAllUsers, updateUserProfile, approveUser } from "@/services/users";
import { getAllBranches } from "@/services/branches";
import LoadingState from "@/components/common/LoadingState";
import EmptyState from "@/components/common/EmptyState";
import { formatDate } from "@/lib/utils";
import type { UserProfile, Branch, UserRole, UserStatus } from "@/types";
import { CheckCircleIcon, XCircleIcon, EditIcon } from "lucide-react";

const statusLabel: Record<UserStatus, string> = {
  pending: "승인대기",
  active: "활성",
  suspended: "정지",
};
const statusColor: Record<UserStatus, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  active: "bg-green-100 text-green-700",
  suspended: "bg-red-100 text-red-700",
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [editUser, setEditUser] = useState<UserProfile | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<UserRole>("branch_manager");
  const [editStatus, setEditStatus] = useState<UserStatus>("pending");
  const [editBranchIds, setEditBranchIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([getAllUsers(), getAllBranches()]).then(([us, bs]) => {
      setUsers(us);
      setBranches(bs);
      setLoading(false);
    });
  }, []);

  function openEdit(u: UserProfile) {
    setEditUser(u);
    setEditName(u.name);
    setEditRole(u.role);
    setEditStatus(u.status);
    setEditBranchIds(u.branchIds);
  }

  async function saveEdit() {
    if (!editUser) return;
    setSaving(true);
    await approveUser(editUser.uid, editName, editRole, editBranchIds);
    await updateUserProfile(editUser.uid, { status: editStatus });
    setUsers((prev) =>
      prev.map((u) =>
        u.uid === editUser.uid
          ? { ...u, name: editName, role: editRole, status: editStatus, branchIds: editBranchIds }
          : u
      )
    );
    setEditUser(null);
    setSaving(false);
  }

  function toggleBranch(id: string) {
    setEditBranchIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4">
      <h1 className="text-base font-bold text-gray-900">사용자 관리</h1>

      {users.length === 0 ? <EmptyState title="등록된 사용자가 없습니다" /> : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {["이름", "이메일", "역할", "상태", "담당 지점", "가입일", "액션"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((u) => (
                <tr key={u.uid} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{u.name || "-"}</td>
                  <td className="px-4 py-3 text-gray-600">{u.email}</td>
                  <td className="px-4 py-3 text-xs">{u.role === "admin" ? "관리자" : "지점장"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[u.status]}`}>
                      {statusLabel[u.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {u.branchIds.length > 0
                      ? u.branchIds.map((id) => branches.find((b) => b.id === id)?.name ?? id).join(", ")
                      : "-"}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {u.createdAt ? formatDate(u.createdAt.toDate().toISOString().slice(0, 10)) : "-"}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => openEdit(u)} className="p-1.5 rounded hover:bg-gray-100 text-gray-500">
                      <EditIcon className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit modal */}
      {editUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setEditUser(null)} />
          <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4 space-y-4">
            <h3 className="font-semibold text-gray-900">사용자 수정</h3>

            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">이름</label>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">역할</label>
                <select value={editRole} onChange={(e) => setEditRole(e.target.value as UserRole)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500">
                  <option value="branch_manager">지점장</option>
                  <option value="admin">관리자</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">상태</label>
                <select value={editStatus} onChange={(e) => setEditStatus(e.target.value as UserStatus)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500">
                  <option value="pending">승인대기</option>
                  <option value="active">활성</option>
                  <option value="suspended">정지</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-700 block mb-2">담당 지점</label>
              <div className="max-h-40 overflow-y-auto space-y-1 border border-gray-200 rounded-lg p-2">
                {branches.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 rounded p-1">
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
              <button onClick={() => setEditUser(null)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">취소</button>
              <button onClick={saveEdit} disabled={saving} className="px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304f] disabled:opacity-50">
                {saving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
