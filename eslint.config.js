import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

// Build output is compiled, not authored — linting it produces false
// failures on whatever the bundler emitted.
export default tseslint.config(
  { ignores: ['build/**', 'dist/**', 'main.js'] },
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      // The _-prefix is the codebase's convention for intentionally unused
      // parameters (e.g. fake-transport callbacks that ignore their args).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
