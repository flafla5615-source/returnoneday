"use client";

import { cn } from "@/lib/utils";

interface Props {
  sectionKey: string;
  selectedSections: string[];
  children: React.ReactNode;
  className?: string;
}

/**
 * 화면에서는 항상 보이고, 인쇄 시에는 selectedSections에 포함된 섹션만 출력된다.
 */
export default function PrintableSection({
  sectionKey,
  selectedSections,
  children,
  className,
}: Props) {
  const included = selectedSections.includes(sectionKey);
  return (
    <div className={cn("print-section", !included && "print-hidden", className)}>
      {children}
    </div>
  );
}
