/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** מקור ה-API המלא בפרודקשן (למשל https://api.craftmind-ai.com). ריק בפיתוח. */
  readonly VITE_API_URL?: string;
  /** תת-הדומיין של הטננט, כשה-API יושב על דומיין אחר מהממשק. */
  readonly VITE_TENANT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
