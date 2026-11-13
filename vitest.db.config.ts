import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/db/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
})
