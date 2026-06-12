// Build-time constants injected by electron.vite.config.ts via Vite `define`.

/** True if the realtime sync subsystem (Yjs / WebSocket provider / SyncConnectDialog)
 *  is included in this build.  False for the sync-free "studio" build. */
declare const __INCLUDE_SYNC__: boolean;

/** App version, injected from package.json `version` at build time (single source of truth). */
declare const __APP_VERSION__: string;
