import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // 这些模块有 globalThis 单例（dev 热重载用），文件级 mock 用 resetModules 会丢掉，
    // 测试内用唯一 sessionId 隔离，这里不开 isolation
    environment: 'node',
    testTimeout: 10_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // Next 的 server-only 哨兵包：vitest 里没有，指向空模块
      'server-only': path.resolve(__dirname, 'tests/mocks/server-only.ts'),
    },
  },
})
