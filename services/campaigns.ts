import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  where,
  orderBy,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Campaign, CampaignResult } from "@/types";

export async function createCampaign(
  data: Omit<Campaign, "id" | "createdAt" | "updatedAt">
): Promise<string> {
  const ref = doc(collection(db, "campaigns"));
  await setDoc(ref, {
    ...data,
    id: ref.id,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  return ref.id;
}

export async function updateCampaign(id: string, data: Partial<Campaign>): Promise<void> {
  await updateDoc(doc(db, "campaigns", id), {
    ...data,
    updatedAt: Timestamp.now(),
  });
}

export async function getCampaignById(id: string): Promise<Campaign | null> {
  const snap = await getDoc(doc(db, "campaigns", id));
  return snap.exists() ? (snap.data() as Campaign) : null;
}

export async function getAllCampaigns(): Promise<Campaign[]> {
  const snap = await getDocs(
    query(collection(db, "campaigns"), orderBy("createdAt", "desc"))
  );
  return snap.docs.map((d) => d.data() as Campaign);
}

export async function getActiveCampaigns(branchId: string): Promise<Campaign[]> {
  const snap = await getDocs(
    query(collection(db, "campaigns"), where("status", "==", "active"))
  );
  const campaigns = snap.docs.map((d) => d.data() as Campaign);
  return campaigns.filter(
    (c) => c.targetBranchIds.includes(branchId) || c.targetBranchIds.includes("all")
  );
}

export async function upsertCampaignResult(
  campaignId: string,
  reportId: string,
  branchId: string,
  reportDate: string,
  metrics: Record<string, number | null>
): Promise<void> {
  const id = `${campaignId}_${reportId}`;
  const ref = doc(db, "campaignResults", id);
  const existing = await getDoc(ref);
  const now = Timestamp.now();

  if (existing.exists()) {
    await updateDoc(ref, { metrics, updatedAt: now });
  } else {
    const result: CampaignResult = {
      id,
      campaignId,
      reportId,
      branchId,
      reportDate,
      metrics,
      createdAt: now,
      updatedAt: now,
    };
    await setDoc(ref, result);
  }
}

export async function getCampaignResults(campaignId: string): Promise<CampaignResult[]> {
  const snap = await getDocs(
    query(
      collection(db, "campaignResults"),
      where("campaignId", "==", campaignId),
      orderBy("reportDate", "asc")
    )
  );
  return snap.docs.map((d) => d.data() as CampaignResult);
}

export async function getCampaignResultByReport(
  campaignId: string,
  reportId: string
): Promise<CampaignResult | null> {
  const id = `${campaignId}_${reportId}`;
  const snap = await getDoc(doc(db, "campaignResults", id));
  return snap.exists() ? (snap.data() as CampaignResult) : null;
}
