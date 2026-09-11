import { jwtVerify, createRemoteJWKSet, type JWTPayload } from "jose";

/**
 * Firebase ID 토큰을 서비스 계정 키 없이 검증한다.
 *
 * Firebase ID 토큰은 구글이 서명한 표준 JWT라서, 공개키(JWKS)만 있으면
 * Admin SDK 없이도 검증할 수 있다. 이 프로젝트에는 서비스 계정 키가 없으므로
 * (scripts/create-admin.mjs 용 FIREBASE_ADMIN_* 값이 비어 있음) 이 방식을 쓴다.
 *
 * 검증하는 것: 서명 / 발급자 / 대상 프로젝트 / 만료시간
 */

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "returnoneday";

// 구글이 제공하는 Firebase ID 토큰용 JWKS 엔드포인트 (키는 주기적으로 교체되며 jose가 캐시·갱신한다)
const JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")
);

export interface VerifiedUser {
  uid: string;
  email?: string;
}

/**
 * Authorization: Bearer <idToken> 헤더에서 토큰을 꺼내 검증한다.
 * 실패하면 null을 반환한다 (사유는 서버 로그에만 남기고 호출자에게 흘리지 않는다).
 */
export async function verifyFirebaseIdToken(
  authorizationHeader: string | null
): Promise<VerifiedUser | null> {
  if (!authorizationHeader?.startsWith("Bearer ")) return null;
  const token = authorizationHeader.slice("Bearer ".length).trim();
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${PROJECT_ID}`,
      audience: PROJECT_ID,
    });

    const uid = typeof payload.sub === "string" ? payload.sub : "";
    if (!uid) return null;

    return {
      uid,
      email: typeof (payload as JWTPayload & { email?: string }).email === "string"
        ? (payload as JWTPayload & { email?: string }).email
        : undefined,
    };
  } catch (error) {
    console.warn("[chat] ID 토큰 검증 실패:", (error as Error).message);
    return null;
  }
}
