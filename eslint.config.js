import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'dist-electron-new/**',
      'build/**',
      'backup/**',
      'backupcurrent/**',
      'tools/**',
      '**/*.md'
    ]
  },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        __phaserScene: 'readonly',
        __phaserSceneReady: 'readonly',

      }
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-undef': ['error'],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-dupe-class-members': 'warn',
      'no-useless-assignment': 'warn',
      'no-dupe-keys': 'warn',
      'no-prototype-builtins': 'warn',
      'no-empty': 'warn'
    }
  }
];
