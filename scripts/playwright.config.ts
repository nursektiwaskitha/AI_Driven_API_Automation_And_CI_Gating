import path from 'path';
import { defineConfig, devices } from '@playwright/test';

/** Repo root (this file lives in scripts/). */
const repoRoot = path.join(__dirname, '..');
const applicationDir = path.join(repoRoot, 'application_code');

/**
 * Integration Playwright config (not the template under playwright_template/).
 * Uses @playwright/test from playwright_template via CI / npm exec.
 */
export default defineConfig({
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: [
        ['list'],
        ['html', { outputFolder: path.join(repoRoot, 'playwright-report') }],
        ['junit', { outputFile: path.join(repoRoot, 'test-results', 'results.xml') }],
    ],
    webServer: [
        {
            command: 'go run main.go',
            cwd: applicationDir,
            url: 'http://127.0.0.1:8080/api/health',
            reuseExistingServer: !process.env.CI,
            timeout: 120000,
        },
        {
            command: 'npm run dev -- --hostname 127.0.0.1 --port 3000',
            cwd: applicationDir,
            url: 'http://127.0.0.1:3000',
            reuseExistingServer: !process.env.CI,
            timeout: 300000,
        },
    ],
    projects: [
        {
            name: 'chromium',
            testDir: path.join(repoRoot, 'generated_test', 'e2e'),
            testMatch: '**/*.spec.ts',
            use: {
                ...devices['Desktop Chrome'],
                baseURL: 'http://127.0.0.1:3000',
                trace: 'retain-on-failure',
                screenshot: 'only-on-failure',
                video: 'retain-on-failure',
                actionTimeout: 15000,
                navigationTimeout: 120000,
            },
        },
        {
            name: 'api-tests',
            testDir: path.join(repoRoot, 'generated_test', 'api'),
            testMatch: '**/*.spec.ts',
            use: {
                baseURL: 'http://127.0.0.1:8080',
                extraHTTPHeaders: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                trace: 'retain-on-failure',
            },
        },
    ],
});
