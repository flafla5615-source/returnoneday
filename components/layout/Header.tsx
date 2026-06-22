"use client";

import { BellIcon, MenuIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { formatDate, nowKST } from "@/lib/utils";

interface Props {
  title?: string;
  onMenuClick?: () => void;
}

export default function Header({ title, onMenuClick }: Props) {
  const { profile } = useAuth();
  const today = formatDate(nowKST());

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-3 sticky top-0 z-30">
      {onMenuClick && (
        <button
          onClick={onMenuClick}
          className="md:hidden p-1 rounded-lg text-gray-500 hover:bg-gray-100"
        >
          <MenuIcon className="w-5 h-5" />
        </button>
      )}

      <div className="flex-1">
        {title && <h1 className="text-sm font-semibold text-gray-800">{title}</h1>}
      </div>

      <div className="flex items-center gap-3">
        <span className="hidden sm:block text-xs text-gray-400">{today}</span>
        <button className="relative p-1.5 rounded-lg text-gray-500 hover:bg-gray-100">
          <BellIcon className="w-5 h-5" />
        </button>
        <div className="w-8 h-8 rounded-full bg-[#1e3a5f] flex items-center justify-center text-white text-xs font-bold">
          {profile?.name?.[0] ?? "U"}
        </div>
      </div>
    </header>
  );
}
