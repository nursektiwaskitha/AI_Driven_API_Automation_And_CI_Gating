const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const API_KEY = process.env.LLM_API_KEY;
const MAX_RETRIES = 3;
const LLM_TIMEOUT_MS = 60000;

function repoRoot() {
  return path.resolve(__dirname, "..");
}

function findSwaggerFile(root) {
  const possiblePaths = [
    "application_code/swagger.json",
    "application_code/openapi.json",
    "application_code/openapi.yaml",
    "application_code/swagger.yaml",
    "application_code/docs/swagger.json",
    "application_code/docs/swagger.yaml",
  ];

  for (const p of possiblePaths) {
    const abs = path.join(root, p);
    if (fs.existsSync(abs)) {
      console.log("Found Swagger file:", p);
      return abs;
    }
  }

  throw new Error("Swagger/OpenAPI file not found under application_code/");
}

function hashContent(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Project test-style conventions (aligned with team Playwright guidelines; scoped to single-file LLM output).
 */
function generationStyleGuidelines(kind) {
  const shared = `
STYLE & STRUCTURE (TypeScript / Playwright):
- Concise, technical code; async/await everywhere; declarative tests (no classes — no \`class\`, no OOP Page Objects).
- Prefer small local helper functions at the bottom of the same file if it removes duplication (still only \`@playwright/test\` import). If you need a tiny response shape, prefer \`interface\` over \`type\`; avoid \`enum\` (use const objects if needed — rare).
- Descriptive identifiers: e.g. healthResponse, checkoutPayload, isSuccessBannerVisible (auxiliary verbs where they add clarity).
- Structure: test.describe → optional beforeEach/beforeAll only when shared setup is real → independent test() cases.
- Name tests: "should <expected> when <condition>" (or close: "should return 400 when JSON is malformed").
- Use Arrange / Act / Assert: separate phases with a blank line when a test body is non-trivial.
- Critical expects: use the message overload where it helps triage, e.g. expect(response.status(), 'checkout status').toBe(200).
- Rely on Playwright auto-waiting; avoid page.waitForTimeout except as a last resort (prefer expect(locator).toBeVisible({ timeout })).

PLAYWRIGHT PATTERNS:
- Use official fixture patterns (${kind === "api" ? "`{ request }` only" : "`{ page }` only"}).
- Keep tests atomic: no shared mutable state between tests; no order dependency.
${kind === "api" ? "- API tests may use test.describe.parallel at the describe level if every test is fully independent (optional)." : ""}

LOCATOR & ACCESSIBILITY (${kind === "e2e" ? "E2E" : "N/A for API"}):
${kind === "e2e" ? `- Prefer getByRole / getByTestId when data-testid exists in the provided source; otherwise stable locators from source (e.g. input[name="…"]).
- Prefer user-facing strings and roles (accessibility-friendly) over CSS class chains and never assert rgb()/border colors.
- Keyboard: optional tab/Enter only if it matches real UX; do not over-engineer screen-reader simulation.` : "- (API tests: no DOM locators.)"}

OUT OF SCOPE — DO NOT OUTPUT (missing deps or multi-file layout):
- Extra files, separate Page Object (\`*PagePO.ts\`) modules, or imports from packages other than \`@playwright/test\`.
- playwright-axe, @axe-core/playwright, visual regression baselines, toHaveScreenshot baselines, performance/memory APIs, security scanners, or multi-browser matrices.
- console.log / test.only / test.skip / page.pause().
`;

  return shared;
}

function wrapPrompt(content, kind) {
  return `
You are a senior QA automation engineer writing Playwright TypeScript tests.

OUTPUT CONTRACT (violations will be rejected):
- Emit a single compilable TypeScript module: ONLY import from '@playwright/test' (no other imports).
- No prose, no markdown, no backticks, no "Here is the code" preamble or postscript.
- Do not use test.only, test.skip, or page.pause().
- Do not add console.log except for unavoidable debugging (prefer none).

${generationStyleGuidelines(kind)}

${content}
`;
}

async function callLLM(prompt) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${API_KEY}`,
        {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.25,
              topP: 0.9,
              maxOutputTokens: 8192,
            },
          }),
        }
      );

      clearTimeout(timeout);

      const data = await res.json();

      if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
        console.error("Gemini response:", JSON.stringify(data, null, 2));
        throw new Error("Invalid Gemini response");
      }

      return data.candidates[0].content.parts[0].text;
    } catch (err) {
      console.warn(`LLM attempt ${attempt} failed:`, err.message || err);
      if (attempt === MAX_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

function validatePlaywrightCode(code, kind) {
  const checks = [
    code.includes("test("),
    code.includes("expect("),
    code.includes("@playwright/test"),
    code.includes("async"),
  ];

  if (checks.some((c) => !c)) {
    throw new Error(`Generated ${kind} code failed structural validation`);
  }

  if (kind === "api" && !code.includes("request")) {
    throw new Error("API tests must use the request fixture");
  }

  if (kind === "e2e" && !code.includes("page")) {
    throw new Error("E2E tests must use the page fixture");
  }

  if (kind === "e2e") {
    if (/\brequest\.(get|post|put|patch|delete|fetch|head)\s*\(/i.test(code)) {
      throw new Error(
        "E2E output must not call request.* — API tests belong only in generated_test/api/generated.spec.ts"
      );
    }
    if (/async\s*\(\s*\{\s*request/.test(code)) {
      throw new Error(
        "E2E output must not use the { request } fixture — use { page } only in every test"
      );
    }
  }

  if (/\btest\.(only|skip)\s*\(/.test(code)) {
    throw new Error("Generated code must not use test.only or test.skip");
  }

  if (/\bclass\s+[A-Za-z_]/.test(code)) {
    throw new Error("Generated code must not use classes — keep functional test style");
  }

  if (/from\s+['"]@axe-core|from\s+['"]@playwright\/test\/experimental|playwright-axe/i.test(code)) {
    throw new Error("Generated code must not import axe or experimental add-ons");
  }

  if (
    kind === "api" &&
    /\.(get|post|put|patch|delete|fetch|head)\(\s*['"]https?:\/\//i.test(code)
  ) {
    throw new Error(
      "API tests must use relative URLs for request.* calls; baseURL is configured"
    );
  }
}

function getCachePath(cacheDir, key) {
  return path.join(cacheDir, `${key}.txt`);
}

function readCache(cacheDir, key) {
  const file = getCachePath(cacheDir, key);
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf-8");
  return null;
}

function writeCache(cacheDir, key, content) {
  ensureDir(cacheDir);
  fs.writeFileSync(getCachePath(cacheDir, key), content);
}

function safeWrite(filePath, content) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, content);
  fs.renameSync(tempPath, filePath);
}

/** Implementation truth for this repo (Go handlers may differ from Swagger error codes). */
function apiImplementationNotes() {
  return `
BACKEND BEHAVIOR (trust these over optimistic Swagger prose; assert what the server actually does):

- GET /api/health → 200 JSON { status: "healthy", message: string } (message mentions server/running).

- POST /api/checkout → Body JSON { cardNumber, expiry, cvv, amount } (amount is a number).
  Decode error / invalid JSON → 400 { error: string }.
  Successful decode → always 200 { status: "success", message } (mock: no CVV/card field validation).
  Malformed JSON: use request.fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, data: '{not-json' }) so the body is not auto-repaired.

- POST /api/validate-card → 200 { valid: boolean, message: string } for decodable JSON.
  Valid Luhn example: 4242424242424242. Invalid Luhn example: 1111111111111111.
  Invalid JSON → 400 { error }. Wrong property names → often still 200 with valid:false for empty/short PAN.

- POST /api/validate-email → Always HTTP 500 { error: string } in this codebase (service unavailable). Never expect 2xx.

CONVENTIONS:
- Use ONLY relative paths (/api/...). Never hardcode http://localhost or http://127.0.0.1 in request URLs.
- Prefer expect(body).toMatchObject(partial) or field-level expects + toMatch(/.../i) for messages to reduce brittleness.
- Group related cases in test.describe('Payment API', () => { ... }).
`;
}

/** Short list of paths from OpenAPI JSON to focus the model (full spec still attached below). */
function swaggerPathSummary(swaggerText) {
  try {
    const spec = JSON.parse(swaggerText);
    const paths = spec.paths && typeof spec.paths === "object" ? Object.keys(spec.paths) : [];
    return paths.length ? paths.sort().join(", ") : "(no paths key parsed)";
  } catch {
    return "(could not parse OpenAPI JSON for path list)";
  }
}

function buildApiPrompt(swagger, exampleSpec) {
  const pathList = swaggerPathSummary(swagger);
  return `
${apiImplementationNotes()}

OpenAPI path keys (generate tests primarily for these): ${pathList}

Below: example file from this repo's Playwright template — use only as STYLE reference (import pattern, request usage).
Do NOT copy fictional endpoints from the example; bind every test to the real paths above and the BACKEND BEHAVIOR block.

--- example-api.spec.ts (reference style only) ---
${exampleSpec}
--- end example ---

Full OpenAPI document (JSON):

${swagger}

TASK:
- Produce one file: import { test, expect } from '@playwright/test';
- Every test uses async ({ request }) => { ... } and the built-in request fixture (no ApiHelper).
- Minimum coverage: health GET; checkout happy path; checkout malformed JSON → 400; validate-card valid + invalid Luhn; validate-email → 500.
- Use JSON assertions that tolerate minor message wording: toMatch, toContain, toHaveProperty, toMatchObject.
- One top-level test.describe naming the API suite.
- Return ONLY the TypeScript source (no markdown).
`;
}

function buildE2EPrompt(uiSource) {
  return `
You are generating EXACTLY ONE Playwright spec file for BROWSER E2E ONLY: generated_test/e2e/generated.spec.ts

CRITICAL SCOPE (violations will fail validation):
- Use ONLY the { page } fixture. Every test must be async ({ page }) => { ... }.
- NEVER use { request } or request.get/post/fetch — API tests are a SEPARATE file (generated_test/api). Do not paste or duplicate API tests here.
- ONE primary goal: complete the payment checkout form and assert success on the page. Prefer ONE test() inside ONE test.describe('Checkout UI', ...).

RUNTIME CONTEXT (one line): CI starts the Go API on :8080 and Next on :3000; the browser page calls the API as the real app does.

PAGE COPY YOU MUST MATCH (from this codebase):
- Main heading text includes: "Secure Checkout"
- Optional debug button (do NOT build the main flow around it unless you add a second tiny test): label contains "Check Backend Status" and may include a leading emoji; match with /check backend status/i
- Submit control: role button; use getByRole('button', { name: /complete payment|pay/i }) so both "Complete Payment" and "Pay $…" match
- Success: visible copy matches /payment processed successfully/i after successful POST (see message state in source)

FULL SOURCE — every selector must exist here:

${uiSource}

MANDATORY HAPPY-PATH STEPS (single test preferred):
1. await page.goto('/')
2. Fill in order: input[name="email"], input[name="cardNumber"], input[name="expiry"], input[name="cvv"], input[name="amount"]
   (Labels lack htmlFor — do NOT rely on getByLabel for those fields.)
3. Values: email valid; card 4242424242424242; expiry 12/30; cvv 123; amount "15"
4. Click submit: page.getByRole('button', { name: /complete payment|pay/i }).click()
5. await expect(page.getByText(/payment processed successfully/i)).toBeVisible({ timeout: 30000 })

FORBIDDEN IN THIS FILE:
- Any APIRequestContext / request fixture usage
- Describing or testing /api/health, /api/checkout, validate-card, validate-email with request.* (wrong file)
- Assertions on Tailwind/CSS class strings, rgb()/border colors, or long chained class selectors (brittle)
- Spinner visibility races (do not assert svg.animate-spin sequences)
- test.beforeEach that only exists to run API checks
- Hardcoded page.waitForTimeout except as last resort (prefer Playwright auto-wait + expect timeouts)

ALLOWED EXTRAS (optional, second test only if short): click "Check Backend status" style button and assert some healthy text — still { page } only.

Return ONLY TypeScript source (no markdown).
`;
}

function sanitizeLLMOutput(code) {
  return code
    .replace(/^```(?:typescript|ts)?\s*/im, "")
    .replace(/```\s*$/m, "")
    .replace(/```typescript/gi, "")
    .replace(/```/g, "")
    .trim();
}

async function generateWithCache({
  prompt,
  cacheDir,
  cacheKey,
  kind,
  useCache,
}) {
  if (useCache) {
    const cached = readCache(cacheDir, cacheKey);
    if (cached) {
      console.log("Using cached LLM output for key:", cacheKey.slice(0, 16), "…");
      return sanitizeLLMOutput(cached);
    }
  }

  let output = await callLLM(prompt);
  output = sanitizeLLMOutput(output);
  validatePlaywrightCode(output, kind);
  if (useCache) writeCache(cacheDir, cacheKey, output);
  return output;
}

async function generateApiTests(root, cacheDir, useCache) {
  console.log("Generating API tests…");

  const swaggerPath = findSwaggerFile(root);
  const swagger = fs.readFileSync(swaggerPath, "utf-8");
  const examplePath = path.join(
    root,
    "playwright_template/tests/api/example-api.spec.ts"
  );
  const example = fs.existsSync(examplePath)
    ? fs.readFileSync(examplePath, "utf-8")
    : "";

  const outGenerated = path.join(root, "generated_test/api/generated.spec.ts");
  // Disk cache is independent of the spec file: deleting generated.spec.ts should still refetch from the LLM.
  const effectiveUseCache = useCache && fs.existsSync(outGenerated);
  if (useCache && !effectiveUseCache) {
    console.log(
      "API: output file missing — skipping disk cache and calling LLM for this suite."
    );
  }

  const cacheKey = `${hashContent(swagger + "|api-prompt-v2")}`;
  const prompt = wrapPrompt(buildApiPrompt(swagger, example), "api");
  const code = await generateWithCache({
    prompt,
    cacheDir,
    cacheKey,
    kind: "api",
    useCache: effectiveUseCache,
  });

  safeWrite(outGenerated, code);
  console.log("API tests written to generated_test/api");
}

async function generateE2ETests(root, cacheDir, useCache) {
  console.log("Generating E2E tests…");

  const uiPath = path.join(root, "application_code/app/page.tsx");
  if (!fs.existsSync(uiPath)) {
    throw new Error(`Checkout UI not found at ${uiPath}`);
  }
  const uiSource = fs.readFileSync(uiPath, "utf-8");

  const outGenerated = path.join(root, "generated_test/e2e/generated.spec.ts");
  const effectiveUseCache = useCache && fs.existsSync(outGenerated);
  if (useCache && !effectiveUseCache) {
    console.log(
      "E2E: output file missing — skipping disk cache and calling LLM for this suite."
    );
  }

  const cacheKey = hashContent(uiSource + "|e2e-prompt-v2");
  const prompt = wrapPrompt(buildE2EPrompt(uiSource), "e2e");
  const code = await generateWithCache({
    prompt,
    cacheDir,
    cacheKey,
    kind: "e2e",
    useCache: effectiveUseCache,
  });

  safeWrite(outGenerated, code);
  console.log("E2E tests written to generated_test/e2e");
}

async function main() {
  const root = repoRoot();
  const cacheDir = path.join(root, ".cache");
  const useCache = process.env.LLM_SKIP_CACHE !== "1";

  if (!API_KEY) {
    throw new Error("Missing LLM_API_KEY (Gemini API key via env)");
  }

  ensureDir(path.join(root, "generated_test/api"));
  ensureDir(path.join(root, "generated_test/e2e"));

  await generateApiTests(root, cacheDir, useCache);
  await generateE2ETests(root, cacheDir, useCache);

  console.log("Generation finished.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
