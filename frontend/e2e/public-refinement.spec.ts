import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

test.skip(process.env.FORGEWORKS_PUBLIC_SMOKE !== "1", "Requires the generated public artifact");

const workspaces = [
  ["overview", "Overview", "Manufacturing Overview"],
  ["scheduler", "Production Scheduler"],
  ["predictions", "AI Prediction Studio"],
  ["digital-twin", "Digital Twin"],
  ["copilot", "Planning Copilot"],
  ["scenario-lab", "Scenario Lab"],
  ["approvals", "Schedule Approvals"],
  ["system", "System Information"],
];

async function go(page: Page, [, label, heading = label]: string[]) {
  await page.getByRole("navigation").getByRole("link", { name: label, exact: true }).click();
  await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
}

async function screenshot(page: Page, name: string) {
  const directory = process.env.FORGEWORKS_SCREENSHOTS;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${name}.png`, animations: "disabled" });
}

test("the public artifact preserves evidence and presents structured results", async ({ page }) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (/\/(demo|api)\//.test(new URL(request.url()).pathname) && request.method() !== "GET")
      requests.push(request.method());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByText("40 scheduled · 40 open")).toBeVisible();
  await expect(page.getByText(/96\.4% estimated on-time delivery · 300 replications/)).toBeVisible();
  await screenshot(page, "overview");

  await page.getByRole("link", { name: "View orders with ≥10% modeled risk" }).click();
  const level = page.getByLabel("Risk level");
  await expect(level).toHaveValue("Delivery watch");
  await expect(page.getByRole("status")).toHaveText("1–2 of 2 orders");
  await level.selectOption("");
  await expect(page.getByRole("status")).toHaveText("1–10 of 40 orders");
  await expect(page.getByRole("columnheader", { name: /Estimated late/ })).toHaveAttribute("aria-sort", "descending");
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByRole("status")).toHaveText("11–20 of 40 orders");
  await page.getByRole("button", { name: "Order", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "Order", exact: true })).toHaveAttribute("aria-sort", "ascending");
  await page.getByRole("searchbox", { name: "Search order ID" }).fill("ORD-130");
  await expect(page.getByRole("status")).toHaveText("1–1 of 1 orders");
  await expect(page.getByRole("rowheader", { name: "ORD-130" })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search order ID" }).clear();
  await page.getByRole("button", { name: "Estimated late", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await screenshot(page, "digital-twin");

  await go(page, workspaces[1]);
  const solver = page.getByText(/The solver found a feasible schedule/);
  await expect(solver).toBeVisible();
  await solver.click();
  await expect(page.getByText(/A weak bound/)).toBeVisible();
  await solver.click();
  await screenshot(page, "scheduler");
  const operation = page.getByRole("button", { name: /ORD-\d+ stage/ }).first();
  await operation.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toContainText("Production time");
  await screenshot(page, "operation-detail");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await go(page, workspaces[2]);
  await expect(page.getByRole("columnheader", { name: "Prediction interval" })).toBeVisible();
  await screenshot(page, "predictions");

  await go(page, workspaces[4]);
  await page.getByRole("button", { name: "Compare schedule versions" }).click();
  await expect(page.getByRole("heading", { name: "Schedule Comparison" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Previous start" })).toBeVisible();
  await expect(page.getByText("Protected operations", { exact: true }).locator("..")).toContainText("1");
  await expect(page.locator(".evidence pre")).toBeHidden();
  await screenshot(page, "copilot");
  await page.getByText("Technical evidence", { exact: true }).click();
  await expect(page.locator(".evidence pre")).toBeVisible();
  await expect(page.locator(".evidence pre")).toContainText('"reassignments"');

  await go(page, workspaces[5]);
  await expect(page.getByRole("heading", { name: "Decision summary" })).toBeVisible();
  await expect(page.getByText(/estimated on-time delivery decreased by 1\.6 percentage points/)).toBeVisible();
  for (const label of ["Improved", "Regressed", "Unchanged"]) await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Run scenario" })).toHaveCount(0);
  await screenshot(page, "scenario-lab");

  await go(page, workspaces[6]);
  await expect(page.getByRole("heading", { name: "Decision history" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^(Approve|Release|Reject)$/ })).toHaveCount(0);
  await screenshot(page, "approvals");

  await go(page, workspaces[7]);
  await expect(page.getByText("Immutable synthetic evidence", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Simulation configuration" })).toBeVisible();
  await screenshot(page, "system");
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test("the full walkthrough is keyboard accessible and layouts fit four viewport sizes", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  const start = page.getByRole("button", { name: "Interview walkthrough" });
  await start.focus();
  await page.keyboard.press("Enter");
  const tour = page.getByRole("region", { name: "Guided walkthrough" });
  for (const [index, workspace] of workspaces.slice(0, 7).entries()) {
    await expect(tour).toContainText(`Step ${index + 1} of 7`);
    await expect(page.getByRole("heading", { name: workspace[2] ?? workspace[1], exact: true })).toBeVisible();
    await expect(page.locator(".tour-active .tour-target")).toBeVisible();
    if (index === 1) {
      await tour.getByRole("button", { name: "Previous" }).click();
      await expect(tour).toContainText("Step 1 of 7");
      await tour.getByRole("button", { name: "Next" }).click();
      await expect(tour).toContainText("Step 2 of 7");
      await screenshot(page, "walkthrough");
    }
    await tour.getByRole("button", { name: index === 6 ? "Finish" : "Next", exact: true }).click();
  }
  await expect(tour).toHaveCount(0);
  await expect(start).toBeFocused();

  for (const [width, height] of [[1366, 768], [1440, 900], [1920, 1080], [820, 1180]]) {
    await page.setViewportSize({ width, height });
    for (const workspace of workspaces) {
      await go(page, workspace);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${workspace[0]} at ${width}px`).toBeLessThanOrEqual(1);
      if (workspace[0] === "scheduler") {
        const timeline = page.getByLabel("Scrollable machine schedule");
        await page.getByRole("button", { name: "Zoom in" }).click();
        await timeline.evaluate((element) => { element.scrollLeft = 200; });
        await expect.poll(() => timeline.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      }
    }
  }
});
