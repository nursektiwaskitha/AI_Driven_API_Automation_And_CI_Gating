# AI-Driven API Automation & CI Gating

This repo wires an LLM to Playwright: it generates API specs from Swagger and a browser spec from the real checkout page, then runs everything against the bundled Go API and Next.js app. GitHub Actions is the quality gate.

### Quick start

You’ll need Node (CI uses 22), Go, and a Gemini key in the environment as `LLM_API_KEY`. The Playwright files under `generated_test/**/generated.spec.ts` are produced by `scripts/generate-tests.js`; they are gitignored, so you won’t see them in git until you run the generator.

To try CI without pushing: add `LLM_API_KEY` under repo **Settings → Secrets → Actions**, open **Actions**, pick **“AI Test Generation & Quality Gate”**, and use **Run workflow**. When a run fails, download the HTML / JUnit artifacts from the run page.

For a full local loop (install, generate, test), follow [Running tests locally](#running-tests-locally): export the key, run `node scripts/generate-tests.js`, then `npx playwright test`.

**Jump to:** [At a glance](#at-a-glance) · [Repo map](#repo-map) · [Prompts](#llm-prompt-design) · [CI](#how-ci-gates-merges) · [Local run](#running-tests-locally) · [Scaling & quality](#scaling-to-many-endpoints) · [Layout](#repository-layout) · [Scope](#scope)

### 1. LLM prompt design

Gemini turns **Swagger** plus **`main.go`-aligned notes** into API Playwright tests, and **`page.tsx`** into browser tests. `scripts/generate-tests.js` writes both files under `generated_test/`, validates structure, and can cache locally; CI regenerates every run. **GitHub Actions** installs deps, runs the generator with `LLM_API_KEY`, then `npx playwright test`; failures block the workflow, and HTML/JUnit artifacts are kept for debugging.

### 2. How Swagger is translated into Playwright tests

The generator reads `application_code/docs/swagger.json` as the source of paths and schemas. The prompt does **not** treat the spec as truth for every status or message: it merges OpenAPI with **handler behavior** (see `apiImplementationNotes()`). The model emits `request.get/post/fetch` against **relative** `/api/...` URLs; `scripts/playwright.config.ts` sets `baseURL` to the local Go server so tests stay portable.

### 3. How the generation process works

Run `node scripts/generate-tests.js` with `LLM_API_KEY` set. The script finds Swagger, reads UI source for E2E, calls Gemini twice (API suite, then E2E suite), runs **`validatePlaywrightCode`**, then writes `generated_test/api/generated.spec.ts` and `generated_test/e2e/generated.spec.ts`. Locally you can use disk cache under `.cache/`; CI sets **`LLM_SKIP_CACHE=1`** so every pipeline run regenerates. If a generated file is missing, the script skips cache for that suite so you are not stuck on stale output.

### 4. How CI gates production

`.github/workflows/ci.yml` is the gate: install dependencies and browsers, **generate** tests, then **`npx playwright test`**. Any failing step fails the workflow, so a pull request cannot merge green unless generation and both API and E2E runs succeed. The same pattern is what you would wire in front of a deployment job (identical artifact: “only promote if this workflow passed”). HTML and JUnit outputs are uploaded as **artifacts** for review. **workflow_dispatch** lets you run the full pipeline without a new commit.

### 5. How this approach scales to many endpoints

See [Scaling to many endpoints](#scaling-to-many-endpoints). In short: **shard** the OpenAPI document by tag or prefix and generate multiple smaller files or `test.describe` blocks; add **schema-based** response checks when the spec grows; keep **cache keys** derived from hashed spec slices and bump an internal prompt version when instructions change.

### 6. How to prevent or detect incorrect / hallucinated AI-generated tests

See [Quality, hallucinations, flakes](#quality-hallucinations-flakes). In short: **structural** checks before write; prompts grounded in `main.go` and `page.tsx`; prefer **tolerant** assertions (`toMatchObject`, short regex) over brittle prose matching; optional next step is **`tsc --noEmit`** on generated files in CI.

### 7. How to handle flaky or unstable tests

See [Quality, hallucinations, flakes](#quality-hallucinations-flakes). In short: CI **retries**, **single worker**, and **traces / screenshots / video** on failure; fix root causes (server readiness, timeouts) rather than stacking `waitForTimeout`. Cold **Go + Next** startup is the usual stressor in this project.

### 8. How the LLM generates E2E selectors and keeps them stable

The E2E prompt injects **`page.tsx`** and tells the model to prefer **`input[name="…"]`** and **`getByRole`** for buttons, because labels are not always wired with `htmlFor`. Success is asserted from **user-visible** copy that exists in the source. The prompt also warns about **ambiguous** text (e.g. a substring that matches both a debug button and a status banner) so Playwright strict mode does not fail for the wrong reason.

### 9. How to prevent flaky frontend tests

Beyond §7: use **deterministic** test data (fixed card numbers, amounts), avoid assertions tied to **animation** timing, wait on **locators** or network stability instead of arbitrary sleeps, and keep E2E tests **independent** (no order dependency). Running against a **local** `webServer` in CI reduces external noise compared to hitting shared staging environments.

## Repo map

| Piece | Role |
|--------|------|
| `scripts/generate-tests.js` | Calls Gemini; reads Swagger + `page.tsx`; writes `generated_test/api` and `generated_test/e2e` specs. |
| `scripts/playwright.config.ts` | Integration Playwright config: dual `webServer` (Go :8080, Next :3000), API + E2E projects. |
| Root `playwright.config.ts` | Re-exports the script config so `npx playwright test` from the repo root does not pick up `playwright_template/tests`. |
| Root `package.json` | Pins `@playwright/test` so the CLI and generated specs share one install (see troubleshooting if imports break). |
| `.github/workflows/ci.yml` | Install → generate tests → Playwright → upload HTML + JUnit artifacts. |
| `playwright_template/`, `application_code/` | Bundled upstream-style trees: not changed in this repo; the generator only reads Swagger, `page.tsx`, and the template’s example API spec for style. |

The UI is a **card payment** checkout in `page.tsx` (email, card, expiry, CVV, amount, submit, success messaging). Generated E2E tests are driven from that source so selectors and expectations match what ships in `application_code/`.

### Reports

HTML lands in `playwright-report/` and JUnit in `test-results/`; both stay out of git. CI still uploads them as artifacts so you can inspect a failed run without checking in logs.

## LLM prompt design

- **API:** Load `application_code/docs/swagger.json`, optional style hint from `playwright_template/tests/api/example-api.spec.ts`, plus short **implementation notes** aligned with `main.go` (status codes and shapes the spec often gets wrong).
- **E2E:** Embed `application_code/app/page.tsx` so selectors and copy match what is actually rendered.
- **Cleanup:** Strip markdown fences from model output; run a small **structural** check (`validatePlaywrightCode`) before writing files.

## How Swagger becomes Playwright tests

OpenAPI gives paths and schemas; the prompt ties expectations to **real handler behavior** where it diverges from the doc. API tests use **relative** URLs (`/api/…`); `baseURL` in `scripts/playwright.config.ts` points at `http://127.0.0.1:8080`.

## Generation workflow

1. Resolve Swagger under `application_code/docs/`.
2. Call Gemini (`gemini-2.5-flash`) for API + E2E TypeScript.
3. Write `generated_test/api/generated.spec.ts` and `generated_test/e2e/generated.spec.ts` (only via this script; paths are gitignored).
4. Optional `.cache/` disk cache for local speed. CI sets `LLM_SKIP_CACHE=1` for a clean generation each run. Delete a generated file to force a refresh for that suite; bump the prompt cache tag in code when you change instructions.

### Regenerate locally

```bash
export LLM_API_KEY="your-gemini-key"
node scripts/generate-tests.js
```

## Running tests locally

```bash
npm ci
npm ci --prefix playwright_template
npm ci --prefix application_code
npx playwright install --with-deps chromium
export LLM_API_KEY="your-gemini-key"
node scripts/generate-tests.js
npx playwright test
```

`scripts/playwright.config.ts` starts `go run main.go` (8080) and `npm run dev` for Next (3000) under `application_code/`, then runs tests in `generated_test/`.

## How CI gates merges

The workflow file is `.github/workflows/ci.yml`. It runs on pushes to `main`, on pull requests, and manually via **Run workflow** in the Actions UI.

Each run installs npm dependencies (repo root plus `playwright_template` and `application_code`), installs Chromium, calls `node scripts/generate-tests.js` with the `LLM_API_KEY` secret, then runs `npx playwright test`. If anything in that chain fails, the job fails. HTML and JUnit from the reporters are uploaded as artifacts (upload steps use `if: always()` so a red run usually still has something to download).

### Secrets

- Local: `export LLM_API_KEY=…`
- GitHub: repository secret `LLM_API_KEY` (never commit the key).

### CI job failed?

1. Empty **`LLM_API_KEY`** on GitHub, or a **fork PR** without secrets.
2. Missing **`application_code/go.sum`** or **`application_code/package-lock.json`** (CI uses `npm ci` there).
3. No artifacts: generation failed, servers did not become ready, or tests crashed before reporters wrote files — read the job log.
4. **`@playwright/test` / double-load errors:** run `npm ci` at the **repo root** and use **`npx playwright test`** from the root (see root `package.json`).

## Scaling to many endpoints

Split large OpenAPI specs **by tag or path prefix** and generate per chunk so prompts stay small and failures are localized. Next hardening: **schema validation** (e.g. openapi-response-validator) on responses. Keep cache keys tied to **spec content** (this script hashes inputs); bump the embedded prompt version when you change generation rules.

## Quality, hallucinations, flakes

LLMs happily output tests that look fine but assert the wrong status or copy. Here we only sanity-check structure before writing files; turning on `tsc --noEmit` for the generated files in CI would catch more mistakes cheaply. For APIs, assert on stable fields (`toMatchObject`, short patterns) instead of pasting entire Go error strings that change between toolchains.

When tests flap, CI already retries, runs one worker, and keeps traces and screenshots. Most pain here is cold start: Go and Next both have to be up before the first assertion. For selectors, stick to `input[name="…"]` and `getByRole`; one real footgun was using `getByText(/backend status/i)` after clicking “check status” — that substring hits both the button and the banner, so Playwright’s strict mode complains. Aim at text that only appears in the banner.

## Extras in this repo

Local disk cache (off in CI), two `webServer` blocks so API and UI tests share the same stack, artifact uploads, and manual workflow runs as described above.

## Repository layout

```
.
├── README.md
├── .gitignore
├── .github/workflows/ci.yml
├── package.json              # pins @playwright/test for root playwright run
├── playwright.config.ts      # re-exports scripts/playwright.config.ts
├── scripts/
│   ├── generate-tests.js
│   └── playwright.config.ts
├── generated_test/           # *.spec.ts generated; gitignored
├── application_code/
└── playwright_template/
```

## Scope

Integration Playwright config lives in `scripts/playwright.config.ts` (re-exported at the repo root) and CI in `.github/workflows/ci.yml`, so `playwright_template/playwright.config.ts` stays the stock template. The Go/Next app under `application_code/` is consumed as-is; this project layers generation and testing on top without modifying those trees.
