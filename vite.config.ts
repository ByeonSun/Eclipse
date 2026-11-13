import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// GitHub Pages 의 저장소 하위 경로(/Eclipse/)에서도 동작하도록 상대 경로로 빌드한다.
// 라우팅은 해시(#/...) 방식이라 새로고침해도 404 가 나지 않는다.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
  },
})
