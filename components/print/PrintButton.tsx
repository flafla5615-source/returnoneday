"use client";

import { useState } from "react";
import { PrinterIcon } from "lucide-react";
import PrintOptionsModal, { type PrintSectionDef } from "./PrintOptionsModal";

interface Props {
  /**
   * 섹션 목록을 주면 (관리자) 인쇄 옵션 모달을 띄우고,
   * 없으면 (지점장) 바로 브라우저 인쇄를 실행한다.
   */
  sections?: PrintSectionDef[];
  selectedSections?: string[];
  onSelectionChange?: (keys: string[]) => void;
}

export default function PrintButton({
  sections,
  selectedSections = [],
  onSelectionChange,
}: Props) {
  const [modalOpen, setModalOpen] = useState(false);

  function doPrint() {
    setModalOpen(false);
    // 모달이 닫히고 선택 상태가 DOM에 반영된 뒤 인쇄 실행
    setTimeout(() => window.print(), 150);
  }

  function handleClick() {
    if (sections && sections.length > 0) {
      setModalOpen(true);
    } else {
      setTimeout(() => window.print(), 50);
    }
  }

  return (
    <>
      <div className="no-print flex flex-col items-end gap-0.5">
        <button
          onClick={handleClick}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-300 rounded-lg bg-white text-gray-700 hover:bg-gray-50"
        >
          <PrinterIcon className="w-3.5 h-3.5" />
          프린트
        </button>
        <span className="text-[10px] text-gray-400 md:hidden">
          모바일에서는 공유 또는 브라우저 인쇄 기능으로 저장할 수 있습니다.
        </span>
      </div>

      {sections && onSelectionChange && (
        <PrintOptionsModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          sections={sections}
          selectedSections={selectedSections}
          onChange={onSelectionChange}
          onSelectAll={() => onSelectionChange(sections.map((s) => s.key))}
          onClearAll={() => onSelectionChange([])}
          onPrint={doPrint}
        />
      )}
    </>
  );
}
