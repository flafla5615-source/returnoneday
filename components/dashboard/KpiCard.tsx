import { cn } from "@/lib/utils";

interface Props {
  label: string;
  value: string | number;
  subLabel?: string;
  change?: string;
  changePositive?: boolean;
  unit?: string;
  className?: string;
}

export default function KpiCard({
  label,
  value,
  subLabel,
  change,
  changePositive,
  unit,
  className,
}: Props) {
  return (
    <div className={cn("bg-white rounded-xl border border-gray-200 p-4 shadow-sm", className)}>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
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
