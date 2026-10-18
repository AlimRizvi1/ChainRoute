/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_MODE?: "mock" | "real";
  readonly VITE_API_ROOT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
