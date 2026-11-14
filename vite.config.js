import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // 자주 안 바뀌는 라이브러리는 따로 묶음 → 앱을 다시 배포해도 휴대폰이 이 파일은 다시 받지 않음
        manualChunks: {
          react: ['react', 'react-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
});
