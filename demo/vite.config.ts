import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'react-refsignal': resolve(__dirname, '../src/index.ts'),
    },
    // Force a single React instance — react-refsignal source lives at ../src
    // and would otherwise resolve to ../node_modules/react, while the demo
    // imports react from ./node_modules/react. Two instances break hooks.
    dedupe: ['react', 'react-dom'],
  },
});
