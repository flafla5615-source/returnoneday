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
          "서버가 업로드를 거부했습니다. 담당 지점은 맞는데 이 오류가 나면 " +
          "보안 규칙이 Firestore 를 읽을 권한(교차 서비스 권한)이 없는 경우입니다. " +
          "본사 관리자에게 '계정 점검' 화면의 안내를 확인해달라고 요청해주세요.",
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

/**
 * Storage 규칙이 Firestore 를 읽으려면 프로젝트에 IAM 권한이 하나 필요하다.
 * 이 권한이 없으면 firestore.get 이 실패해 모든 업로드가 거부된다
 * (프로필이 정상이어도 storage/unauthorized 가 난다).
 *
 * 비대화형 CLI 로 규칙을 배포하면 권한 연결 프롬프트가 건너뛰어질 수 있다.
 */
export const STORAGE_CROSS_SERVICE_GUIDE = {
  projectNumber: "766935285887",
  serviceAccount: "service-766935285887@gcp-sa-firebasestorage.iam.gserviceaccount.com",
  role: "Firebase Rules Firestore Service Agent",
  iamUrl: "https://console.cloud.google.com/iam-admin/iam?project=returnoneday",
  /** 가장 간단한 방법: 본인 터미널에서 규칙을 배포하면 CLI 가 권한 연결을 물어본다 */
  cliCommand: "npx firebase-tools deploy --only storage --project returnoneday",
  note:
    "교차 서비스 호출은 평가당 2회까지만 허용됩니다. 규칙은 1회만 호출하도록 맞춰져 있습니다.",
} as const;

/** 관리자가 Storage 를 켜야 하는 경우에 보여줄 구체적인 안내 */
export const STORAGE_SETUP_GUIDE = {
  consoleUrl: "https://console.firebase.google.com/project/returnoneday/storage",
  steps: [
    "Firebase 콘솔 → Storage → '시작하기'",
    "위치는 asia-northeast3 (서울) 선택 — 나중에 변경할 수 없습니다",
    "생성 후 보안 규칙 배포: npx firebase-tools deploy --only storage",
  ],
} as const;
