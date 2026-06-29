import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "tests/**",
    "jest.config.ts",
    // Firebase Functions compiled output
    "functions/lib/**",
  ]),
  {
    rules: {
      // 데이터 페칭 패턴에서 setLoading(true)를 effect 내부에서 호출하는 것은
      // 의도된 UX 패턴이므로 오류 대신 경고로 처리
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
