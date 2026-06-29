import js from "@eslint/js";
import globals from "globals";
import stylistic from "@stylistic/eslint-plugin";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

const stylisticRules = {
  "@stylistic/indent": ["error", 2, { SwitchCase: 1 }],
  "@stylistic/quotes": [
    "error",
    "double",
    { avoidEscape: true, allowTemplateLiterals: "always" },
  ],
  "@stylistic/semi": ["error", "always"],
  "@stylistic/comma-dangle": ["error", "always-multiline"],
  "@stylistic/no-trailing-spaces": "error",
  "@stylistic/eol-last": ["error", "always"],
  "@stylistic/no-multiple-empty-lines": ["error", { max: 1, maxEOF: 0 }],
  "@stylistic/object-curly-spacing": ["error", "always"],
  "@stylistic/array-bracket-spacing": ["error", "never"],
  "@stylistic/space-before-blocks": ["error", "always"],
  "@stylistic/keyword-spacing": ["error", { before: true, after: true }],
  "@stylistic/space-infix-ops": "error",
  "@stylistic/arrow-spacing": ["error", { before: true, after: true }],
  "@stylistic/comma-spacing": ["error", { before: false, after: true }],
  "@stylistic/nonblock-statement-body-position": ["error", "below"],
};

export default [
  {
    ignores: ["node_modules/**", "public/**"],
  },
  js.configs.recommended,
  {
    plugins: { "@stylistic": stylistic },
    rules: stylisticRules,
  },
  {
    // Node + shared ESM: plugin entry, server, the shared core, tooling, tests.
    // The core also runs in the browser (bundled into the webapp) but uses only
    // standard globals, so the Node set is a safe superset here.
    files: [
      "index.js",
      "src/**/*.js",
      "test/**/*.js",
      "eslint.config.js",
      "webapp/vite.config.js",
    ],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // React webapp (browser, JSX). Uses the automatic JSX runtime, so React does
    // not need to be in scope.
    files: ["webapp/src/**/*.{js,jsx}"],
    ...react.configs.flat.recommended,
  },
  {
    files: ["webapp/src/**/*.{js,jsx}"],
    ...react.configs.flat["jsx-runtime"],
  },
  {
    files: ["webapp/src/**/*.{js,jsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: "detect" } },
    rules: {
      // No PropTypes/TS in this project; component contracts live in JSDoc.
      "react/prop-types": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
