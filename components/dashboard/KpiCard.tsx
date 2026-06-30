import { cn } from "@/lib/utils";
import { ChevronDownIcon } from "lucide-react";

interface Props {
  label: string;
  value: string | number;
  subLabel?: string;
  change?: string;
  changePositive?: boolean;
  unit?: string;
  className?: string;
  onClick?: () => void;
  active?: boolean;
}

export default function KpiCard({
  label,
  value,
  subLabel,
  change,
  changePositive,
  unit,
  className,
  onClick,
  active,
}: Props) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "bg-white rounded-xl border p-4 shadow-sm transition-all",
        onClick ? "cursor-pointer hover:shadow-md hover:border-gray-300" : "",
        active ? "border-[#1e3a5f] bg-[#1e3a5f]/5" : "border-gray-200",
        className
      )}
    >
      <div className="flex items-start justify-between mb-1">
        <p className="text-xs text-gray-500">{label}</p>
        {onClick && (
          <ChevronDownIcon
            className={cn(
              "w-3.5 h-3.5 shrink-0 transition-transform",
              active ? "rotate-180 text-[#1e3a5f]" : "text-gray-300"
            )}
          />
        )}
      </div>
      <div className="flex items-end gap-1">
        <span className="text-2xl font-bold text-gray-900">{value}</span>
        {unit && <span className="text-sm text-gray-500 mb-0.5">{unit}</span>}
      </div>
      {subLabel && <p className="text-xs text-gray-400 mt-0.5">{subLabel}</p>}
      {change && (
        <p
          className={cn(
            "text-xs font-medium mt-1",
            changePositive === true
              ? "text-green-600"
              : changePositive === false
              ? "text-red-500"
              : "text-gray-500"
          )}
        >
          {change}
        </p>
      )}
    </div>
  );
}
