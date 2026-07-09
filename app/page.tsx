"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import LoadingState from "@/components/common/LoadingState";

export default function RootPage() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
    } else if (!profile || profile.status === "pending") {
      router.replace("/pending");
    } else if (profile.status === "suspended") {
      router.replace("/login");
    } else if (profile.role === "admin") {
      router.replace("/admin");
    } else if (profile.mustChangePassword) {
      router.replace("/change-password");
    } else {
      router.replace("/manager");
    }
  }, [user, profile, loading, router]);

  return <LoadingState text="이동 중..." />;
}
