"use client";

import { cn } from "@/lib/utils";

interface Props {
  label: string;
  value: number | null;
  onChange: (val: number | null) => void;
  unit?: string;
  subText?: string;
  required?: boolean;
  readOnly?: boolean;
  className?: string;
  placeholder?: string;
}

export default function NumberInput({
  label,
  value,
  onChange,
  unit,
  subText,
  required,
  readOnly,
  className,
  placeholder,
}: Props) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label className="text-xs font-medium text-gray-700">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          value={value ?? ""}
          readOnly={readOnly}
          placeholder={placeholder ?? ""}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              onChange(null);
            } else {
              const n = parseInt(raw, 10);
              if (!isNaN(n) && n >= 0) onChange(n);
            }
          }}
          className={cn(
            "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent",
            readOnly && "bg-gray-50 text-gray-500 cursor-not-allowed"
          )}
        />
        {unit && <span className="text-xs text-gray-500 whitespace-nowrap">{unit}</span>}
      </div>
      {subText && <p className="text-xs text-gray-400">{subText}</p>}
    </div>
  );
}
