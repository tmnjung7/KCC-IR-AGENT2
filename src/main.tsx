import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import AppV2 from './AppV2.tsx';
import './index.css';

// /v2 → 개선판, 그 외 → 오리지널 (양쪽 헤더의 전환 탭으로 이동)
const isV2 = window.location.pathname.startsWith('/v2');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isV2 ? <AppV2 /> : <App />}
  </StrictMode>,
);
