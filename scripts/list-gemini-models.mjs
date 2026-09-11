/**
 * 내 API 키로 쓸 수 있는 Gemini 모델 목록 확인
 *
 * 실행:
 *   npm run gemini:models
 *
 * 사전 준비:
 *   .env.local 에 GEMINI_API_KEY=... 를 넣어둔다.
 *
 * 왜 필요한가:
 *   모델 이름은 계속 바뀐다(신규 출시·구버전 종료). 코드에 박아둔 모델명이
 *   더 이상 없으면 404 가 난다. 배포 전에 이 스크립트로 실제 사용 가능한
 *   이름을 확인하고 GEMINI_MODEL 에 지정하는 게 안전하다.
 */

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("\n❌ GEMINI_API_KEY 가 없습니다.");
  console.error("   .env.local 에 아래 줄을 추가한 뒤 다시 실행해주세요.\n");
  console.error("   GEMINI_API_KEY=발급받은_키\n");
  process.exit(1);
}

const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
  headers: { "x-goog-api-key": apiKey },
});

if (!res.ok) {
  const detail = await res.text().catch(() => "");
  console.error(`\n❌ 조회 실패 (HTTP ${res.status})`);
  // 키가 그대로 찍히지 않도록 응답 앞부분만 보여준다
  console.error(detail.slice(0, 400));
  if (res.status === 400 || res.status === 403) {
    console.error("\n키가 잘못되었거나 Generative Language API 가 비활성화되어 있을 수 있습니다.");
    console.error("https://aistudio.google.com/apikey 에서 키를 확인해주세요.\n");
  }
  process.exit(1);
}

const { models = [] } = await res.json();

// generateContent 를 지원하는 모델만 추린다 (임베딩 전용 모델 등 제외)
const usable = models.filter((m) => m.supportedGenerationMethods?.includes("generateContent"));

console.log(`\n사용 가능한 모델 ${usable.length}개 (generateContent 지원)\n`);
for (const m of usable) {
  const id = m.name.replace(/^models\//, "");
  const inputLimit = m.inputTokenLimit ? `입력 ${m.inputTokenLimit.toLocaleString()}토큰` : "";
  console.log(`  ${id}`);
  console.log(`    ${m.displayName ?? ""} ${inputLimit}`);
}

console.log("\n사용할 모델을 .env.local 과 Vercel 환경변수에 지정하세요:");
console.log("  GEMINI_MODEL=위 목록 중 하나\n");
