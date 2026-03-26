import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Setup from './screens/Setup.js';
import NowPlaying from './screens/NowPlaying.js';

function RequireDevice({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('device_token');
  if (!token) return <Navigate to="/setup" replace />;
  return <>{children}</>;
}

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/setup" element={<Setup />} />
      <Route path="/" element={<RequireDevice><NowPlaying /></RequireDevice>} />
    </Routes>
  </BrowserRouter>,
);
