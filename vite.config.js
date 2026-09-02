import { defineConfig } from 'vite';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));

export default defineConfig({
  base: './', // Essential for relative asset paths in local Tizen file/web server environment
  define: {
    // Lets the UI show which build is actually running — useful for
    // confirming a TV picked up a new publish rather than a stale install.
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
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
