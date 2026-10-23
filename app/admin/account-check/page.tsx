"use client";

import { useEffect, useMemo, useState } from "react";
import { getAllBranchesIncludingInactive } from "@/services/branches";
import { getAllUsers, linkExistingAuthAccount } from "@/services/users";
import LoadingState from "@/components/common/LoadingState";
import { checkUploadPermission } from "@/lib/uploadPermission";
import { STORAGE_CROSS_SERVICE_GUIDE } from "@/lib/storageErrors";
import { cn } from "@/lib/utils";
import type { Branch, UserProfile } from "@/types";
import { AlertTriangleIcon, CheckCircle2Icon, RefreshCwIcon, WrenchIcon } from "lucide-react";

/* 지점장 계정 점검
   ─────────────────
   주간보고 파일 업로드는 Storage 보안 규칙이 Firestore 의 users 문서를 읽어
   판단한다. 그래서 계정마다 결과가 갈린다.

     role == 'branch_manager' / status == 'active' / branchIds 에 그 지점 포함

   이 화면은 규칙과 똑같은 조건을 전 지점·전 계정에 대해 대조해서
   어떤 계정이 왜 막히는지 보여준다. 읽기만 하며, 고치기는 버튼을 눌러야 한다. */

interface BranchCheck {
  branch: Branch;
  /** 이 지점을 담당으로 가진 계정들 (users.branchIds 기준) */
  managers: UserProfile[];
  /** branches.managerUids 에만 있고 users.branchIds 에는 없는 uid (불일치) */
  staleManagerUids: string[];
  canUpload: boolean;
}

export default function AdminAccountCheckPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [bs, us] = await Promise.all([getAllBranchesIncludingInactive(), getAllUsers()]);
        if (cancelled) return;
        setBranches(bs);
        setUsers(us);
      } catch (err) {
        console.error("account check load failed:", err);
        if (!cancelled) setError("데이터를 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const branchNameOf = useMemo(() => {
    const map = new Map(branches.map((b) => [b.id, b.name]));
    return (id: string) => map.get(id) ?? id;
  }, [branches]);

  const checks: BranchCheck[] = useMemo(
    () =>
      branches.map((branch) => {
        const managers = users.filter(
          (u) => u.role === "branch_manager" && (u.branchIds ?? []).includes(branch.id)
        );
        const managerUids = branch.managerUids ?? [];
        const staleManagerUids = managerUids.filter(
          (uid) => !managers.some((m) => m.uid === uid)
        );
        const canUpload = managers.some(
          (m) =>
            checkUploadPermission({ profile: m, branchId: branch.id, branchName: branch.name })
              .allowed
        );
        return { branch, managers, staleManagerUids, canUpload };
      }),
    [branches, users]
  );

  // 어느 지점도 담당하지 않는 지점장 계정 (연결이 빠진 계정)
  const orphanManagers = useMemo(
    () => users.filter((u) => u.role === "branch_manager" && (u.branchIds ?? []).length === 0),
    [users]
  );

  const problemCount = checks.filter((c) => !c.canUpload).length;

  async function handleFix(branch: Branch, user: UserProfile) {
    setFixing(user.uid);
    setError(null);
    setNotice(null);
    try {
      await linkExistingAuthAccount({
        uid: user.uid,
        email: user.email,
        name: branch.name,
        branchId: branch.id,
      });
      setNotice(`${user.email} → ${branch.name} 연결을 복구했습니다.`);
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("account fix failed:", err);
      setError("연결을 복구하지 못했습니다. 사용자 관리 화면에서 직접 연결해주세요.");
    } finally {
      setFixing(null);
    }
  }

  if (loading) return <LoadingState />;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-gray-900">지점장 계정 점검</h1>
          <p className="text-xs text-gray-400">
            주간보고 업로드 권한은 role / status / branchIds 로 결정됩니다. 보안 규칙과 같은 조건을
            대조합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
        >
          <RefreshCwIcon className="h-3.5 w-3.5" />
          다시 확인
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {notice}
        </p>
      )}

      <div
        className={cn(
          "rounded-xl border p-4",
          problemCount === 0 ? "border-green-200 bg-green-50" : "border-amber-300 bg-amber-50"
        )}
      >
        {problemCount === 0 ? (
          <p className="flex items-center gap-2 text-sm font-semibold text-green-800">
            <CheckCircle2Icon className="h-4 w-4" />
            전 지점({branches.length})에 업로드 가능한 지점장 계정이 연결돼 있습니다.
          </p>
        ) : (
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-800">
            <AlertTriangleIcon className="h-4 w-4" />
            {problemCount}개 지점에 업로드 가능한 계정이 없습니다. 아래에서 사유를 확인하세요.
          </p>
        )}
      </div>

      <div className="space-y-2">
        {checks.map(({ branch, managers, staleManagerUids, canUpload }) => (
          <div
            key={branch.id}
            className={cn(
              "rounded-xl border bg-white p-4 shadow-sm",
              canUpload ? "border-gray-200" : "border-amber-300"
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium text-gray-800">
                  {branch.name}
                  {!branch.active && (
                    <span className="ml-2 text-xs font-normal text-gray-400">(비활성 지점)</span>
                  )}
                </p>
                <p className="truncate font-mono text-[11px] text-gray-400">{branch.id}</p>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium",
                  canUpload ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-800"
                )}
              >
                {canUpload ? "업로드 가능" : "업로드 불가"}
              </span>
            </div>

            {managers.length === 0 ? (
              <p className="mt-2 text-xs text-amber-700">
                이 지점을 담당으로 등록한 계정이 없습니다. 사용자 관리 → 기존 Firebase 계정 연결에서
                담당 계정을 연결해주세요.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {managers.map((m) => {
                  const result = checkUploadPermission({
                    profile: m,
                    branchId: branch.id,
                    branchName: branch.name,
                    branchNameOf,
                  });
                  return (
                    <li
                      key={m.uid}
                      className="rounded-lg bg-gray-50 p-2.5 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0 break-all font-medium text-gray-700">
                          {m.email || m.name}
                        </span>
                        <span
                          className={
                            result.allowed
                              ? "shrink-0 text-green-700"
                              : "shrink-0 text-amber-700"
                          }
                        >
                          {result.allowed ? "정상" : "불가"}
                        </span>
                      </div>
                      <p className="mt-1 font-mono text-[11px] text-gray-400">
                        role={m.role} · status={m.status} · branchIds=
                        {(m.branchIds ?? []).length > 0 ? (m.branchIds ?? []).join(", ") : "(없음)"}
                      </p>
                      {!result.allowed && (
                        <p className="mt-1 text-[11px] text-amber-700">{result.message}</p>
                      )}
                      {!result.allowed && result.reason !== "not-manager" && (
                        <button
                          type="button"
                          onClick={() => handleFix(branch, m)}
                          disabled={fixing === m.uid}
                          className="mt-1.5 flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          <WrenchIcon className="h-3 w-3" />
                          {fixing === m.uid ? "복구 중..." : "이 지점으로 연결 복구"}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {staleManagerUids.length > 0 && (
              <p className="mt-2 text-[11px] text-gray-500">
                참고: 지점 문서의 담당자 목록에는 있으나 계정의 담당 지점에는 빠진 uid{" "}
                {staleManagerUids.length}건 — {staleManagerUids.join(", ")}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* 프로필이 정상인데도 storage/unauthorized 가 나면 여기부터 확인한다 */}
      <details className="rounded-xl border border-gray-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold text-gray-800">
          담당 지점이 맞는데 업로드가 거부될 때 (storage/unauthorized)
        </summary>
        <div className="mt-3 space-y-2 text-xs text-gray-600">
          <p>
            Storage 보안 규칙은 Firestore 의 users 문서를 읽어 담당 지점을 판단합니다. 그 읽기
            권한(교차 서비스 권한)이 프로젝트에 없으면, 프로필이 정상이어도 모든 업로드가
            거부됩니다. 규칙을 비대화형으로 배포하면 권한 연결 과정이 건너뛰어질 수 있습니다.
          </p>
          <p className="font-medium text-gray-700">가장 간단한 해결: 터미널에서 직접 배포</p>
          <pre className="overflow-x-auto rounded bg-gray-900 px-3 py-2 text-[11px] text-gray-100">
            {STORAGE_CROSS_SERVICE_GUIDE.cliCommand}
          </pre>
          <p>권한이 없으면 CLI 가 연결 여부를 물어봅니다. 승인하면 바로 적용됩니다.</p>

          <p className="mt-2 font-medium text-gray-700">직접 확인하려면 (IAM)</p>
          <ul className="list-disc space-y-0.5 pl-4">
            <li>
              계정:{" "}
              <span className="break-all font-mono text-[11px]">
                {STORAGE_CROSS_SERVICE_GUIDE.serviceAccount}
              </span>
            </li>
            <li>
              필요한 역할:{" "}
              <span className="font-mono text-[11px]">{STORAGE_CROSS_SERVICE_GUIDE.role}</span>
            </li>
            <li>IAM 화면에서 &ldquo;Google 제공 역할 부여 포함&rdquo;을 켜야 보입니다</li>
          </ul>
          <a
            href={STORAGE_CROSS_SERVICE_GUIDE.iamUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
          >
            IAM 화면 열기
          </a>
          <p className="mt-2 text-[11px] text-gray-400">{STORAGE_CROSS_SERVICE_GUIDE.note}</p>
        </div>
      </details>

      {/* 다른 PC 가 옛 버전을 캐시하고 있는지 확인용 — 각 PC 에서 이 값을 비교한다 */}
      <p className="text-center font-mono text-[11px] text-gray-400">
        실행 중인 버전:{" "}
        {process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local"}
        {" · "}
        PC 마다 이 값이 다르면 브라우저 강력 새로고침(Ctrl+Shift+R)이 필요합니다.
      </p>

      {orphanManagers.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-800">
            담당 지점이 없는 지점장 계정 {orphanManagers.length}건
          </p>
          <ul className="mt-2 space-y-1">
            {orphanManagers.map((u) => (
              <li key={u.uid} className="break-all font-mono text-[11px] text-amber-700">
                {u.email} · status={u.status} · uid={u.uid}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-700">
            사용자 관리 → 기존 Firebase 계정 연결에서 담당 지점을 지정해주세요.
          </p>
        </div>
      )}
    </div>
  );
}
