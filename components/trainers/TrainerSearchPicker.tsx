"use client";

import { useMemo, useState } from "react";
import { trainerIdentifierLabel } from "@/lib/utils";
import TrainerRegisterModal from "./TrainerRegisterModal";
import type { Trainer } from "@/types";
import { SearchIcon, PlusIcon, UserPlusIcon } from "lucide-react";

interface Props {
  trainers: Trainer[]; // active 트레이너 전체 목록 (전사 공용)
  excludeIds?: string[]; // 이미 오늘 목록에 추가된 트레이너
  onSelect: (trainer: Trainer) => void;
  firstRegisteredBranchId?: string;
  createdBy: string;
  branchNameOf?: (id: string) => string;
  disabled?: boolean;
}

export default function TrainerSearchPicker({
  trainers,
  excludeIds = [],
  onSelect,
  firstRegisteredBranchId,
  createdBy,
  branchNameOf,
  disabled,
}: Props) {
  const [query, setQuery] = useState("");
  const [registerOpen, setRegisterOpen] = useState(false);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return trainers
      .filter((t) => !excludeIds.includes(t.id))
      .filter((t) => {
        const identifier = trainerIdentifierLabel(t, branchNameOf).toLowerCase();
        return t.name.toLowerCase().includes(q) || identifier.includes(q);
      })
      .slice(0, 20);
  }, [trainers, excludeIds, query, branchNameOf]);

  function handleSelect(trainer: Trainer) {
    onSelect(trainer);
    setQuery("");
  }

  function handleRegistered(trainer: Trainer) {
    onSelect(trainer);
    setQuery("");
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <SearchIcon className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="트레이너명·전화번호 뒤 4자리로 검색"
          disabled={disabled}
          className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 disabled:bg-gray-50 disabled:text-gray-400"
        />
      </div>

      {query.trim() && (
        <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-56 overflow-y-auto">
          {results.length > 0 ? (
            results.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => handleSelect(t)}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between gap-2"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">{t.name}</p>
                  <p className="text-xs text-gray-400">
                    {trainerIdentifierLabel(t, branchNameOf) || "식별 정보 없음"}
                  </p>
                </div>
                <PlusIcon className="w-4 h-4 text-gray-400 shrink-0" />
              </button>
            ))
          ) : (
            <div className="px-3 py-4 text-center space-y-2">
              <p className="text-xs text-gray-400">검색 결과가 없습니다.</p>
              <button
                type="button"
                onClick={() => setRegisterOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304f]"
              >
                <UserPlusIcon className="w-3.5 h-3.5" />
                신규 트레이너 등록
              </button>
            </div>
          )}
        </div>
      )}

      {registerOpen && (
        <TrainerRegisterModal
          open
          onClose={() => setRegisterOpen(false)}
          initialName={query.trim()}
          allTrainers={trainers}
          firstRegisteredBranchId={firstRegisteredBranchId}
          createdBy={createdBy}
          onRegistered={handleRegistered}
          branchNameOf={branchNameOf}
        />
      )}
    </div>
  );
}
