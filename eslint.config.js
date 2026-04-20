import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import playwright from "eslint-plugin-playwright";

export default [
  js.configs.recommended,
  {
    ...playwright.configs["flat/recommended"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        project: "./tsconfig.json",
      },
      globals: {
        node: true,
        browser: true,
        es2021: true,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      playwright,
    },
    files: ["**/*.ts", "**/*.js"],
    rules: {
      ...tseslint.configs.recommended.rules,
      ...playwright.configs["flat/recommended"].rules,
      indent: ["error", 4],
      "linebreak-style": ["error", "unix"],
      quotes: ["error", "single"],
      semi: ["error", "never"],
      "@typescript-eslint/no-floating-promises": "error",
      "max-len": ["error", { code: 120 }],
    },
  },
  eslintConfigPrettier,
];
