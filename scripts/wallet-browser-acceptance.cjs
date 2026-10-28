// UI verification in a separate headless test browser; no wallet is injected or signed.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const requireDashboard = createRequire(path.resolve(__dirname, "../dashboard/package.json"));
const { chromium } = requireDashboard("@playwright/test");
const AxeBuilder = requireDashboard("@axe-core/playwright").default;
const output = path.resolve(__dirname, "../artifacts/wallet-20261028");
fs.mkdirSync(output, { recursive: true });
const env = fs.readFileSync(path.resolve(__dirname, "../.env"), "utf8");
const match = env.match(/^DEMO_USER_PASSWORD\s*=\s*(.*?)\s*$/m);
const password = process.env.BROWSER_DEMO_PASSWORD || process.env.DEMO_USER_PASSWORD || match?.[1]?.replace(/^(['"])(.*)\1$/, "$2");
if (!password) throw new Error("Configure DEMO_USER_PASSWORD before browser validation.");

async function main() {
  const executablePath = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    const page = await context.newPage(); const errors = []; page.on("pageerror", e => errors.push(e.message));
    await page.goto("http://localhost:5173/login");
    await page.getByLabel("Username", { exact: true }).fill("demo.administrator");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL("**/overview");
    await page.getByRole("link", { name: "Wallet & freight", exact: true }).click();
    await page.getByRole("heading", { name: "Sepolia wallet", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Deploy with MetaMask" }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Initiate freight & mint receipt" }).isDisabled(), true);
    const checks = [];
    for (const width of [1280, 768, 375]) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
      assert.ok(overflow.document <= overflow.viewport + 1, `Wallet workspace overflows at ${width}px`);
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      const violations = result.violations.filter(v => ["serious", "critical"].includes(v.impact));
      assert.deepEqual(violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })), []);
      await page.screenshot({ path: path.join(output, `wallet-${width}.png`), fullPage: true });
      checks.push({ width, overflow: false, seriousAccessibilityViolations: 0 });
    }
    await page.getByRole("button", { name: "Connect MetaMask", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "MetaMask extension installed" }).waitFor();
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify({ checkedAt: new Date().toISOString(), checks, missingExtensionHandled: true, liveWalletApprovalTested: false }, null, 2));
    console.log(JSON.stringify({ checks, missingExtensionHandled: true, runtimeErrors: errors.length, output }));
    await context.close();
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
