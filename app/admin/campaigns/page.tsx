import { redirect } from "next/navigation";

// 캠페인 관리는 프로모션 관리로 대체되었다.
// 기존 북마크·링크가 깨지지 않도록 새 경로로 넘겨준다.
export default function AdminCampaignsPage() {
  redirect("/admin/promotions");
}
