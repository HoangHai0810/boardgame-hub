import React from 'react';
import { createRoot } from 'react-dom/client';
import PlatformApp from './platform/PlatformApp';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><PlatformApp /></React.StrictMode>,
);
