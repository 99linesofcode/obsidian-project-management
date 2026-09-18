import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

// Build output is compiled, not authored — linting it produces false
// failures on whatever the bundler emitted.
export default tseslint.config(
  { ignores: ['build/**', 'dist/**', 'main.js'] },
  ...tseslint.configs.recommended,
  prettier,
);
