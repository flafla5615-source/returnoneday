"use client";

import { useEffect, useState } from "react";
import {
  getAllCampaigns,
  createCampaign,
  updateCampaign,
} from "@/services/campaigns";
import { getAllBranches } from "@/services/branches";
import LoadingState from "@/components/common/LoadingState";
import EmptyState from "@/components/common/EmptyState";
import PrintButton from "@/components/print/PrintButton";
import PrintHeader from "@/components/print/PrintHeader";
import PrintableSection from "@/components/print/PrintableSection";
import { formatDate } from "@/lib/utils";
import type { Campaign, Branch, MetricDefinition, CampaignStatus } from "@/types";
import { PlusIcon, EditIcon, TrashIcon } from "lucide-react";
import { Timestamp } from "firebase/firestore";

const statusLabel: Record<CampaignStatus, string> = { draft: "초안", active: "진행중", ended: "종료" };
const statusColor: Record<CampaignStatus, string> = {
  draft: "bg-gray-100 text-gray-600",
  active: "bg-green-100 text-green-700",
  ended: "bg-gray-200 text-gray-500",
};

const emptyForm = {
  name: "",
  description: "",
  startDate: "",
  endDate: "",
  targetBranchIds: [] as string[],
  status: "draft" as CampaignStatus,
  metricDefinitions: [] as MetricDefinition[],
};

export default function AdminCampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editCampaign, setEditCampaign] = useState<Campaign | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [newMetricKey, setNewMetricKey] = useState("");
  const [newMetricLabel, setNewMetricLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [printSections, setPrintSections] = useState<string[]>(["campaigns"]);

  useEffect(() => {
    Promise.all([getAllCampaigns(), getAllBranches()]).then(([cs, bs]) => {
      setCampaigns(cs);
      setBranches(bs);
      setLoading(false);
    });
  }, []);

  function openCreate() {
    setEditCampaign(null);
    setForm({ ...emptyForm });
    setModalOpen(true);
  }

  function openEdit(c: Campaign) {
    setEditCampaign(c);
    setForm({
      name: c.name,
      description: c.description ?? "",
      startDate: c.startDate,
      endDate: c.endDate,
      targetBranchIds: c.targetBranchIds,
      status: c.status,
      metricDefinitions: c.metricDefinitions,
    });
    setModalOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    if (editCampaign) {
      await updateCampaign(editCampaign.id, form);
      setCampaigns((prev) => prev.map((c) => c.id === editCampaign.id ? { ...c, ...form } : c));
    } else {
      const now = Timestamp.now();
      const id = await createCampaign({ ...form, createdAt: now, updatedAt: now } as Omit<Campaign, "id">);
      setCampaigns((prev) => [{ id, ...form, createdAt: now, updatedAt: now }, ...prev]);
    }
    setModalOpen(false);
    setSaving(false);
  }

  function toggleBranch(id: string) {
    setForm((f) => ({
      ...f,
      targetBranchIds: f.targetBranchIds.includes(id)
        ? f.targetBranchIds.filter((x) => x !== id)
        : [...f.targetBranchIds, id],
    }));
  }

  function addMetric() {
    if (!newMetricKey || !newMetricLabel) return;
    setForm((f) => ({
      ...f,
      metricDefinitions: [...f.metricDefinitions, { key: newMetricKey, label: newMetricLabel }],
    }));
    setNewMetricKey("");
    setNewMetricLabel("");
  }

  function removeMetric(key: string) {
    setForm((f) => ({ ...f, metricDefinitions: f.metricDefinitions.filter((m) => m.key !== key) }));
  }

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4">
      <PrintHeader title="캠페인 실적 현황" />

      <div className="flex items-center justify-between gap-2">
        <h1 className="text-base font-bold text-gray-900">캠페인 관리</h1>
        <div className="flex items-center gap-2">
          <PrintButton
            sections={[{ key: "campaigns", label: "캠페인 실적" }]}
            selectedSections={printSections}
            onSelectionChange={setPrintSections}
          />
          <button onClick={openCreate} className="no-print flex items-center gap-1.5 px-3 py-2 bg-[#1e3a5f] text-white text-sm rounded-lg hover:bg-[#16304f]">
            <PlusIcon className="w-4 h-4" />
            캠페인 추가
          </button>
        </div>
      </div>

      <PrintableSection sectionKey="campaigns" selectedSections={printSections}>
      {campaigns.length === 0 ? <EmptyState title="등록된 캠페인이 없습니다" /> : (
        <div className="space-y-3">
          {campaigns.map((c) => (
            <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-medium text-gray-900 text-sm">{c.name}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor[c.status]}`}>{statusLabel[c.status]}</span>
                  </div>
                  <p className="text-xs text-gray-400">기간: {formatDate(c.startDate)} ~ {formatDate(c.endDate)}</p>
                  {c.metricDefinitions.length > 0 && (
                    <p className="text-xs text-gray-400 mt-0.5">측정 지표: {c.metricDefinitions.map((m) => m.label).join(", ")}</p>
                  )}
                </div>
                <button onClick={() => openEdit(c)} className="p-1.5 rounded hover:bg-gray-100 text-gray-500">
                  <EditIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      </PrintableSection>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto py-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setModalOpen(false)} />
          <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-lg mx-4 space-y-4 my-auto">
            <h3 className="font-semibold text-gray-900">{editCampaign ? "캠페인 수정" : "캠페인 추가"}</h3>

            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">캠페인명</label>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">시작일</label>
                <input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">종료일</label>
                <input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">상태</label>
              <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as CampaignStatus }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500">
                <option value="draft">초안</option>
                <option value="active">진행중</option>
                <option value="ended">종료</option>
              </select>
            </div>

            {/* Metrics */}
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-2">측정 지표</label>
              <div className="space-y-1 mb-2">
                {form.metricDefinitions.map((m) => (
                  <div key={m.key} className="flex items-center justify-between text-xs bg-gray-50 rounded px-2 py-1">
                    <span>{m.label} ({m.key})</span>
                    <button onClick={() => removeMetric(m.key)} className="text-red-500 hover:text-red-700">
                      <TrashIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={newMetricKey} onChange={(e) => setNewMetricKey(e.target.value)} placeholder="key (영문)" className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs" />
                <input value={newMetricLabel} onChange={(e) => setNewMetricLabel(e.target.value)} placeholder="표시명" className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs" />
                <button onClick={addMetric} className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs hover:bg-gray-200">추가</button>
              </div>
            </div>

            {/* Branches */}
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-2">대상 지점</label>
              <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
                {branches.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 rounded p-1">
                    <input type="checkbox" checked={form.targetBranchIds.includes(b.id)} onChange={() => toggleBranch(b.id)} className="rounded" />
                    {b.name}
                  </label>
                ))}
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
