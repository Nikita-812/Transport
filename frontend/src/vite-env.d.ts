/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `1` — mock-адаптер API вместо бекенда (`npm run dev:mock`, файл .env.mock). */
  readonly VITE_API_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
