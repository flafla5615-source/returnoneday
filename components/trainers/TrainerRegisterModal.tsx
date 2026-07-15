"use client";

import { useState } from "react";
import { createTrainer } from "@/services/trainers";
import { trainerIdentifierLabel, cn } from "@/lib/utils";
import type { Trainer } from "@/types";
import { XIcon, AlertTriangleIcon } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  initialName?: string;
  allTrainers: Trainer[];
  firstRegisteredBranchId?: string;
  createdBy: string;
  onRegistered: (trainer: Trainer) => void;
  branchNameOf?: (id: string) => string;
}

/**
 * 신규 트레이너 등록 모달.
 * 트레이너는 전 지점 공용으로 등록되며, 동일 이름이 있으면 즉시 차단하지 않고
 * 기존 트레이너 선택 / 다른 사람으로 신규 등록 / 취소 중에서 고르게 한다.
 * 이름 + 전화번호 뒤 4자리가 모두 같으면 신규 등록 자체를 막고 기존 트레이너만 선택하게 한다.
 */
export default function TrainerRegisterModal({
  open,
  onClose,
  initialName = "",
  allTrainers,
  firstRegisteredBranchId,
  createdBy,
  onRegistered,
  branchNameOf,
}: Props) {
  const [name, setName] = useState(initialName);
  const [phoneLast4, setPhoneLast4] = useState("");
  const [identifierMemo, setIdentifierMemo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [duplicates, setDuplicates] = useState<Trainer[] | null>(null);
  const [blockedExact, setBlockedExact] = useState<Trainer | null>(null);

  if (!open) return null;

  function handleClose() {
    setSaving(false);
    setDuplicates(null);
    setBlockedExact(null);
    onClose();
  }

  async function doCreate() {
    setSaving(true);
    setError(null);
    try {
      const trimmedName = name.trim();
      const trimmedPhone = phoneLast4.trim();
      const trimmedMemo = identifierMemo.trim();
      const id = await createTrainer({
        name: trimmedName,
        phoneLast4: trimmedPhone || undefined,
        identifierMemo: trimmedMemo || undefined,
        firstRegisteredBranchId,
        active: true,
        createdBy,
      });
      const newTrainer: Trainer = {
        id,
        name: trimmedName,
        active: true,
        createdBy,
        createdAt: null as never,
        updatedAt: null as never,
        ...(trimmedPhone ? { phoneLast4: trimmedPhone } : {}),
        ...(trimmedMemo ? { identifierMemo: trimmedMemo } : {}),
        ...(firstRegisteredBranchId ? { firstRegisteredBranchId } : {}),
      };
      onRegistered(newTrainer);
      handleClose();
    } catch (err) {
      console.error("[TrainerRegisterModal] create failed", err);
      setError("트레이너 등록에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("이름을 입력해주세요.");
      return;
    }
    setError(null);

    const sameName = allTrainers.filter((t) => t.name === trimmedName);
    if (sameName.length === 0) {
      void doCreate();
      return;
    }

    const trimmedPhone = phoneLast4.trim();
    const exact = trimmedPhone
      ? sameName.find((t) => (t.phoneLast4 ?? "") === trimmedPhone)
      : undefined;

    setDuplicates(sameName);
    setBlockedExact(exact ?? null);
  }

  function selectExisting(trainer: Trainer) {
    onRegistered(trainer);
    handleClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} />
      <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-md space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">
            {duplicates ? "동일한 이름의 트레이너 확인" : "신규 트레이너 등록"}
          </h3>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600">
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        {!duplicates ? (
          <>
            <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
              트레이너는 전 지점 공용으로 등록됩니다. 특정 지점 소속으로 저장되지 않습니다.
            </p>

            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">
                이름 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => { setName(e.target.value); setError(null); }}
                placeholder="트레이너 이름"
                autoFocus
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">전화번호 뒤 4자리 (권장)</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                value={phoneLast4}
                onChange={(e) => setPhoneLast4(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="예: 7089"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">식별 메모 (선택)</label>
              <input
                type="text"
                value={identifierMemo}
                onChange={(e) => setIdentifierMemo(e.target.value)}
                placeholder="동명이인 구분용 메모"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
              />
            </div>

            <p className="text-xs text-amber-600 flex items-start gap-1.5">
              <AlertTriangleIcon className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              같은 이름의 트레이너가 있을 수 있으니 전화번호 뒤 4자리 또는 식별 정보를 확인해주세요.
            </p>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <div className="flex gap-2 justify-end">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving}
                className="px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304f] disabled:opacity-50"
              >
                {saving ? "등록 중..." : "등록"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-700">동일한 이름의 트레이너가 이미 있습니다.</p>

            {blockedExact ? (
              <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
                이름과 전화번호 뒤 4자리가 모두 동일한 트레이너가 있어 신규 등록할 수 없습니다.
                기존 트레이너를 선택해주세요.
              </p>
            ) : null}

            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {duplicates.map((t) => (
                <div
                  key={t.id}
                  className={cn(
                    "flex items-center justify-between border rounded-lg px-3 py-2 text-sm",
                    blockedExact?.id === t.id ? "border-red-300 bg-red-50" : "border-gray-200"
                  )}
                >
                  <div>
                    <p className="font-medium text-gray-900">{t.name}</p>
                    <p className="text-xs text-gray-500">
                      {trainerIdentifierLabel(t, branchNameOf) || "식별 정보 없음"}
                      {!t.active && " · 비활성"}
                    </p>
                  </div>
                  <button
                    onClick={() => selectExisting(t)}
                    className="px-3 py-1.5 text-xs bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304f]"
                  >
                    선택
                  </button>
                </div>
              ))}
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                취소
              </button>
              {!blockedExact && (
                <button
                  onClick={() => void doCreate()}
                  disabled={saving}
                  className="px-4 py-2 text-sm border border-[#1e3a5f] text-[#1e3a5f] rounded-lg hover:bg-[#1e3a5f]/5 disabled:opacity-50"
                >
                  {saving ? "등록 중..." : "다른 사람으로 신규 등록"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
