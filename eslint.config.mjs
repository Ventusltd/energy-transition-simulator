// ESLint flat config. Deliberately permissive: it reports real mistakes (undefined names, duplicate keys,
// unreachable code) and leaves formatting to the code that is already here. No mass reformat.
//   npm run lint        report
//   npm run lint:fix    apply the safe automatic fixes only
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'test-output/**', '**/*.min.js', 'prototype/**/*.json'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      // SIM is the overlay's plug-in API (window.SIM in prototype/overlay.html); maplibregl is loaded by a script tag.
      globals: { ...globals.browser, ...globals.node, ...globals.es2024, SIM: 'readonly', maplibregl: 'readonly' },
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-prototype-builtins': 'off',
      'no-cond-assign': 'off',
      'no-control-regex': 'off',
      'no-inner-declarations': 'off',
      'no-fallthrough': 'warn',
      'no-func-assign': 'warn',
      'no-redeclare': 'warn', // `var` re-declared in one existing module
      'no-useless-escape': 'warn',
      'no-constant-condition': ['warn', { checkLoops: false }],
      'no-irregular-whitespace': ['error', { skipStrings: true, skipComments: true, skipRegExps: true, skipTemplates: true }],
    },
  },
  { files: ['**/*.cjs'], languageOptions: { sourceType: 'commonjs' } },
];
