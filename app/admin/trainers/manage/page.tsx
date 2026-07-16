"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format, startOfMonth } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { getAllBranchesIncludingInactive } from "@/services/branches";
import { getAllTrainers, updateTrainer } from "@/services/trainers";
import { getAllTrainerSessionsByPeriod } from "@/services/trainerSessions";
import TrainerRegisterModal from "@/components/trainers/TrainerRegisterModal";
import LoadingState from "@/components/common/LoadingState";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { cn, todayYMD } from "@/lib/utils";
import type { Branch, Trainer, TrainerSession } from "@/types";
import {
  PlusIcon,
  EditIcon,
  SaveIcon,
  XIcon,
  CheckCircleIcon,
  CircleIcon,
  SearchIcon,
  AlertTriangleIcon,
  CloudDownloadIcon,
  ClipboardListIcon,
} from "lucide-react";

type ActiveFilter = "all" | "active" | "inactive";

// "김동현1" / "김동현2"처럼 이름 뒤에 숫자를 붙인 과거 시트 관행을 감지한다.
// 자동으로 병합/제거하지 않고 관리자 확인 대상으로만 표시한다.
function isLegacySuffixPattern(name: string, allNames: Set<string>): boolean {
  const m = /^(.+)([12])$/.exec(name);
  if (!m) return false;
  const [, base, digit] = m;
  const otherDigit = digit === "1" ? "2" : "1";
  return allNames.has(base) || allNames.has(`${base}${otherDigit}`);
}

export default function TrainerManagePage() {
  const { profile } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [sessions, setSessions] = useState<TrainerSession[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("active");
  const [addOpen, setAddOpen] = useState(false);

  // Edit
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhoneLast4, setEditPhoneLast4] = useState("");
  const [editIdentifierMemo, setEditIdentifierMemo] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editSaving, setEditSaving] = useState(false);
  const [deactivateConfirmOpen, setDeactivateConfirmOpen] = useState(false);

  const monthFrom = format(startOfMonth(new Date()), "yyyy-MM-dd");
  const today = todayYMD();

  useEffect(() => {
    Promise.all([
      getAllTrainers(),
      getAllBranchesIncludingInactive(),
      getAllTrainerSessionsByPeriod(monthFrom, today),
    ]).then(([ts, bs, sess]) => {
      setTrainers(ts);
      setBranches(bs);
      setSessions(sess.filter((s) => !s.isTestData));
      setLoading(false);
    });
  }, [monthFrom, today]);

  const branchNameOf = useMemo(() => {
    const m = new Map(branches.map((b) => [b.id, b.name]));
    return (id: string) => m.get(id) ?? id;
  }, [branches]);

  // 이번 달 트레이너별 세션 합계 + 활동 지점 (트레이너 문서에는 저장하지 않는 파생값)
  const statsByTrainer = useMemo(() => {
    const map = new Map<string, { total: number; branchIds: Set<string> }>();
    for (const s of sessions) {
      let agg = map.get(s.trainerId);
      if (!agg) {
        agg = { total: 0, branchIds: new Set() };
        map.set(s.trainerId, agg);
      }
      agg.total += s.totalSessionCount ?? 0;
      agg.branchIds.add(s.branchId);
    }
    return map;
  }, [sessions]);

  const nameCounts = useMemo(() => {
    const m = new Map<string, number>();
    trainers.forEach((t) => m.set(t.name, (m.get(t.name) ?? 0) + 1));
    return m;
  }, [trainers]);

  const allNames = useMemo(() => new Set(trainers.map((t) => t.name)), [trainers]);

  const displayed = useMemo(() => {
    const q = search.trim().toLowerCase();
    return trainers
      .filter((t) => (activeFilter === "all" ? true : activeFilter === "active" ? t.active : !t.active))
      .filter((t) => {
        if (!q) return true;
        return (
          t.name.toLowerCase().includes(q) ||
          (t.phoneLast4 ?? "").includes(q) ||
          (t.identifierMemo ?? "").toLowerCase().includes(q)
        );
      });
  }, [trainers, search, activeFilter]);

  const activeCount = trainers.filter((t) => t.active).length;

  function openEdit(t: Trainer) {
    setEditId(t.id);
    setEditName(t.name);
    setEditPhoneLast4(t.phoneLast4 ?? "");
    setEditIdentifierMemo(t.identifierMemo ?? "");
    setEditActive(t.active);
  }

  function cancelEdit() {
    setEditId(null);
  }

  function saveEdit() {
    if (!editId) return;
    if (!editName.trim()) return;
    const original = trainers.find((t) => t.id === editId);
    if (original?.active && !editActive) {
      // 활성 → 비활성 전환만 확인 다이얼로그를 거친다. 완전 삭제 기능은 제공하지 않는다.
      setDeactivateConfirmOpen(true);
      return;
    }
    void doSaveEdit();
  }

  async function doSaveEdit() {
    if (!editId) return;
    const name = editName.trim();
    if (!name) return;
    setEditSaving(true);
    try {
      await updateTrainer(editId, {
        name,
        phoneLast4: editPhoneLast4.trim(),
        identifierMemo: editIdentifierMemo.trim(),
        active: editActive,
      });
      setTrainers((prev) =>
        prev.map((t) =>
          t.id === editId
            ? {
                ...t,
                name,
                phoneLast4: editPhoneLast4.trim() || undefined,
                identifierMemo: editIdentifierMemo.trim() || undefined,
                active: editActive,
              }
            : t
        )
      );
      setEditId(null);
    } finally {
      setEditSaving(false);
      setDeactivateConfirmOpen(false);
    }
  }

  function handleRegistered(trainer: Trainer) {
    setTrainers((prev) =>
      prev.some((t) => t.id === trainer.id) ? prev : [...prev, trainer]
    );
  }

  if (loading) return <LoadingState />;

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
          <Link
            href="/admin/trainers/roster-import"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-[#1e3a5f] text-[#1e3a5f] rounded-lg hover:bg-[#1e3a5f]/5"
          >
            <ClipboardListIcon className="w-3.5 h-3.5" />
            트레이너 명단 일괄 등록
          </Link>
          <Link
            href="/admin/trainers/import"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-[#1e3a5f] text-[#1e3a5f] rounded-lg hover:bg-[#1e3a5f]/5"
          >
            <CloudDownloadIcon className="w-3.5 h-3.5" />
            구글시트 트레이너 불러오기
          </Link>
          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304f]"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            트레이너 추가
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
        트레이너는 전 지점 공용으로 등록됩니다. 특정 지점 소속으로 저장되지 않습니다.
        지점 정보는 트레이너 세션 기록에만 저장됩니다.
      </p>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <SearchIcon className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름·전화번호·메모 검색"
            className="border border-gray-300 rounded-lg pl-8 pr-3 py-1.5 text-xs w-56 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
          />
        </div>
        {(
          [
            { key: "active", label: "활성만" },
            { key: "inactive", label: "비활성만" },
            { key: "all", label: "전체" },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveFilter(key)}
            className={cn(
              "px-3 py-1.5 text-xs rounded-lg border transition-colors",
              activeFilter === key
                ? "border-[#1e3a5f] text-[#1e3a5f] bg-white"
                : "border-gray-300 text-gray-600 bg-white hover:bg-gray-50"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Trainer list */}
      {displayed.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          조건에 맞는 트레이너가 없습니다
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[880px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {[
                  "이름",
                  "전화번호 뒤 4자리",
                  "식별 메모",
                  "최초 등록 지점",
                  "최근 활동 지점 (이번 달)",
                  "이번 달 총 세션",
                  "활성 여부",
                  "",
                ].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {displayed.map((t) => {
                const isEditing = editId === t.id;
                const isDuplicateName = (nameCounts.get(t.name) ?? 0) > 1;
                const isLegacyFlag = isLegacySuffixPattern(t.name, allNames);
                const stats = statsByTrainer.get(t.id);
                const recentBranches = stats
                  ? Array.from(stats.branchIds).map(branchNameOf).join(", ")
                  : "";

                if (isEditing) {
                  return (
                    <tr key={t.id} className="bg-blue-50">
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          autoFocus
                          className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-32 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={4}
                          value={editPhoneLast4}
                          onChange={(e) => setEditPhoneLast4(e.target.value.replace(/[^0-9]/g, ""))}
                          className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-24 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={editIdentifierMemo}
                          onChange={(e) => setEditIdentifierMemo(e.target.value)}
                          className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-32 focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
                        />
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">
                        {t.firstRegisteredBranchId ? branchNameOf(t.firstRegisteredBranchId) : "-"}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">{recentBranches || "-"}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{stats?.total ?? 0}회</td>
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
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {t.name}
                        {isDuplicateName && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700">
                            동명이인 {nameCounts.get(t.name)}명
                          </span>
                        )}
                        {isLegacyFlag && (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-700"
                            title="이름 뒤 숫자가 붙은 과거 시트 패턴으로 보입니다. 자동 병합/삭제되지 않으니 확인해주세요."
                          >
                            <AlertTriangleIcon className="w-2.5 h-2.5" />
                            확인 필요
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{t.phoneLast4 || "-"}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{t.identifierMemo || "-"}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {t.firstRegisteredBranchId ? branchNameOf(t.firstRegisteredBranchId) : "-"}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs max-w-[220px]">
                      {recentBranches || <span className="italic text-gray-300">활동 없음</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-700 text-xs">{stats?.total ?? 0}회</td>
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

      <ConfirmDialog
        open={deactivateConfirmOpen}
        title="이 트레이너를 비활성 처리하시겠습니까?"
        description="기존 세션 기록은 유지되며 신규 세션 입력 목록에서만 제외됩니다."
        confirmLabel="비활성 처리"
        danger
        onConfirm={() => void doSaveEdit()}
        onCancel={() => setDeactivateConfirmOpen(false)}
      />

      {addOpen && (
        <TrainerRegisterModal
          open
          onClose={() => setAddOpen(false)}
          allTrainers={trainers}
          createdBy={profile?.uid ?? ""}
          onRegistered={handleRegistered}
          branchNameOf={branchNameOf}
        />
      )}
    </div>
  );
}
