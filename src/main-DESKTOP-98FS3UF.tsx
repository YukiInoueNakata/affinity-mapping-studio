import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { SourceWindow } from './SourceWindow.js';
import { useProjectStore } from './stores/projectStore.js';
import { syncManager } from './sync/syncManager.js';
import './styles.css';

// Debug handle: lets DevTools console inspect the store and sync state.
// `__kj.store.getState().project.data.cards.length`
// `__kj.sync._debugSnapshot()`  (only in team builds; stub otherwise)
(window as unknown as { __kj: unknown }).__kj = __INCLUDE_SYNC__
  ? { store: useProjectStore, sync: syncManager }
  : { store: useProjectStore };

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

const isSourceWindow = window.location.hash === '#source';

createRoot(root).render(
  <StrictMode>{isSourceWindow ? <SourceWindow /> : <App />}</StrictMode>
);
