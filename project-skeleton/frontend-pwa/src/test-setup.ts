import '@testing-library/jest-dom/vitest';

// jsdom אינו מממש ResizeObserver, ורכיבי Radix (Switch, Select) מודדים
// את עצמם דרכו בזמן mount. בלי זה כל בדיקה שמרנדרת אחד מהם נופלת עוד
// לפני שהיא בודקת משהו.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
