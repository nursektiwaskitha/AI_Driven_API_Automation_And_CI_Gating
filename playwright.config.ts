/**
 * Thin entry so `npx playwright test` from the repo root picks up the integration
 * config (see scripts/playwright.config.ts). Without this file, Playwright defaults
 * scan the tree and load template specs with a second @playwright/test copy.
 */
export { default } from './scripts/playwright.config';
