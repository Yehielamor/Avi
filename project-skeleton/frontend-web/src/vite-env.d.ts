/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** מקור ה-API המלא בפרודקשן (למשל https://api.craftmind-ai.com). ריק בפיתוח. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
