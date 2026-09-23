import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Lint configuration.
 *
 * Type-aware rules are enabled for the product packages: most of the mistakes
 * worth catching in this codebase (a floating promise across the bridge, an
 * unchecked `any` from a host reply) are invisible without type information.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/dist-types/**",
      "build/**",
      "coverage/**",
      "node_modules/**",
      "**/*.tsbuildinfo",
    ],
  },

  js.configs.recommended,

  // Product sources — type-aware.
  {
    files: ["packages/*/src/**/*.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        { allowExpressions: false, allowTypedFunctionExpressions: true },
      ],
      // Every user-visible message goes through the message catalogue; a bare
      // console call in the panel is invisible to users and to diagnostics.
      "no-console": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-magic-numbers": [
        "warn",
        { ignore: [-1, 0, 1, 2], ignoreArrayIndexes: true, enforceConst: true },
      ],
    },
  },

  // Tests — the same type safety, minus the production-only restrictions.
  {
    files: ["packages/*/tests/**/*.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "no-magic-numbers": "off",
      "no-console": "off",
    },
  },

  // Root-level TypeScript config files: parsed as TypeScript, but without type
  // information — they are build configuration, not product code.
  {
    files: ["*.config.ts"],
    languageOptions: { parser: tseslint.parser },
    rules: { "no-undef": "off" },
  },

  // Build tooling runs in Node and reports to a terminal.
  {
    files: ["scripts/**/*.mjs", "tools/**/*.mjs", "**/*.config.mjs", "*.config.js"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
    rules: { "no-console": "off" },
  },
);
