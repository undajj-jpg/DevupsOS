import next from 'eslint-config-next';
import tseslint from 'typescript-eslint';

/**
 * eslint-config-next ships a flat config array in v16, so it is spread
 * directly rather than routed through the eslintrc compatibility shim.
 */
const config = [
  ...next,
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'next-env.d.ts',
      'db/migrations/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
];

export default config;
