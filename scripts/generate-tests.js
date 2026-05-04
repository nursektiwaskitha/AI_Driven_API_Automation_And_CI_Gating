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
${kind === "api" ? `- API tests may use test.describe.parallel at the describe level if every test is fully independent (optional).
- **toHaveProperty(key, value?)** — With two args, \`value\` is an **equality** check on \`obj[key]\`, not a custom failure string. Prefer \`toMatchObject\`, \`expect(obj.field, '…').toBe(…)\`, or \`expect(obj, '…').toHaveProperty('field')\` (single key) then assert values separately.` : ""}

LOCATOR & ACCESSIBILITY (${kind === "e2e" ? "E2E" : "N/A for API"}):
${kind === "e2e" ? `- Prefer getByRole / getByTestId when data-testid exists in the provided source; otherwise stable locators from source (e.g. input[name="…"]).
- Prefer user-facing strings and roles (accessibility-friendly) over CSS class chains and never assert rgb()/border colors.
- Never use long Tailwind class strings as locators (e.g. \`text-yellow-600\`, \`text-red-600\` chains) — use getByText / getByRole against visible copy from the source.
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
    // Button label and status banner both contain "Backend Status" → strict mode duplicate match.
    if (/getByText\(\s*\/backend status\/i\s*\)/i.test(code)) {
      throw new Error(
        "Avoid getByText(/backend status/i) — matches button + banner; use a narrower pattern (see E2E prompt)"
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

  if (kind === "api" && /main\.PaymentRequest/i.test(code)) {
    throw new Error(
      "Do not assert full Go type paths like main.PaymentRequest in error strings — json errors use PaymentRequest without main. prefix"
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

/** Implementation truth for this repo (Go handlers may differ from Swagger / OpenAPI prose). */
function apiImplementationNotes() {
  return `
BACKEND BEHAVIOR (assert what handlers return, not guessed framework strings):

- GET /api/health → 200 { status: "healthy", message: string } (message relates to server running).

- POST /api/checkout → JSON { cardNumber, expiry, cvv, amount } (\`amount\` is numeric). Success → 200 { status: "success", message }.
  Decode / type errors → 400 { error: string }; \`error\` starts **Invalid request:** then Go's json detail — **varies a lot** (truncated JSON vs wrong types vs …). Prefer \`toMatch(/^Invalid request:/)\` plus a **broad** tail (\`/json:|cannot unmarshal|invalid character|unexpected end/i\` — any one is enough) or only assert **status 400** + non-empty \`error\`. **Never** require one exact Go phrase (e.g. only \`unexpected end of JSON input\`) or the full struct path (\`main.PaymentRequest\` vs \`PaymentRequest\` differs by build).
  To send a **raw broken JSON string**, use **request.fetch** with \`Content-Type: application/json\` and \`data\` as the raw string (avoid relying on \`request.post\` to forward malformed bodies unchanged).

- POST /api/validate-card → decodable JSON → 200 { valid, message }; Luhn-valid PAN example 4242424242424242, invalid 1111111111111111. JSON decode failure → 400 { error: **"Invalid request"** } (static). Odd field names may still decode → often 200 with valid:false.
  **Real handler messages (ignore Swagger examples):** valid Luhn → \`message\` is **"Card number validated"**; invalid / empty PAN failing Luhn → **"Invalid card number (Luhn check failed)"**. Assert with \`/validated|valid/i\` or \`/Luhn|invalid card/i\` — do **not** require OpenAPI wording like "Card number is valid".

- POST /api/validate-email → Valid JSON body → **500** { error: **"Email validation service temporarily unavailable"** } (handler always returns this after decode). Malformed JSON before decode → **400** { error: **"Invalid request"** } (same static as validate-card) — **different** shape from checkout's **Invalid request:** + Go detail.

CONVENTIONS:
- Relative URLs only (/api/...). Prefer **toMatchObject** / field-level **expect** over fragile string literals.
- Group endpoints in test.describe as makes sense.
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
- Produce one file: import { test, expect } from '@playwright/test'; every test uses async ({ request }) => { ... } (no ApiHelper).
- Cover health, checkout (success + at least one 400 path), validate-card (Luhn + malformed JSON), validate-email (500 on valid body; optional 400 on bad JSON if you add that case).
- Assertions: match **BACKEND BEHAVIOR**; OpenAPI **example** strings for \`message\` / errors are often wrong — do not copy them for validate-card or checkout errors. Use tolerant matchers where Go text varies; use **exact** strings only for static bodies (e.g. validate-email 500, decode-failure **Invalid request**).
- One top-level test.describe naming the API suite; return ONLY the TypeScript source (no markdown).
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

EMAIL / API COUPLING (read page.tsx — blur calls /api/validate-email):
- That endpoint returns **500** for valid requests in this app; the UI may show a **non-blocking** warning but still allows checkout. Do **not** require "no warning" before paying unless the source shows the field is cleared on success only.
- Prefer **user-visible text** (getByText / roles) over CSS class chains for any warning copy.

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
- Using \`{ request }\` or \`request.get/post/...\` (API tests live in generated_test/api only)
- Brittle locators: long Tailwind class chains, rgb/color assertions
- test.beforeEach used only to duplicate API checks; avoid arbitrary page.waitForTimeout

OPTIONAL second test: click **Check Backend Status** (see page.tsx). After the click, status is shown in the **message** banner (e.g. \`🟢 Backend Status: … - …\` or the red offline copy). **Strict mode:** \`getByText(/backend status/i)\` matches **both** the button and the banner → Playwright fails. Use a **narrower** locator: e.g. \`getByText(/Backend Status:.*-/)\`, \`getByText(/Server is running/i)\`, or \`page.getByRole('button', { name: /check backend status/i }).locator('..').locator('..')\` then assert a sibling — **not** a bare \`/backend status/i\` on the whole page.

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

  const cacheKey = `${hashContent(swagger + "|api-prompt-v8")}`;
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

  const cacheKey = hashContent(uiSource + "|e2e-prompt-v5");
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
