import { test, expect, chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.join(ROOT, "..", "dist");
let context;
let extensionId;

// These are intentionally safe smoke tests of the currently shipped extension. Thru Wallet
// currently has no dApp provider/connection bridge, so do not pretend that a page can request
// signatures. Add those security cases alongside the future dApp-connection implementation.
test.beforeAll(async () => {
  context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [
      "--headless=new",
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  extensionId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
});

test("Manifest V3 service worker starts and popup shell loads", async () => {
  expect(extensionId).toBeTruthy();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.locator("#app")).toBeVisible();
  await popup.close();
});

test("extension manifest retains strict script and object CSP", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(EXTENSION_PATH, "manifest.json"), "utf8"),
  );
  expect(manifest.manifest_version).toBe(3);
  const directives = manifest.content_security_policy.extension_pages
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  expect(directives).toContain("script-src 'self'");
  expect(directives).toContain("object-src 'none'");
});

test("wallet does not expose a page-injected provider", async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  expect(await page.evaluate(() => typeof window.thru)).toBe("undefined");
  expect(await page.evaluate(() => typeof window.ethereum)).toBe("undefined");
  await page.close();
});

test("untrusted cross-origin iframe cannot invoke a wallet provider or open an extension page", async () => {
  const legit = "https://legit-dapp.test/";
  const evil = "https://evil-iframe.test/";
  await context.route("https://legit-dapp.test/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: '<!doctype html><iframe id="evil" src="https://evil-iframe.test/"></iframe>',
    }),
  );
  await context.route("https://evil-iframe.test/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><body><p id="ready">Untrusted frame loaded</p><script>
        window.parent.postMessage({ type: 'THRU_CONNECT_REQUEST' }, '*');
        window.parent.postMessage({ type: 'THRU_SIGN_REQUEST', payload: { amount: '5000' } }, '*');
        window.postMessage({ type: 'THRU_CONNECT_REQUEST' }, '*');
      </script>`,
    }),
  );

  const openedExtensionPages = [];
  const onPage = (page) => {
    if (page.url().startsWith(`chrome-extension://${extensionId}/`)) {
      openedExtensionPages.push(page.url());
    }
  };
  context.on("page", onPage);
  const page = await context.newPage();
  try {
    await page.goto(legit);
    const iframe = page.frameLocator("#evil");
    await expect(iframe.locator("#ready")).toHaveText("Untrusted frame loaded");
    expect(
      await page
        .frame({ url: evil })
        .evaluate(() =>
          Boolean(window.thru || window.thruWallet || window.ethereum),
        ),
    ).toBe(false);
    await page.waitForTimeout(250);
    expect(openedExtensionPages).toEqual([]);
  } finally {
    context.off("page", onPage);
    await page.close();
    await context.unroute("https://legit-dapp.test/**");
    await context.unroute("https://evil-iframe.test/**");
  }
});

test.skip("vault import stores no plaintext private key in chrome.storage.local", async () => {
  // Pending stable import-flow selectors and a dedicated disposable test wallet. Never use
  // a production wallet credential. Keep this test disabled until the UI supports key import.
});

test.skip("locked wallet rejects dApp signing requests without user approval", async () => {
  // Pending the planned dApp connection/provider feature. Implement together with its
  // origin validation and approval protocol; this wallet currently has no dApp bridge.
});
