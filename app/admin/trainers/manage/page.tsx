"use client";

import { useEffect, useState } from "react";
import { getAllBranches } from "@/services/branches";
import { getAllTrainers, createTrainer, updateTrainer } from "@/services/trainers";
import LoadingState from "@/components/common/LoadingState";
import { cn } from "@/lib/utils";
import type { Branch, Trainer } from "@/types";
import { PlusIcon, EditIcon, SaveIcon, XIcon, CheckCircleIcon, CircleIcon } from "lucide-react";

export default function TrainerManagePage() {
  const [branches, setBranches]   = useState<Branch[]>([]);
  const [trainers, setTrainers]   = useState<Trainer[]>([]);
  const [loading, setLoading]     = useState(true);

  // Add form
  const [showAdd, setShowAdd]         = useState(false);
  const [addName, setAddName]         = useState("");
  const [addBranchIds, setAddBranchIds] = useState<string[]>([]);
  const [addActive, setAddActive]     = useState(true);
  const [addSaving, setAddSaving]     = useState(false);
  const [addError, setAddError]       = useState<string | null>(null);

  // Edit
  const [editId, setEditId]           = useState<string | null>(null);
  const [editName, setEditName]       = useState("");
  const [editBranchIds, setEditBranchIds] = useState<string[]>([]);
  const [editActive, setEditActive]   = useState(true);
  const [editSaving, setEditSaving]   = useState(false);

  // Filter
  const [showInactive, setShowInactive] = useState(false);

  useEffect(() => {
    Promise.all([getAllBranches(), getAllTrainers()]).then(([bs, ts]) => {
      setBranches(bs);
      setTrainers(ts);
      setLoading(false);
    });
  }, []);

  // ── Add ──────────────────────────────────────────────────────────────────────

  function openAdd() {
    setAddName(""); setAddBranchIds([]); setAddActive(true);
    setAddError(null); setShowAdd(true);
  }

  function cancelAdd() {
    setShowAdd(false); setAddError(null);
  }

  async function saveAdd() {
    const name = addName.trim();
    if (!name) { setAddError("트레이너명을 입력하세요"); return; }
    const dup = trainers.find((t) => t.name === name && t.active);
    if (dup) { setAddError("이미 동일한 이름의 활성 트레이너가 있습니다"); return; }

    setAddSaving(true);
    const id = await createTrainer({ name, branchIds: addBranchIds, active: addActive });
    const newTrainer: Trainer = {
      id, name, branchIds: addBranchIds, active: addActive,
      createdAt: null as never, updatedAt: null as never,
    };
    setTrainers((prev) => [...prev, newTrainer]);
    setShowAdd(false);
    setAddSaving(false);
  }

  // ── Edit ─────────────────────────────────────────────────────────────────────

  function openEdit(t: Trainer) {
    setEditId(t.id);
    setEditName(t.name);
    setEditBranchIds(t.branchIds);
    setEditActive(t.active);
  }

  function cancelEdit() { setEditId(null); }

  async function saveEdit() {
    if (!editId) return;
    const name = editName.trim();
    if (!name) return;
    setEditSaving(true);
    await updateTrainer(editId, { name, branchIds: editBranchIds, active: editActive });
    setTrainers((prev) =>
      prev.map((t) =>
        t.id === editId ? { ...t, name, branchIds: editBranchIds, active: editActive } : t
      )
    );
    setEditId(null);
    setEditSaving(false);
  }

  // ── Branch toggle helpers ──────────────────────────────────────────────────

  function toggleAdd(id: string) {
    setAddBranchIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function toggleEdit(id: string) {
    setEditBranchIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  if (loading) return <LoadingState />;

  const displayed = trainers.filter((t) => showInactive || t.active);
  const activeCount = trainers.filter((t) => t.active).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-base font-bold text-gray-900">트레이너 관리</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            활성 {activeCount}명 · 전체 {trainers.length}명
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowInactive((p) => !p)}
            className={cn(
              "px-3 py-1.5 text-xs rounded-lg border transition-colors",
              showInactive
                ? "border-[#1e3a5f] text-[#1e3a5f] bg-white"
                : "border-gray-300 text-gray-600 bg-white hover:bg-gray-50"
            )}
          >
            {showInactive ? "전체 보기" : "활성만 보기"}
          </button>
          <button
            onClick={openAdd}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304f]"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            트레이너 추가
          </button>
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="bg-white rounded-xl border border-[#1e3a5f]/30 shadow-sm p-4 space-y-4">
          <h3 className="text-sm font-semibold text-gray-900">새 트레이너 추가</h3>

          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">트레이너명 *</label>
            <input
              type="text"
              value={addName}
              onChange={(e) => { setAddName(e.target.value); setAddError(null); }}
              placeholder="이름 입력"
              autoFocus
              className={cn(
                "w-full max-w-xs border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]",
                addError ? "border-red-400" : "border-gray-300"
              )}
            />
            {addError && <p className="text-xs text-red-500 mt-1">{addError}</p>}
          </div>

          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">담당 지점</label>
            <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto">
              {branches.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => toggleAdd(b.id)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-xs border transition-colors",
                    addBranchIds.includes(b.id)
                      ? "bg-[#1e3a5f] text-white border-[#1e3a5f]"
                      : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                  )}
                >
                  {b.name}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-700">활성 여부</label>
            <button
              type="button"
              onClick={() => setAddActive((p) => !p)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors",
                addActive
                  ? "bg-green-50 text-green-700 border-green-300"
                  : "bg-gray-50 text-gray-500 border-gray-300"
              )}
            >
              {addActive
                ? <><CheckCircleIcon className="w-3.5 h-3.5" /> 활성</>
                : <><CircleIcon className="w-3.5 h-3.5" /> 비활성</>
              }
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={saveAdd}
              disabled={addSaving}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304f] disabled:opacity-50"
            >
              <SaveIcon className="w-3.5 h-3.5" />
              {addSaving ? "저장 중..." : "저장"}
            </button>
            <button
              onClick={cancelAdd}
              className="flex items-center gap-1.5 px-4 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              <XIcon className="w-3.5 h-3.5" />
              취소
            </button>
          </div>
        </div>
      )}

      {/* Trainer list */}
      {displayed.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          {showInactive ? "등록된 트레이너가 없습니다" : "활성 트레이너가 없습니다"}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {["트레이너명", "담당 지점", "활성 여부", ""].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {displayed.map((t) => {
                const isEditing = editId === t.id;
                const branchNames = t.branchIds
                  .map((id) => branches.find((b) => b.id === id)?.name ?? id)
                  .join(", ");

                if (isEditing) {
                  return (
                    <tr key={t.id} className="bg-blue-50">
                      {/* Name edit */}
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          autoFocus
                          className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-32 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
                        />
                      </td>

                      {/* Branch edit */}
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5 max-w-xs">
                          {branches.map((b) => (
                            <button
                              key={b.id}
                              type="button"
                              onClick={() => toggleEdit(b.id)}
                              className={cn(
                                "px-2 py-0.5 rounded-full text-xs border transition-colors",
                                editBranchIds.includes(b.id)
                                  ? "bg-[#1e3a5f] text-white border-[#1e3a5f]"
                                  : "bg-white text-gray-500 border-gray-300 hover:border-gray-400"
                              )}
                            >
                              {b.name}
                            </button>
                          ))}
                        </div>
                      </td>

                      {/* Active toggle */}
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setEditActive((p) => !p)}
                          className={cn(
                            "flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-colors",
                            editActive
                              ? "bg-green-50 text-green-700 border-green-300"
                              : "bg-gray-50 text-gray-500 border-gray-300"
                          )}
                        >
                          {editActive
                            ? <><CheckCircleIcon className="w-3 h-3" /> 활성</>
                            : <><CircleIcon className="w-3 h-3" /> 비활성</>
                          }
                        </button>
                      </td>

                      {/* Save / Cancel */}
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button
                            onClick={saveEdit}
                            disabled={editSaving}
                            className="p-1.5 rounded bg-[#1e3a5f] text-white hover:bg-[#16304f] disabled:opacity-50"
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
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr key={t.id} className={cn("hover:bg-gray-50", !t.active && "opacity-50")}>
                    <td className="px-4 py-3 font-medium text-gray-900">{t.name}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {branchNames || <span className="italic text-gray-300">미배정</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
                          t.active
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-100 text-gray-500"
                        )}
                      >
                        {t.active ? <CheckCircleIcon className="w-3 h-3" /> : <CircleIcon className="w-3 h-3" />}
                        {t.active ? "활성" : "비활성"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openEdit(t)}
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
                        title="수정"
                      >
                        <EditIcon className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
