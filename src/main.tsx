import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import './styles.css';
import './lib/firebase';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
