"use client";

import { useState, useCallback } from "react";
import { upsertReport, getReport } from "@/services/reports";
import type { DailyReport, ReportStatus } from "@/types";

export function useReport(branchId: string, date: string, writerUid: string) {
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(
    async (data: Partial<DailyReport>, status: ReportStatus = "draft") => {
      setSaving(true);
      setError(null);
      try {
        await upsertReport(branchId, date, writerUid, data, status);
        setLastSaved(new Date());
      } catch (e) {
        const msg = e instanceof Error ? e.message : "저장 실패";
        setError(msg);
      } finally {
        setSaving(false);
      }
    },
    [branchId, date, writerUid]
  );

  const load = useCallback(async () => {
    return await getReport(branchId, date);
  }, [branchId, date]);

  return { save, load, saving, lastSaved, error };
}
