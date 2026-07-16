import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

// 서버(previewTrainerImport)가 반환하는 값만 사용한다 — 연락처 전체 번호,
// 주민번호·계좌번호·급여 등 민감정보는 서버에서부터 아예 조회하지 않는다.
export interface TrainerImportRow {
  sourceRow: number;
  originalName: string;
  normalizedName: string;
  branchName: string;
  jobTitle: string;
  phoneLast4: string;
  status: string;
}

export async function previewTrainerImport(): Promise<TrainerImportRow[]> {
  const callable = httpsCallable<undefined, { rows: TrainerImportRow[] }>(
    functions,
    "previewTrainerImport"
  );
  const response = await callable();
  return response.data.rows;
}
