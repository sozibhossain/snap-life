import { test, expect, type Locator, type Page } from "@playwright/test";
import { DATE_RANGE_SEPARATOR } from "../src/lib/auditFilterSummary";

/**
 * End-to-end tests for the Admin Audit Log page filter summary chips.
 *
 * These tests verify that:
 * 1. Filter chips render in the Events card "Filtered by:" section when URL params are present
 * 2. Clicking a chip removes only that filter and stays on /admin/audit
 * 3. Multiple chips can be active simultaneously; removing one leaves the rest
 *
 * The test server is started by the Playwright webServer config with
 * VITE_TEST_BYPASS_AUTH=true, which is a compile-time env var baked in by
 * Vite — it cannot be changed at runtime by users in DevTools and is never
 * set in the regular dev or production servers.
 *
 * The /api/admin/me and /api/admin/audit API calls are intercepted by
 * page.route() to return stub data, so these tests run without a real
 * backend session or database.
 *
 * The chips under test live in the Events card's "Filtered by:" row
 * (data-testid="event-filter-summary"). A separate, visually similar chip row
 * exists in the Filters card above — scoping to event-filter-summary ensures
 * the tests target the correct elements.
 */

const AUDIT_PATH = "/admin/audit";

function filterSummary(page: Page): Locator {
  return page.getByTestId("event-filter-summary");
}

function chip(page: Page, name: RegExp): Locator {
  return filterSummary(page).getByRole("button", { name });
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/admin/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ isAdmin: true }),
    }),
  );

  await page.route("**/api/admin/audit**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], total: 0 }),
    }),
  );
});

// ── Visibility ──────────────────────────────────────────────────────────────

test("no filter summary section when no filters are active", async ({ page }) => {
  await page.goto(AUDIT_PATH);

  await expect(page.getByRole("heading", { name: "Audit Log" })).toBeVisible();
  await expect(page.getByTestId("event-filter-summary")).not.toBeVisible();
});

test("action chip appears with correct label", async ({ page }) => {
  await page.goto(`${AUDIT_PATH}?action=account_deleted`);

  await expect(filterSummary(page)).toBeVisible();
  const c = chip(page, /clear action filter/i);
  await expect(c).toBeVisible();
  await expect(c).toContainText("Action:");
  await expect(c).toContainText("Account deleted");
});

test("actor chip appears with correct label", async ({ page }) => {
  await page.goto(`${AUDIT_PATH}?actorAppUserId=user_abc123`);

  const c = chip(page, /clear actor filter/i);
  await expect(c).toBeVisible();
  await expect(c).toContainText("Actor:");
  await expect(c).toContainText("user_abc123");
});

test("target chip appears with correct label", async ({ page }) => {
  await page.goto(`${AUDIT_PATH}?targetAppUserId=user_xyz789`);

  const c = chip(page, /clear target filter/i);
  await expect(c).toBeVisible();
  await expect(c).toContainText("Target:");
  await expect(c).toContainText("user_xyz789");
});

test("date chip appears with correct label", async ({ page }) => {
  await page.goto(`${AUDIT_PATH}?from=2025-01-01&to=2025-12-31`);

  const c = chip(page, /clear date filter/i);
  await expect(c).toBeVisible();
  await expect(c).toContainText("Date:");
  await expect(c).toContainText("2025-01-01");
  await expect(c).toContainText("2025-12-31");
});

// ── Date chip full-text regression guard ─────────────────────────────────────
//
// These checks assert the exact rendered string "Date: <from> → <to>" rather
// than the individual date substrings.  A localisation change, timezone shift,
// or accidental removal of the arrow separator would break the label without
// failing the looser toContainText("2025-01-01") assertions above — so we need
// a dedicated assertion on the full composite string.
//
// The separator character (→, U+2192) is defined as DATE_RANGE_SEPARATOR in
// artifacts/admin/src/lib/auditFilterSummary.ts — update both if the glyph ever changes.
//
// The URL `/admin/audit?from=2025-01-01&to=2025-01-31` (January range) is the
// canonical fixture prescribed by the task spec so any future reader can find
// the test easily.

test("date chip renders full 'Date: from → to' text for January range", async ({ page }) => {
  await page.goto(`${AUDIT_PATH}?from=2025-01-01&to=2025-01-31`);

  const c = chip(page, /clear date filter/i);
  await expect(c).toBeVisible();
  // Assert the exact full label string (toHaveText normalises whitespace and
  // compares the entire text content) so that a missing or wrong arrow separator
  // character, a stray prefix, or extra whitespace all fail the assertion.
  // The X icon is an aria-hidden SVG with no text content, so the normalised
  // text of the button is exactly this string.
  await expect(c).toHaveText(`Date: 2025-01-01 ${DATE_RANGE_SEPARATOR} 2025-01-31`);
});

test("clicking date chip for January range clears from/to and stays on /admin/audit", async ({
  page,
}) => {
  await page.goto(`${AUDIT_PATH}?from=2025-01-01&to=2025-01-31`);

  await expect(chip(page, /clear date filter/i)).toBeVisible();
  await chip(page, /clear date filter/i).click();

  // Both date params must be removed; no redirect to dashboard.
  await expect(page).toHaveURL(/\/admin\/audit/);
  await expect(page).not.toHaveURL(/from=/);
  await expect(page).not.toHaveURL(/to=/);
  await expect(filterSummary(page)).not.toBeVisible();
});

// ── Clicking a chip clears only that filter ──────────────────────────────────

test("clicking action chip removes it and stays on /admin/audit", async ({ page }) => {
  await page.goto(`${AUDIT_PATH}?action=account_deleted`);

  await chip(page, /clear action filter/i).click();

  await expect(filterSummary(page)).not.toBeVisible();
  await expect(page).toHaveURL(/\/admin\/audit/);
  await expect(page).not.toHaveURL(/action=/);
});

test("clicking actor chip removes it and stays on /admin/audit", async ({ page }) => {
  await page.goto(`${AUDIT_PATH}?actorAppUserId=user_abc123`);

  await chip(page, /clear actor filter/i).click();

  await expect(filterSummary(page)).not.toBeVisible();
  await expect(page).toHaveURL(/\/admin\/audit/);
  await expect(page).not.toHaveURL(/actorAppUserId=/);
});

test("clicking target chip removes it and stays on /admin/audit", async ({ page }) => {
  await page.goto(`${AUDIT_PATH}?targetAppUserId=user_xyz789`);

  await chip(page, /clear target filter/i).click();

  await expect(filterSummary(page)).not.toBeVisible();
  await expect(page).toHaveURL(/\/admin\/audit/);
  await expect(page).not.toHaveURL(/targetAppUserId=/);
});

test("clicking date chip removes it and stays on /admin/audit", async ({ page }) => {
  await page.goto(`${AUDIT_PATH}?from=2025-01-01&to=2025-12-31`);

  await chip(page, /clear date filter/i).click();

  await expect(filterSummary(page)).not.toBeVisible();
  await expect(page).toHaveURL(/\/admin\/audit/);
  await expect(page).not.toHaveURL(/from=/);
  await expect(page).not.toHaveURL(/to=/);
});

// ── Other filters are preserved when one chip is cleared ─────────────────────

test("clearing action chip preserves actor, target and date filters", async ({ page }) => {
  await page.goto(
    `${AUDIT_PATH}?action=account_deleted&actorAppUserId=actor1&targetAppUserId=target1&from=2025-01-01&to=2025-12-31`,
  );

  await chip(page, /clear action filter/i).click();

  await expect(chip(page, /clear action filter/i)).not.toBeVisible();
  await expect(chip(page, /clear actor filter/i)).toBeVisible();
  await expect(chip(page, /clear target filter/i)).toBeVisible();
  await expect(chip(page, /clear date filter/i)).toBeVisible();

  await expect(page).not.toHaveURL(/action=/);
  await expect(page).toHaveURL(/actorAppUserId=actor1/);
  await expect(page).toHaveURL(/targetAppUserId=target1/);
  await expect(page).toHaveURL(/from=2025-01-01/);
  await expect(page).toHaveURL(/to=2025-12-31/);
});

test("clearing actor chip preserves action, target and date filters", async ({ page }) => {
  await page.goto(
    `${AUDIT_PATH}?action=tester_data_reset&actorAppUserId=actor1&targetAppUserId=target1&from=2025-03-01&to=2025-03-31`,
  );

  await chip(page, /clear actor filter/i).click();

  await expect(chip(page, /clear actor filter/i)).not.toBeVisible();
  await expect(chip(page, /clear action filter/i)).toBeVisible();
  await expect(chip(page, /clear target filter/i)).toBeVisible();
  await expect(chip(page, /clear date filter/i)).toBeVisible();

  await expect(page).not.toHaveURL(/actorAppUserId=/);
  await expect(page).toHaveURL(/action=tester_data_reset/);
  await expect(page).toHaveURL(/targetAppUserId=target1/);
  await expect(page).toHaveURL(/from=2025-03-01/);
  await expect(page).toHaveURL(/to=2025-03-31/);
});

test("clearing target chip preserves action, actor and date filters", async ({ page }) => {
  await page.goto(
    `${AUDIT_PATH}?action=account_deleted&actorAppUserId=actor1&targetAppUserId=target1&from=2025-06-01&to=2025-06-30`,
  );

  await chip(page, /clear target filter/i).click();

  await expect(chip(page, /clear target filter/i)).not.toBeVisible();
  await expect(chip(page, /clear action filter/i)).toBeVisible();
  await expect(chip(page, /clear actor filter/i)).toBeVisible();
  await expect(chip(page, /clear date filter/i)).toBeVisible();

  await expect(page).not.toHaveURL(/targetAppUserId=/);
  await expect(page).toHaveURL(/action=account_deleted/);
  await expect(page).toHaveURL(/actorAppUserId=actor1/);
  await expect(page).toHaveURL(/from=2025-06-01/);
  await expect(page).toHaveURL(/to=2025-06-30/);
});

test("clearing date chip preserves action, actor and target filters", async ({ page }) => {
  await page.goto(
    `${AUDIT_PATH}?action=account_deleted&actorAppUserId=actor1&targetAppUserId=target1&from=2025-01-01&to=2025-12-31`,
  );

  await chip(page, /clear date filter/i).click();

  await expect(chip(page, /clear date filter/i)).not.toBeVisible();
  await expect(chip(page, /clear action filter/i)).toBeVisible();
  await expect(chip(page, /clear actor filter/i)).toBeVisible();
  await expect(chip(page, /clear target filter/i)).toBeVisible();

  await expect(page).not.toHaveURL(/from=/);
  await expect(page).not.toHaveURL(/to=/);
  await expect(page).toHaveURL(/action=account_deleted/);
  await expect(page).toHaveURL(/actorAppUserId=actor1/);
  await expect(page).toHaveURL(/targetAppUserId=target1/);
});

// ── UI-driven: applying filters via controls shows chips ─────────────────────

test("selecting action type via dropdown shows the action chip", async ({ page }) => {
  await page.goto(AUDIT_PATH);

  await expect(page.getByTestId("event-filter-summary")).not.toBeVisible();

  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: "Account deleted" }).click();

  const c = chip(page, /clear action filter/i);
  await expect(c).toBeVisible();
  await expect(c).toContainText("Account deleted");
  await expect(page).toHaveURL(/action=account_deleted/);
});

test("typing an actor ID in the input shows the actor chip", async ({ page }) => {
  await page.goto(AUDIT_PATH);

  await page.getByLabel("Actor user ID").fill("user_e2e_actor");
  await page.keyboard.press("Tab");

  const c = chip(page, /clear actor filter/i);
  await expect(c).toBeVisible();
  await expect(c).toContainText("user_e2e_actor");
  await expect(page).toHaveURL(/actorAppUserId=user_e2e_actor/);
});

// ── Navigation regression ────────────────────────────────────────────────────

test("chip click stays on /admin/audit — not redirected to dashboard", async ({ page }) => {
  await page.goto(`${AUDIT_PATH}?action=account_deleted&actorAppUserId=test_user`);

  expect(page.url()).toContain("/admin/audit");

  await chip(page, /clear action filter/i).click();

  const urlAfter = page.url();
  expect(urlAfter).toContain("/admin/audit");
  expect(urlAfter).not.toMatch(/\/admin\/?$/);
});
