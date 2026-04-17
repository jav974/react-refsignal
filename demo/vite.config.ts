import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Order matters — longer prefixes must come first so Vite matches them
      // before the bare 'react-refsignal' entry.
      'react-refsignal/persist': resolve(__dirname, '../src/persist/index.ts'),
      'react-refsignal/broadcast': resolve(
        __dirname,
        '../src/broadcast/index.ts',
      ),
      'react-refsignal': resolve(__dirname, '../src/index.ts'),
    },
    // Force a single React instance — react-refsignal source lives at ../src
    // and would otherwise resolve to ../node_modules/react, while the demo
    // imports react from ./node_modules/react. Two instances break hooks.
    dedupe: ['react', 'react-dom'],
  },
});
