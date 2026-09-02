import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // Essential for relative asset paths in local Tizen file/web server environment
  server: {
    port: 5173,
    open: false,
    host: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2015', // Wide compatibility with Tizen WebKit and Chromium engines
    minify: 'esbuild',
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
        manualChunks(id) {
          if (id.includes('hls.js')) {
            return 'hls';
          }
        }
      }
    }
  }
});
