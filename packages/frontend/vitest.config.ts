import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pure logic tests (timeline geometry, projection wiring) — no DOM needed.
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
