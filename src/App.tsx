import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { OperatorPage } from './pages/OperatorPage';
import { TrackPage } from './pages/TrackPage';
import { VisitorPage } from './pages/VisitorPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/visitor" element={<VisitorPage />} />
        <Route path="/operator" element={<OperatorPage />} />
        {/* 방문자가 자기 폰으로 QR 을 스캔해 들어오는 외부 페이지. */}
        <Route path="/track/:jobId" element={<TrackPage />} />
        {/* 기본 진입은 운영자 모드 — 부스 세팅 시 첫 화면이 자연스럽도록. */}
        <Route path="/" element={<Navigate to="/operator" replace />} />
        <Route path="*" element={<Navigate to="/operator" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
