import type { Config } from 'jest';

/**
 * בדיקות אינטגרציה — רצות מול Postgres אמיתי.
 *
 * אי אפשר לבדוק RLS מול mock: כל הנקודה היא שמסד הנתונים עצמו
 * אוכף את הבידוד. בדיוק בגלל זה הבאג הזה שרד עד עכשיו.
 */
const config: Config = {
  rootDir: '..',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/integration/**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testTimeout: 60_000,
  maxWorkers: 1,
  clearMocks: true,
};
export default config;
