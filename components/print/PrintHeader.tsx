"use client";

import { useEffect, useState } from "react";

interface Props {
  title: string;      // 예: 관리자 전체 현황, 지점장 일일보고
  subtitle?: string;  // 예: 어반요가 / 2026-07-07
}

/**
 * 인쇄 시에만 표시되는 문서 헤더 (@media print .print-only)
 */
export default function PrintHeader({ title, subtitle }: Props) {
  const [printedAt, setPrintedAt] = useState("");

  useEffect(() => {
    function update() {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      setPrintedAt(
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
      );
    }
    update();
    window.addEventListener("beforeprint", update);
    return () => window.removeEventListener("beforeprint", update);
  }, []);

  return (
    <div className="print-only mb-4 border-b border-gray-300 pb-3">
      <p className="text-xs text-gray-500">리턴라이프 일일보고 시스템</p>
      <h1 className="text-lg font-bold text-black mt-0.5">{title}</h1>
      {subtitle && <p className="text-sm text-gray-700 mt-0.5">{subtitle}</p>}
      <p className="text-xs text-gray-500 mt-1">출력일시: {printedAt}</p>
    </div>
  );
}
