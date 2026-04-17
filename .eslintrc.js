'use strict';

module.exports = {
  env: { node: true, es2021: true },
  extends: ['eslint:recommended'],
  parserOptions: { ecmaVersion: 2021 },
  rules: {
    'no-console': 'off',
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-process-exit': 'off',
  },
  ignorePatterns: ['node_modules/', 'coverage/', 'admin/dist/', 'public/'],
};
