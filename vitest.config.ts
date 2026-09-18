import { defineConfig } from 'vitest/config';

// Scope the suite to the tests/ tree. Without this, vitest's default glob
// also picks up *.test.ts files under .direnv (the devshell's flake inputs),
// which are not part of this package and fail to load.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
