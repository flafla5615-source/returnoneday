import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  transform: {
    "^.+\\.ts$": ["ts-jest", {
      tsconfig: {
        module: "commonjs",
        moduleResolution: "node",
        esModuleInterop: true,
        strict: true,
      },
    }],
  },
};

export default config;
