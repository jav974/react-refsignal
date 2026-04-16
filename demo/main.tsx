import { createRoot } from 'react-dom/client';
import GraphBenchmark from './graph-benchmark';

// StrictMode removed for clean benchmark numbers (it double-renders in dev).
createRoot(document.getElementById('root')!).render(<GraphBenchmark />);
