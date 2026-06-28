import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      reporter: ['text', 'html'],
      thresholds: {
        'src/database.js': { lines: 95 },
        'src/arxiv.js':    { lines: 90 },
        'src/scheduler.js': { lines: 95 }
      }
    }
  }
})