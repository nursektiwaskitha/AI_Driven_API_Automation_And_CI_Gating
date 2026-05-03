# AI-Driven API Automation & CI Gating

This submission implements an LLM-powered Playwright test generator, runs generated specs from `generated_test/`, starts the Go API and Next.js checkout app, and gates CI on generation plus execution.

**Provided folders stay untouched:** `playwright_template/` and `application_code/` are the supplied zips (not edited for this flow). The generator **reads** `application_code` (Swagger, `page.tsx`) and **reads** the template’s `example-api.spec.ts` as prompt context only.

### Where Playwright config / package / ignores live

- **`playwright_template/package.json`** — the only place **`@playwright/test`** is installed (per the provided template). Run the CLI with `npm exec --prefix playwright_template -- playwright …`.
- **`scripts/playwright.config.ts`** — integration config (servers + `generated_test/` projects). It is **not** a duplicate of `playwright_template/playwright.config.ts`; the assessment forbids changing the **template** config, which still targets `./tests` only.
- **No root `package.json`** — avoids duplicating the template’s npm manifest; CI and README use explicit `npm ci --prefix …` / `npm exec --prefix playwright_template` commands.
- **Minimal root `.gitignore` only** — Git ignores in `playwright_template/.gitignore` do **not** apply to sibling paths like `generated_test/` or repo-root `playwright-report/`. A tiny root `.gitignore` is required so those paths are never committed.

### `playwright-report/` and `test-results/`

The PDF requires the CI pipeline to **“Produce test logs or artifacts”** (not to commit report folders into the repo). Locally and in CI, Playwright writes HTML + JUnit under these paths; they are **gitignored** and **uploaded as GitHub Actions artifacts** so reviewers get logs without polluting git.

## LLM prompt design

- **API tests**: Loads `application_code/docs/swagger.json`, optionally includes `playwright_template/tests/api/example-api.spec.ts` as a style reference (read-only), and injects **implementation notes** aligned with `main.go` (checkout returns 200 after successful decode; `validate-email` returns HTTP 500; validate-card uses Luhn with HTTP 200 + `valid`).
- **E2E tests**: Embeds `application_code/app/page.tsx` in the prompt so the model targets the real form (`name` attributes, button copy, success message pattern).
- **Output hygiene**: No markdown fences; `sanitizeLLMOutput` strips code fences; `validatePlaywrightCode` checks for `test`, `expect`, `@playwright/test`, `async`, and `request` vs `page`.

## How Swagger becomes Playwright tests

OpenAPI describes shapes; the prompt adds handler-accurate status/body expectations. Generated API tests call **relative paths** (`/api/health`, etc.) with `baseURL` set in `scripts/playwright.config.ts` to `http://127.0.0.1:8080`.

## Generation workflow

1. `scripts/generate-tests.js` resolves Swagger under `application_code/docs/`.
2. Gemini (`gemini-2.5-flash`) returns TypeScript for API + E2E suites.
3. Output is written only under `generated_test/api/generated.spec.ts` and `generated_test/e2e/generated.spec.ts` by **that script only** — these paths are **gitignored** and must not be committed or hand-edited (no checked-in copies).
4. Optional disk cache under `.cache/` (keys: Swagger + prompt version for API, `page.tsx` + prompt version for E2E). **If you delete a `generated.spec.ts` file, the next run skips disk cache for that suite and calls the LLM again** (so “delete file = regenerate” matches intuition). To force fresh output even when files exist, set `LLM_SKIP_CACHE=1` or remove `.cache/`. CI sets `LLM_SKIP_CACHE=1` so each pipeline run is uncached. The PDF lists intelligent caching as **bonus** signal, not a requirement to hide regeneration behind deletes.

### Regenerate locally

```bash
export LLM_API_KEY="your-gemini-key"
node scripts/generate-tests.js
```

## Running tests locally

```bash
npm ci --prefix playwright_template
npm ci --prefix application_code
npm exec --prefix playwright_template -- playwright install --with-deps chromium
export LLM_API_KEY="your-gemini-key"
node scripts/generate-tests.js
npm exec --prefix playwright_template -- playwright test -c scripts/playwright.config.ts
```

`scripts/playwright.config.ts` starts `go run main.go` (port **8080**) and `npm run dev` for Next (port **3000**) with `cwd` set to `application_code/`, then runs specs under `generated_test/`.

## How CI gates merges

`.github/workflows/ci.yml` runs `npm ci --prefix playwright_template` and `npm ci --prefix application_code`, installs Chromium via the template’s Playwright package, runs `node scripts/generate-tests.js` with `secrets.LLM_API_KEY`, then `playwright test -c scripts/playwright.config.ts`. HTML and JUnit artifacts are uploaded from the repo root output folders.

### Secrets

- **Local**: `export LLM_API_KEY=...`
- **GitHub**: Repository secret `LLM_API_KEY` (never committed).

### CI job failed?

1. **`LLM_API_KEY` missing** — The workflow fails fast with an error if the secret is empty. Fork pull requests do not receive repository secrets; run CI from a branch on the same repo or use a maintainer flow that supplies the key.
2. **`Restore cache failed … go.sum`** — Ensure `application_code/go.sum` is committed (generated with `go mod tidy` in `application_code/`). `setup-go` caches modules using that file.
3. **No `playwright-report/` or `test-results/` artifacts** — Usually means Playwright exited before reporters wrote files (e.g. generation failed, webServer timeout, or tests crashed immediately). Open the failed step log above the artifact warnings.
4. **Node / Actions deprecation notices** — Warnings only; the workflow uses Node 22. Upgrade `actions/*` versions when you next touch the file.

## Scaling to many endpoints

- Chunk Swagger by tag or path prefix; emit one file per chunk.
- Add JSON Schema / openapi-response-validator post-generation.
- Key cache entries by OpenAPI content hash; invalidate on spec diffs.

## Detecting bad / hallucinated tests

- Structural checks on generated TS; optional `tsc --noEmit` in CI.
- Contract tests against fixtures or mocks.
- Snapshot stable subsets of responses where safe.

## Flaky API / UI tests

- CI retries, traces, screenshots on failure, single worker.
- Prefer stable locators (`input[name=…]` when labels lack `htmlFor`).

## E2E selector stability

- Prompt documents that visible labels may not be wired with `htmlFor` and recommends stable `input[name="..."]` locators from `page.tsx`.
- Submit button matched with `/complete payment|pay/i`.
- Assert on visible success copy (`Payment processed`).

## Bonus features included

- LLM output caching (disabled in CI).
- Lightweight structural guardrails on generated code.
- Dual `webServer` blocks for API + UI.
- CI artifact uploads.

## Repository layout

```
.
├── README.md
├── .gitignore                # minimal — only paths outside playwright_template/ (see above)
├── scripts/
│   ├── generate-tests.js
│   └── playwright.config.ts  # integration runner config (template config unchanged)
├── generated_test/
│   ├── api/                    # generated.spec.ts produced by scripts/generate-tests.js (ignored by git)
│   └── e2e/
├── application_code/       # provided app — do not modify for submission
└── playwright_template/    # provided template — do not modify for submission
```

## PDF vs. your constraint

The written assessment says **not to modify the Playwright configuration template** (and you are also treating **`application_code/`** as read-only). This layout satisfies that: the stock `playwright_template/playwright.config.ts` and `application_code/next.config.js` stay as supplied; integration is in **`scripts/`** (generator + `scripts/playwright.config.ts`) plus **`.github/workflows/`**, with a **minimal root `.gitignore`** only where Git requires it.
