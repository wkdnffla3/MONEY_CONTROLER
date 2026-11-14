import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { registerServiceWorker } from './lib/pwa';
import './styles.css';

registerServiceWorker();

// 웹폰트: 화면을 먼저 그린 뒤 불러옴 (글꼴 파일을 기다리느라 첫 화면이 늦어지지 않게)
const FONT_URL = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap';
requestAnimationFrame(() => {
  if (document.querySelector('link[data-app-fonts]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = FONT_URL;
  link.dataset.appFonts = '1';
  document.head.appendChild(link);
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
