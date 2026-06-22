import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { label: "영업 지표", num: 1 },
  { label: "TM·홍보 활동", num: 2 },
  { label: "운영 이슈", num: 3 },
  { label: "캠페인 실적", num: 4 },
];

interface Props {
  current: number;
  onChange?: (step: number) => void;
}

export default function ReportStepper({ current, onChange }: Props) {
  return (
    <div className="flex items-center gap-0 overflow-x-auto pb-1">
      {STEPS.map((step, idx) => {
        const done = current > step.num;
        const active = current === step.num;
        return (
          <div key={step.num} className="flex items-center">
            <button
              onClick={() => onChange?.(step.num)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
                active
                  ? "bg-red-600 text-white"
                  : done
                  ? "bg-green-100 text-green-700"
                  : "bg-gray-100 text-gray-500"
              )}
            >
              <span
                className={cn(
                  "w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold",
                  active ? "bg-white text-red-600" : done ? "bg-green-600 text-white" : "bg-gray-300 text-white"
                )}
              >
                {done ? <CheckIcon className="w-3 h-3" /> : step.num}
              </span>
              {step.label}
            </button>
            {idx < STEPS.length - 1 && (
              <div className="w-4 h-px bg-gray-300 mx-0.5 flex-shrink-0" />
            )}
          </div>
        );
      })}
    </div>
  );
}
