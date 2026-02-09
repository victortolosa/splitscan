import { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Landing } from './routes/Landing';
import { Workspace } from './routes/Workspace';

const Scanner = lazy(() => import('./routes/Scanner').then((mod) => ({ default: mod.Scanner })));

export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="app-shell">Loading…</div>}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/:sessionId" element={<Workspace />} />
          <Route path="/:sessionId/scan" element={<Scanner />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
