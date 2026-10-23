/* Firebase Storage 오류 코드를 사람이 읽을 수 있는 안내로 바꾼다.
   Firebase 의존성이 없어 단독 테스트할 수 있다.

   왜 필요한가
     버킷이 만들어지지 않은 프로젝트에 업로드를 걸면 SDK 가 내부적으로 재시도만
     반복한다. 진행률 콜백이 한 번도 오지 않아 화면은 "0%" 에 멈춘 것처럼 보이고
     사용자는 원인을 알 수 없다. 코드별로 원인과 할 일을 분명히 알려준다. */

export interface StorageErrorInfo {
  /** 화면에 그대로 보여줄 설명 */
  message: string;
  /** 같은 조건에서 다시 눌러도 될 성격의 오류인가 (설정 문제면 false) */
  retryable: boolean;
  /** 사용자가 아니라 관리자가 설정으로 풀어야 하는 문제인가 */
  needsSetup: boolean;
}

/**
 * 버킷 자체가 없을 때 SDK 가 내는 코드들.
 * 재시도해도 풀리지 않고, Firebase 콘솔에서 Storage 를 활성화해야 한다.
 */
const SETUP_CODES = new Set([
  "storage/unknown",
  "storage/retry-limit-exceeded",
  "storage/bucket-not-found",
  "storage/project-not-found",
  "storage/invalid-argument", // 버킷 이름이 비어 있을 때
]);

export function describeStorageError(code: string | undefined | null): StorageErrorInfo {
  const normalized = (code ?? "").trim();

  // 확인이 끝나지 않은 경우 — 오프라인일 수도 있어 단정하지 않는다
  if (normalized === "probe-timeout") {
    return {
      message: "네트워크 상태를 확인해주세요. 업로드가 되지 않으면 아래 안내를 따라주세요.",
      retryable: true,
      needsSetup: false,
    };
  }

  switch (normalized) {
    case "storage/unauthorized":
      return {
        message:
          "업로드 권한이 없습니다. 담당 지점이 맞는지, 보안 규칙이 배포됐는지 확인해주세요.",
        retryable: false,
        needsSetup: true,
      };
    case "storage/unauthenticated":
      return {
        message: "로그인이 만료되었습니다. 새로고침 후 다시 시도해주세요.",
        retryable: true,
        needsSetup: false,
      };
    case "storage/quota-exceeded":
      return {
        message: "저장 용량이 가득 찼습니다. 관리자에게 문의해주세요.",
        retryable: false,
        needsSetup: true,
      };
    case "storage/canceled":
      return { message: "업로드를 취소했습니다.", retryable: true, needsSetup: false };
    case "storage/server-file-wrong-size":
      return {
        message: "전송 중 파일이 손상됐습니다. 다시 시도해주세요.",
        retryable: true,
        needsSetup: false,
      };
    case "storage/object-not-found":
      return {
        message: "파일을 찾을 수 없습니다. 목록을 새로고침해주세요.",
        retryable: true,
        needsSetup: false,
      };
    default:
      break;
  }

  if (SETUP_CODES.has(normalized)) {
    return {
      message: "이 프로젝트에 Firebase Storage 가 아직 만들어지지 않았습니다.",
      retryable: false,
      needsSetup: true,
    };
  }

  return {
    message: "업로드하지 못했습니다. 네트워크 상태를 확인하고 다시 시도해주세요.",
    retryable: true,
    needsSetup: false,
  };
}

/** 관리자가 Storage 를 켜야 하는 경우에 보여줄 구체적인 안내 */
export const STORAGE_SETUP_GUIDE = {
  consoleUrl: "https://console.firebase.google.com/project/returnoneday/storage",
  steps: [
    "Firebase 콘솔 → Storage → '시작하기'",
    "위치는 asia-northeast3 (서울) 선택 — 나중에 변경할 수 없습니다",
    "생성 후 보안 규칙 배포: npx firebase-tools deploy --only storage",
  ],
} as const;
