# RETURN LIFE — 전 지점 일일 업무 보고 시스템

지점의 현황을 한눈에 파악하고 빠르게 보고하세요.

## 기술 스택

- **Next.js 16** (App Router) + **TypeScript**
- **Tailwind CSS v4**
- **Firebase** (Auth, Firestore, Storage)
- **Recharts** (차트)
- **React Hook Form + Zod** (폼 검증)

---

## Firebase 프로젝트 설정

### 1. Firebase 프로젝트 생성

1. [Firebase Console](https://console.firebase.google.com) → **프로젝트 추가**
2. 프로젝트 이름: `returnoneday` (또는 원하는 이름)
3. Google Analytics는 선택 사항

### 2. Authentication 활성화

Firebase Console → **Authentication** → **시작하기**  
→ **Sign-in method** 탭 → **이메일/비밀번호** → 활성화

### 3. Firestore 데이터베이스 생성

Firebase Console → **Firestore Database** → **데이터베이스 만들기**  
→ **프로덕션 모드**로 시작 (보안 규칙은 아래에서 따로 배포)  
→ 위치: `asia-northeast3` (서울) 권장

### 4. Storage 버킷 활성화

Firebase Console → **Storage** → **시작하기**  
→ 기본 규칙으로 시작 후 필요 시 수정

### 5. 웹 앱 등록 및 설정값 복사

Firebase Console → 프로젝트 설정 (⚙️) → **앱 추가** → 웹 (`</>`)  
→ 앱 닉네임 입력 후 등록  
→ **Firebase SDK 설정** 섹션에서 설정값 확인

---

## 로컬 개발 환경 설정

### 1. 저장소 복제 및 패키지 설치

```bash
git clone <repo-url>
cd returnlife
npm install
```

### 2. 환경변수 파일 작성

프로젝트 루트에 `.env.local` 파일을 생성합니다.

```bash
# .env.local
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSy...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=returnoneday.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=returnoneday
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=returnoneday.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abcdef
```

### 3. 개발 서버 실행

```bash
npm run dev
# http://localhost:3000
```

---

## Firestore 보안 규칙 및 인덱스 배포

Firebase CLI가 필요합니다.

```bash
npm install -g firebase-tools
firebase login
firebase use returnoneday   # 프로젝트 ID로 교체

# 보안 규칙 배포
firebase deploy --only firestore:rules

# 복합 인덱스 배포 (쿼리 오류 방지)
firebase deploy --only firestore:indexes
```

---

## 첫 번째 관리자 계정 만들기

> ⚠️ 관리자 계정은 회원가입 화면에서 만들 수 없습니다.  
> 스크립트 또는 아래 수동 방법으로 생성하세요.

### 방법 A — 스크립트로 생성 (권장)

**Step 1 — Firebase Auth에 계정이 없으면 먼저 생성**

Firebase Console → **Authentication** → **사용자 추가** → 이메일/비밀번호 입력

**Step 2 — 서비스 계정 키 준비**

Firebase Console → 프로젝트 설정(⚙️) → **서비스 계정** → **새 비공개 키 생성**  
→ 다운로드된 JSON 파일을 프로젝트 루트에 `serviceAccountKey.json`으로 저장  
→ ⚠️ 이 파일은 `.gitignore`에 등록되어 있어 GitHub에 업로드되지 않습니다

**Step 3 — 스크립트 실행**

`scripts/create-admin.ts` 상단의 `ADMIN_UID`, `ADMIN_EMAIL`, `ADMIN_NAME` 값을 실제 값으로 수정한 뒤:

```bash
npm run create-admin
```

이미 문서가 있으면 현재 값을 출력하고 덮어씁니다.

**Step 4 — 로그인 확인**

`http://localhost:3000/login`에서 로그인 → `/admin`으로 이동하면 성공

---

### 방법 B — Firebase Console에서 수동 생성

Firebase Console → **Firestore** → `users` 컬렉션 → **문서 추가**  
→ 문서 ID: Firebase Auth UID  
→ 아래 필드 입력:

| 필드 | 타입 | 값 |
|------|------|----|
| `uid` | string | (Auth UID) |
| `name` | string | 관리자 이름 |
| `email` | string | 이메일 |
| `role` | string | `admin` |
| `status` | string | `active` |
| `branchIds` | array | (비워두기) |
| `createdAt` | timestamp | 현재 시각 |
| `updatedAt` | timestamp | 현재 시각 |

---

## 샘플 데이터 시딩

시딩 전에 관리자와 지점장 계정을 Firebase Auth에서 먼저 만들고 UID를 확인합니다.

```bash
# scripts/seed.ts 상단의 두 변수를 실제 UID로 교체
# const ADMIN_UID = "REPLACE_WITH_REAL_ADMIN_UID";
# const MANAGER_UID = "REPLACE_WITH_REAL_MANAGER_UID";

# Service Account 키 파일 준비
# Firebase Console → 프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성
export GOOGLE_APPLICATION_CREDENTIALS="./serviceAccountKey.json"

npx tsx scripts/seed.ts
```

시딩 내용:
- 지점 2개: **짐플릭스 시청점**, **짐플릭스 신진주역점**
- 관리자 1명, 지점장 1명
- 7일치 일일 보고 (오늘 `draft`, 나머지 `submitted`)
- 캠페인 1개

---

## Vercel 배포

### 1. GitHub 연결

Vercel Dashboard → **Add New Project** → GitHub 저장소 선택

### 2. 환경변수 등록

Vercel Dashboard → 프로젝트 → **Settings** → **Environment Variables**  
아래 6개를 모두 추가합니다:

```
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
```

또는 CLI로 일괄 등록:

```bash
npx vercel env add NEXT_PUBLIC_FIREBASE_API_KEY
# 나머지도 동일하게 반복
npx vercel --prod  # 재배포
```

### 3. Firebase Auth 승인 도메인 추가

Firebase Console → Authentication → **Settings** → **승인된 도메인**  
→ Vercel 배포 URL 추가 (예: `returnlife-xxx.vercel.app`)

---

## 라우팅 구조

```
/login              로그인
/signup             회원가입 (지점장만 — 관리자는 콘솔에서 생성)
/forgot-password    비밀번호 재설정
/pending            승인 대기 화면

/manager            지점장 홈
/manager/report/new 일일보고 작성 (4단계)
/manager/reports    보고 내역
/manager/dashboard  지점 대시보드
/manager/issues     운영 이슈

/admin              관리자 오늘 현황
/admin/reports      보고 관리
/admin/branches     지점 관리
/admin/users        사용자 관리
/admin/issues       이슈 관리
/admin/campaigns    캠페인 관리
/admin/export       CSV 내보내기
```

## 사용자 역할

| 역할 | 회원가입 방법 | 초기 상태 | 설명 |
|------|-------------|----------|------|
| `branch_manager` | 일반 회원가입 | `pending` | 관리자 승인 후 담당 지점 배정 필요 |
| `admin` | Firestore 콘솔에서 직접 생성 | `active` | 전체 관리 권한 |

> 지점장이 회원가입하면 `pending` 상태로 대기합니다.  
> 관리자가 `/admin/users`에서 `active`로 변경하고 지점을 배정해야 사용 가능합니다.

---

## 빌드 확인

```bash
npm run typecheck   # TypeScript 타입 검사
npm run lint        # ESLint
npm run build       # 프로덕션 빌드
```

<!-- deploy test: 2026-06-22 21:56:37 -->
