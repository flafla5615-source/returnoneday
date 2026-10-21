"use client";

import { useEffect } from "react";
import { XIcon } from "lucide-react";

/* 넓은 상세/작성 화면 껍데기.
   PC 는 가운데 모달, 모바일은 화면을 꽉 채우는 전체 화면.
   본문이 길면 패널 안에서만 세로 스크롤하고 뒤 배경은 스크롤되지 않는다.

   보고 원문 보기와 "넓게 작성" 입력창이 같은 껍데기를 쓰도록 분리했다. */

export default function DetailPanel({
  title,
  subtitle,
  onClose,
  footer,
  children,
  widthClass = "md:w-[min(48rem,92vw)]",
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
  widthClass?: string;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative flex h-full w-full flex-col bg-white shadow-2xl md:h-auto md:max-h-[88vh] md:rounded-2xl ${widthClass}`}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 md:px-6 md:py-4">
          <div className="min-w-0">
            <p className="truncate text-base font-bold text-gray-900">{title}</p>
            {subtitle && <p className="truncate text-xs text-gray-400">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">{children}</div>

        {footer && (
          <div className="shrink-0 border-t border-gray-100 px-4 py-3 md:px-6">{footer}</div>
        )}
      </div>
    </div>
  );
}
