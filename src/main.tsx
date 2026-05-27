import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// IMPORTANT: install the Tauri IPC bridge before anything else imports the
// renderer modules that touch `window.api`.
import './api/tauri-bridge.js';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { App } from './App.js';
import { SourceWindow } from './SourceWindow.js';
import { useProjectStore } from './stores/projectStore.js';
import './styles.css';

// Debug handle: lets DevTools console inspect the store.
// `__kj.store.getState().project.data.cards.length`
(window as unknown as { __kj: unknown }).__kj = { store: useProjectStore };

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

// Distinguish main vs. source viewer window by Tauri WebviewWindow label.
// The legacy Electron build used a `#source` URL hash; the Tauri version
// uses the label set in `tauri-bridge.openSourceView()` because the dev
// server doesn't reliably serve hash-bearing URLs.
const isSourceWindow = (() => {
  try {
    return getCurrentWebviewWindow().label === 'source';
  } catch {
    return window.location.hash === '#source';
  }
})();

createRoot(root).render(
  <StrictMode>{isSourceWindow ? <SourceWindow /> : <App />}</StrictMode>
);
