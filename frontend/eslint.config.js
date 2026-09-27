import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', 'scripts/**/*.py'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
    },
  },
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/test/**'],
    rules: {
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    files: ['*.{js,cjs,ts}', 'scripts/**/*.{mjs,ts}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2023, globals: globals.node },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
