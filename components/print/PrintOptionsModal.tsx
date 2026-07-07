"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { PrinterIcon, XIcon } from "lucide-react";

export type PrintSectionDef = { key: string; label: string };

interface Props {
  open: boolean;
  onClose: () => void;
  sections: PrintSectionDef[];
  selectedSections: string[];
  onChange: (keys: string[]) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  onPrint: () => void;
}

export default function PrintOptionsModal({
  open,
  onClose,
  sections,
  selectedSections,
  onChange,
  onSelectAll,
  onClearAll,
  onPrint,
}: Props) {
  const [error, setError] = useState(false);

  if (!open) return null;

  function toggle(key: string) {
    setError(false);
    onChange(
      selectedSections.includes(key)
        ? selectedSections.filter((k) => k !== key)
        : [...selectedSections, key]
    );
  }

  function handlePrint() {
    if (selectedSections.length === 0) {
      setError(true);
      return;
    }
    setError(false);
    onPrint();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 no-print">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl p-5 w-full max-w-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">인쇄할 항목 선택</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => { setError(false); onSelectAll(); }}
            className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
          >
            전체 선택
          </button>
          <button
            onClick={onClearAll}
            className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
          >
            전체 해제
          </button>
        </div>

        <div className="space-y-1 max-h-64 overflow-y-auto">
          {sections.map((s) => (
            <label
              key={s.key}
              className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer hover:bg-gray-50 rounded-lg px-2 py-1.5"
            >
              <input
                type="checkbox"
                checked={selectedSections.includes(s.key)}
                onChange={() => toggle(s.key)}
                className="rounded border-gray-300"
              />
              {s.label}
            </label>
          ))}
        </div>

        {error && (
          <p className="text-xs text-red-500">인쇄할 항목을 선택해주세요.</p>
        )}

        <p className="text-[11px] text-gray-400 md:hidden">
          모바일에서는 공유 또는 브라우저 인쇄 기능으로 저장할 수 있습니다.
        </p>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
          >
            취소
          </button>
          <button
            onClick={handlePrint}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg text-white",
              "bg-[#1e3a5f] hover:bg-[#16304f]"
            )}
          >
            <PrinterIcon className="w-3.5 h-3.5" />
            인쇄하기
          </button>
        </div>
      </div>
    </div>
  );
}
