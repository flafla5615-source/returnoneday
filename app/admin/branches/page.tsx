"use client";

import { useEffect, useState } from "react";
import {
  getAllBranchesIncludingInactive,
  createBranch,
  updateBranch,
} from "@/services/branches";
import LoadingState from "@/components/common/LoadingState";
import EmptyState from "@/components/common/EmptyState";
import type { Branch } from "@/types";
import { PlusIcon, EditIcon } from "lucide-react";
import { Timestamp } from "firebase/firestore";

const emptyBranch = {
  name: "",
  brand: "",
  region: "",
  active: true,
  managerUids: [] as string[],
  sortOrder: 0,
};

export default function AdminBranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editBranch, setEditBranch] = useState<Branch | null>(null);
  const [form, setForm] = useState(emptyBranch);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getAllBranchesIncludingInactive().then((bs) => {
      setBranches(bs);
      setLoading(false);
    });
  }, []);

  function openCreate() {
    setEditBranch(null);
    setForm({ ...emptyBranch, sortOrder: branches.length });
    setModalOpen(true);
  }

  function openEdit(b: Branch) {
    setEditBranch(b);
    setForm({ name: b.name, brand: b.brand, region: b.region, active: b.active, managerUids: b.managerUids, sortOrder: b.sortOrder });
    setModalOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    if (editBranch) {
      await updateBranch(editBranch.id, form);
      setBranches((prev) => prev.map((b) => b.id === editBranch.id ? { ...b, ...form } : b));
    } else {
      const now = Timestamp.now();
      const id = await createBranch({ ...form, createdAt: now, updatedAt: now } as Omit<Branch, "id">);
      const newBranch: Branch = { id, ...form, createdAt: now, updatedAt: now };
      setBranches((prev) => [...prev, newBranch]);
    }
    setModalOpen(false);
    setSaving(false);
  }

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-bold text-gray-900">지점 관리</h1>
        <button onClick={openCreate} className="flex items-center gap-1.5 px-3 py-2 bg-[#1e3a5f] text-white text-sm rounded-lg hover:bg-[#16304f]">
          <PlusIcon className="w-4 h-4" />
          지점 추가
        </button>
      </div>

      {branches.length === 0 ? <EmptyState title="등록된 지점이 없습니다" /> : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {["지점명", "브랜드", "지역", "상태", "순서", "액션"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {branches.map((b) => (
                <tr key={b.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{b.name}</td>
                  <td className="px-4 py-3 text-gray-600">{b.brand}</td>
                  <td className="px-4 py-3 text-gray-600">{b.region}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${b.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                      {b.active ? "활성" : "비활성"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{b.sortOrder}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => openEdit(b)} className="p-1.5 rounded hover:bg-gray-100 text-gray-500">
                      <EditIcon className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setModalOpen(false)} />
          <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4 space-y-4">
            <h3 className="font-semibold text-gray-900">{editBranch ? "지점 수정" : "지점 추가"}</h3>

            {[
              { label: "지점명", key: "name" as const },
              { label: "브랜드", key: "brand" as const },
              { label: "지역", key: "region" as const },
            ].map(({ label, key }) => (
              <div key={key}>
                <label className="text-xs font-medium text-gray-700 block mb-1">{label}</label>
                <input
                  value={form[key] as string}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
            ))}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">정렬 순서</label>
                <input type="number" value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: parseInt(e.target.value) || 0 }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">상태</label>
                <select value={form.active ? "active" : "inactive"} onChange={(e) => setForm((f) => ({ ...f, active: e.target.value === "active" }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500">
                  <option value="active">활성</option>
                  <option value="inactive">비활성</option>
                </select>
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">취소</button>
              <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304f] disabled:opacity-50">
                {saving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
