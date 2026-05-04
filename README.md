# AI-Driven API Automation & CI Gating

LLM-generated Playwright API and E2E tests, run against the bundled Go API + Next checkout app, with GitHub Actions as the quality gate.

## First time here?

1. **Clone** the repo. You need **Node** (see CI: 22), **Go**, and a **Gemini API key** as `LLM_API_KEY`.
2. **Important:** `generated_test/**/generated.spec.ts` is **not** committed. Tests are created by `scripts/generate-tests.js` (locally or in CI).
3. **Fastest check:** set the `LLM_API_KEY` secret on GitHub, open **Actions → “AI Test Generation & Quality Gate” → Run workflow**, then open artifacts if anything fails.
4. **Local:** install deps (see [Running tests locally](#running-tests-locally)), `export LLM_API_KEY=…`, run `node scripts/generate-tests.js`, then `npx playwright test`.

**Contents:** [PDF checklist 1-9](#assessment-readme-pdf-checklist-1-9) · [Repo map](#repo-map) · [Prompts & generation](#llm-prompt-design) · [CI](#how-ci-gates-merges) · [Local run](#running-tests-locally) · [Scaling & quality](#scaling-to-many-endpoints) · [Layout](#repository-layout) · [PDF constraints](#pdf-vs-your-constraint)

## Assessment README (PDF checklist 1-9)

The written assessment lists nine README topics. Here is where each is addressed in this file and in the repo.

### 1. LLM prompt design

Prompts live in `scripts/generate-tests.js` (not a separate template file): a shared style block (Playwright conventions, `toHaveProperty` semantics, API vs E2E scope) plus **API** and **E2E** bodies built from real inputs. API prompts attach Swagger JSON, a short path summary, optional `example-api.spec.ts` for tone only, and **`apiImplementationNotes()`** so expectations match `main.go` where OpenAPI is wrong or vague. E2E prompts embed the full **`page.tsx`** so the model sees real `name` attributes, button labels, and success copy. Gemini is called with a modest temperature; output is stripped of markdown fences before validation.

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
| `playwright_template/`, `application_code/` | **Read-only** for this submission; generator only reads Swagger, `page.tsx`, and the template’s example API spec for style. |

**Assessment note:** The written brief mentions a generic checkout (name, shipping address, …). The **supplied** UI is a **payment** checkout (`page.tsx`: email, card, expiry, CVV, amount). E2E tests are generated from that file, so they follow the **real** flow (fill → pay → success), not the PDF’s example field names.

### Reports

Playwright writes HTML under `playwright-report/` and JUnit under `test-results/`. Both are gitignored; CI uploads them as **artifacts** so you get logs without committing reports.

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

Workflow: `.github/workflows/ci.yml`.

**When it runs:** push to `main`, pull requests, and **workflow_dispatch** (Actions → “AI Test Generation & Quality Gate” → Run workflow — no commit required).

**Steps:** `npm ci` at repo root and under `playwright_template` / `application_code` → install Chromium → `node scripts/generate-tests.js` (uses `secrets.LLM_API_KEY`) → `npx playwright test`. Failure at any step fails the job (PR gate). Artifacts: HTML report + JUnit.

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

Models invent plausible wrong status codes or messages. This repo only does **light structural validation** before save; adding `tsc --noEmit` on generated files in CI would catch more. For API assertions, prefer **stable fields** (`toMatchObject`, short regex) over long Go error strings that change with Go version.

**Flakes:** CI uses retries and a single worker; traces/screenshots/video on failure help. Cold Go + Next startup is the usual timeout source. **E2E:** prefer `input[name="…"]` and `getByRole` over long class chains. Avoid `getByText(/backend status/i)` for the debug button test — it matches both the **button** and the **status banner** (strict mode); target the banner copy or a narrower pattern.

## Extras in this repo

Disk cache (skipped in CI), dual `webServer` for API + UI, artifact uploads, `workflow_dispatch` for manual runs.

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

## PDF vs. your constraint

The assessment requires **not** changing the **Playwright template** config; integration lives in `scripts/playwright.config.ts` and `.github/workflows/ci.yml`. `application_code/` stays as provided.

The nine README bullets from the PDF are answered explicitly under **[Assessment README (PDF checklist 1-9)](#assessment-readme-pdf-checklist-1-9)** above; the sections that follow go deeper on implementation details.
