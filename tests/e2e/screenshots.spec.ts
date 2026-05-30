import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

// End-to-end screenshot walkthrough of Mobile Pearl Wallet. RPC + price
// endpoints are mocked so the run is deterministic and fully offline.
// We walk: create wallet → dashboard → receive → send (tip on/off) →
// multi-account import + switch → multi-send → settings, capturing each
// screen into /screenshots.

const SHOTS = resolve(process.cwd(), "screenshots");
mkdirSync(SHOTS, { recursive: true });

// A valid Pearl mainnet address (BIP-39 vector-1, index 0) used as a send
// destination in the demo. Public test vector — not anyone's funds.
const DEST_A = "prl1pr6yuq8u2r95wjzzgpdy8cpnncpl7l8zgy6x5q0367pnc53s2famqg7pt74";
const DEST_B = "prl1pyx3nlscz8rvsxqhcjtyqt2g5szuk9ss7m5saszu3afwwhvn9zp2sz62rhm";
// Well-known PUBLIC BIP-39 test vector. NOT a user secret — used only to
// demonstrate importing a second account in the screenshot walkthrough.
const DEMO_IMPORT_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

let txCounter = 0;

async function mockBackend(page: Page) {
  // Price proxy (same-origin).
  await page.route("**/api/prl-price", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ usd_per_prl: 0.1234, source: "vwap_median", n_active_asks: 7 }),
    }),
  );

  // Pearl sentry JSON-RPC. Returns one funded UTXO per queried address so
  // the dashboard shows a balance and send/multi-send can compose.
  await page.route("**/rpc.pearlwallet.xyz/**", async (route) => {
    const req = route.request();
    let body: any = {};
    try { body = JSON.parse(req.postData() ?? "{}"); } catch { /* noop */ }
    const { method, params, id } = body;
    if (method === "searchrawtransactions") {
      const address = params?.[0];
      const skip = params?.[2] ?? 0;
      // Only page 0 carries the funding tx; later pages are empty so the
      // walk terminates quickly.
      const result =
        skip > 0
          ? []
          : [
              {
                txid: `${(txCounter++).toString(16).padStart(64, "0")}`,
                vin: [],
                vout: [
                  {
                    n: 0,
                    value: 1000,
                    scriptPubKey: {
                      address,
                      hex: "5120" + "11".repeat(32),
                    },
                  },
                ],
              },
            ];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jsonrpc: "2.0", id, result }),
      });
    }
    if (method === "sendrawtransaction") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jsonrpc: "2.0", id, result: "f".repeat(64) }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jsonrpc: "2.0", id, result: null }),
    });
  });
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: resolve(SHOTS, name) });
}

test("full wallet walkthrough screenshots", async ({ page }) => {
  await mockBackend(page);

  // 1) Splash
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Mobile Pearl Wallet" })).toBeVisible();
  await shot(page, "01-splash.png");

  // 2) Create wallet — generate step
  await page.getByRole("link", { name: "Create a new wallet" }).click();
  await expect(page.getByRole("heading", { name: /new wallet is ready/i })).toBeVisible();
  // Wait for the worker to generate + render all 12 words before reading.
  await expect(page.locator("ol li")).toHaveCount(12);
  const words = await page.locator("ol li span:last-child").allInnerTexts();
  expect(words.filter(Boolean).length).toBe(12);
  await shot(page, "02-create-seed.png");

  // The "I've written it down" button enables after a 5s read delay.
  const wroteBtn = page.getByRole("button", { name: /written it down/i });
  await expect(wroteBtn).toBeEnabled({ timeout: 8000 });
  await wroteBtn.click();

  // 3) Verify words 3, 7, 11
  await page.locator('input').nth(0).fill(words[2]!);
  await page.locator('input').nth(1).fill(words[6]!);
  await page.locator('input').nth(2).fill(words[10]!);
  await page.getByRole("button", { name: "Continue" }).click();

  // 4) Password step
  await expect(page.getByRole("heading", { name: /unlock password/i })).toBeVisible();
  await page.locator('input[type="password"]').nth(0).fill("CorrectHorse9!Battery");
  await page.locator('input[type="password"]').nth(1).fill("CorrectHorse9!Battery");
  await page.getByRole("checkbox").check();
  await shot(page, "03-create-password.png");
  await page.getByRole("button", { name: "Create wallet" }).click();

  // 4) Dashboard. (On success the wallet unlocks and the route guard
  // bounces /onboarding/* straight to /dashboard.) Balance loads from
  // the mocked RPC after the pool walk.
  await expect(page).toHaveURL(/dashboard/, { timeout: 15000 });
  await expect(page.getByText("Total balance")).toBeVisible();
  // Wait for the pool walk to populate the balance (mocked).
  await expect(page.locator("text=/[0-9,]+(\\.[0-9]+)?/").first()).toBeVisible();
  await page.waitForTimeout(8000);
  await shot(page, "05-dashboard.png");

  // Client-side nav back to the dashboard (a full page.goto would reload
  // the app and drop the in-memory unlocked session, forcing a re-unlock).
  const toDash = async () => {
    await page.getByRole("link", { name: "Mobile Pearl Wallet" }).click();
    await expect(page).toHaveURL(/dashboard/);
  };

  // 7) Receive — locked single address
  await page.getByRole("link", { name: "Receive" }).first().click();
  await expect(page.getByTestId("receive-address")).toBeVisible();
  await expect(page.getByTestId("receive-qr")).toBeVisible();
  await shot(page, "06-receive.png");
  await toDash();

  // 8) Send PRL with tip ON
  await page.getByRole("link", { name: "Send PRL" }).click();
  await page.getByPlaceholder("prl1p...").fill(DEST_A);
  // Amount input is the 2nd .mono input on the page.
  await page.locator("input.mono").nth(1).fill("100");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByText("Confirm")).toBeVisible();
  await expect(page.getByText("Dev tip")).toBeVisible({ timeout: 20000 });
  await shot(page, "07-send-tip-on.png");

  // 9) Tip OFF — uncheck the tip checkbox
  await page.getByRole("checkbox").first().uncheck();
  await expect(page.getByText("Dev tip")).toBeHidden({ timeout: 20000 });
  await shot(page, "08-send-tip-off.png");
  await toDash();

  // 10) Accounts page (single account so far)
  await page.getByTestId("account-switcher").click();
  await expect(page.getByTestId("account-list")).toBeVisible();
  await shot(page, "09-accounts-one.png");

  // 11) Import a second account
  await page.getByTestId("import-account-open").click();
  await page.getByTestId("import-label").fill("Vector Account");
  await page.getByTestId("import-mnemonic").fill(DEMO_IMPORT_MNEMONIC);
  await shot(page, "10-accounts-import.png");
  await page.getByTestId("import-submit").click();
  await expect(page).toHaveURL(/dashboard/);

  // Back to accounts — now two accounts, demonstrate switcher
  await page.getByTestId("account-switcher").click();
  await expect(page.getByTestId("account-list").locator("li")).toHaveCount(2);
  await shot(page, "11-accounts-two.png");
  await toDash();

  // 12) Multi-send (batch)
  await page.getByRole("link", { name: "Send to many" }).click();
  await page.getByTestId("recipient-address-0").fill(DEST_A);
  await page.getByTestId("recipient-amount-0").fill("25");
  await page.getByTestId("recipient-address-1").fill(DEST_B);
  await page.getByTestId("recipient-amount-1").fill("50");
  await shot(page, "12-multisend-form.png");
  await page.getByTestId("multisend-review").click();
  await expect(page.getByText("Confirm batch")).toBeVisible({ timeout: 20000 });
  await shot(page, "13-multisend-confirm.png");
  await toDash();

  // 13) Merge — sweep all PRL to ONE destination wallet; mandatory 0.1 PRL tip
  await page.getByRole("link", { name: "Merge PRL to 1 wallet" }).click();
  await expect(page.getByTestId("merge-dest-self")).toBeVisible();
  // Sweep to a custom external wallet to show destination selection.
  await page.getByTestId("merge-dest-custom").check();
  await page.getByTestId("merge-custom-addr").fill(DEST_A);
  await shot(page, "16-merge-destination.png");
  await page.getByTestId("merge-review").click();
  await expect(page.getByText("Confirm merge")).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("Dev tip (mandatory)")).toBeVisible();
  await expect(page.getByText("Destination wallet:")).toBeVisible();
  await shot(page, "15-merge-confirm.png");
  await toDash();

  // 14) Settings — tip configuration
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByTestId("settings-tip-amount")).toBeVisible();
  await page.getByTestId("settings-tip-amount").scrollIntoViewIfNeeded();
  await shot(page, "14-settings-tip.png");
});
