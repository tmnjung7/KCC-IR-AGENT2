import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import AppV2 from './AppV2.tsx';
import './index.css';

// 메인(/) = 개선판. 오리지널은 /original (구 /v2 주소도 개선판으로 연결)
const isOriginal = window.location.pathname.startsWith('/original') || window.location.pathname.startsWith('/v1');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isOriginal ? <App /> : <AppV2 />}
  </StrictMode>,
);
