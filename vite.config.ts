import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import dts from 'vite-plugin-dts';
import { libInjectCss } from 'vite-plugin-lib-inject-css';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    react(),
    libInjectCss(),
    dts({
      include: ['src/index.tsx'],
    }),
    tailwindcss(),
  ],
  optimizeDeps: {
    exclude: ['@voicegpt'],
  },
  build: {
    copyPublicDir: false,
    lib: {
      entry: resolve(__dirname, 'src/index.tsx'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: ['react', 'react/jsx-runtime'],
    },
  },
});