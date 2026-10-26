import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset URLs support both GitHub project Pages and root-domain hosts.
  base: './',
  // MapLibre 6 loads its web worker relative to its own module URL; pre-bundling breaks that path.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 3000,
    rolldownOptions: {
      output: {
        // Separate vendor chunks download in parallel and stay cached across game updates.
        codeSplitting: {
          groups: [
            { name: 'rapier', test: /@dimforge/ },
            { name: 'maplibre', test: /maplibre-gl/ },
            { name: 'three', test: /node_modules[\\/]three/ },
          ],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/._*'],
  },
});
