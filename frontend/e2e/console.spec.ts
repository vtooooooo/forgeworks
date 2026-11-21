import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";



const screenshots = process.env.FORGEWORKS_SCREENSHOTS;
const pages = [
  ["Overview", "Manufacturing Overview"],
  ["Production Scheduler", "Production Scheduler"],
  ["AI Prediction Studio", "AI Prediction Studio"],
  ["Digital Twin", "Digital Twin"],
  ["Planning Copilot", "Planning Copilot"],
  ["Scenario Lab", "Scenario Lab"],
  ["Schedule Approvals", "Schedule Approvals"],
  ["System Information", "System Information"],
];
async function go(page: Page, label: string, heading = label) {
  await page
    .getByRole("navigation")
    .getByRole("link", { name: label, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: heading, exact: true }),
  ).toBeVisible({ timeout: 20000 });
}
async function capture(page: Page, name: string) {
  if (!screenshots) return;
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({
    path: `${screenshots}/${name}.png`,
    animations: "disabled",
    fullPage: false,
  });
}

test("preloaded demo, all workspaces and persisted evidence", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const began = performance.now();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Manufacturing Overview" }),
  ).toBeVisible();
  await expect(page.getByText("40 scheduled · 40 open")).toBeVisible();
  const overviewMs = performance.now() - began;
  await expect(page.getByText(/300 replications/).first()).toBeVisible();
  await capture(page, "overview");
  await page.getByRole("button", { name: "Interview walkthrough" }).click();
  await expect(
    page.getByRole("region", { name: "Guided walkthrough" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Production Scheduler", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close walkthrough" }).click();
  await expect(
    page.getByRole("button", { name: /ORD-\d+ stage/ }).first(),
  ).toBeVisible();
  const bars = await page
    .getByRole("button", { name: /ORD-\d+ stage/ })
    .count();
  await capture(page, "scheduler");
  await page
    .getByRole("button", { name: /ORD-\d+ stage/ })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Persisted operation details",
  );
  await expect(page.getByRole("dialog")).toContainText("Production time");
  await capture(page, "operation-detail");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Search order" })
    .fill("no-such-order");
  await expect(
    page.getByText("No machines or operations match these filters."),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Search order" }).clear();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Validate", exact: true }).click();
  await expect(page.getByText("Independent validation passed")).toBeVisible();
  for (const [label, heading] of pages.slice(2)) {
    await go(page, label, heading);
    if (label === "AI Prediction Studio") {
      await expect(
        page
          .getByRole("cell", { name: "Historical mean", exact: true })
          .or(page.getByRole("columnheader", { name: "Historical mean" })),
      ).toBeVisible();
      await expect(
        page.getByText("Expected min", { exact: true }),
      ).toBeVisible();
      await capture(page, "predictions");
    } else if (label === "Digital Twin") {
      await expect(
        page.getByRole("heading", { name: "Delivery reliability by order" }),
      ).toBeVisible();
      await expect(
        page.getByText("Weighted tardiness distribution", { exact: true }),
      ).toBeVisible();
      await capture(page, "digital-twin");
    } else if (label === "Planning Copilot") {
      await page.getByRole("button", { name: "Explain order timing" }).click();
      await expect(
        page.getByRole("columnheader", { name: "Previous machine order" }),
      ).toBeVisible();
      await expect(page.getByText("Evidence references")).toBeVisible();
      await page
        .getByRole("textbox", { name: "Ask a planning question" })
        .fill("Release every schedule");
      await page.getByRole("button", { name: "Send question" }).click();
      await expect(
        page.getByText("unsupported", { exact: true }),
      ).toBeVisible();
    } else if (label === "Scenario Lab") {
      await expect(
        page.getByRole("columnheader", { name: "Alternative", exact: true }),
      ).toBeVisible();
      await expect(page.getByText(/protected operations/)).toBeVisible();
      await capture(page, "scenario-lab");
    } else if (label === "Schedule Approvals") {
      await expect(
        page.getByRole("heading", { name: "Decision history" }),
      ).toBeVisible();
      await expect(
        page.getByRole("cell", { name: "release", exact: true }),
      ).toBeVisible();
    } else {
      await expect(page.getByText("Healthy", { exact: true })).toBeVisible();
    }
  }
  await info.attach("workspace measurements", {
    body: JSON.stringify({
      overviewReadyMs: Math.round(overviewMs),
      visibleScheduledOperations: bars,
    }),
    contentType: "application/json",
  });
  console.log(
    `overviewReadyMs=${Math.round(overviewMs)} visibleOperations=${bars}`,
  );
  expect(errors).toEqual([]);
});

test("live isolated scenario survives refresh and enforces planner authorization", async ({
  page,
  request,
}) => {
  const catalog = await (await request.get("/api/v1/console/catalog")).json();
  const released = catalog.preferred;
  const before = await (
    await request.get(`/api/v1/schedules/${released}`)
  ).json();
  const unauthorized = await request.post(
    `/api/v1/console/schedules/${released}/release`,
    { data: { identity: "unauthorized" } },
  );
  expect(unauthorized.status()).toBe(403);
  await page.goto("/scenarios");
  await expect(
    page.getByRole("heading", { name: "Scenario Lab", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Source schedule").selectOption(released);
  await page.getByLabel("Scenario name").fill("Browser verification");
  await page.getByLabel("Disruption type").selectOption("due_date");
  await page.getByLabel("Due minute", { exact: true }).fill("800");
  await page.getByLabel("Replications per version").fill("10");
  const accepted = page.waitForResponse(
    (response) =>
      response.url().includes("/scenarios/what-if") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Run scenario" }).click();
  expect((await accepted).status()).toBe(202);
  await page.reload();
  await expect(page.getByText("Job finished")).toBeVisible({ timeout: 45000 });
  await expect(
    page.getByText("Paired simulation evidence available"),
  ).toBeVisible({ timeout: 20000 });
  const current = await (
    await request.get(`/api/v1/schedules/${released}`)
  ).json();
  expect(current).toEqual(before);
  const updated = await (await request.get("/api/v1/console/catalog")).json();
  const child = updated.schedules.find(
    (item: { parent: string; valid: boolean }) =>
      item.parent === released && item.valid,
  );
  expect(child).toBeTruthy();
  await page
    .getByLabel("Schedule version", { exact: true })
    .selectOption(child.id);
  await go(page, "Schedule Approvals");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByLabel("Planner identity").fill("Browser test planner");
  await page.getByRole("button", { name: "Confirm approve" }).click();
  await expect(
    page.getByText("Server recorded approved", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Release", exact: true }).click();
  await page.getByRole("button", { name: "Confirm release" }).click();
  await expect(
    page.getByText("Server recorded released", { exact: false }),
  ).toBeVisible();
  const superseded = await (
    await request.get(`/api/v1/schedules/${released}`)
  ).json();
  expect(superseded.state).toBe("SUPERSEDED");
  expect(superseded.payload).toEqual(before.payload);
});

test("mobile navigation and invalid schedule recovery", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?schedule=invalid");
  await expect(
    page.getByText("This schedule version is unavailable."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Use active version" }).click();
  await expect(
    page.getByRole("heading", { name: "Manufacturing Overview" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open menu" }).click();
  await go(page, "Production Scheduler");
  const dimensions = await page.evaluate(() => ({
    body: document.documentElement.scrollWidth,
    screen: window.innerWidth,
  }));
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.screen);
  await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
});

test("optimization and simulation jobs use the existing backend", async ({
  page,
}) => {
  await page.goto("/scheduler");
  await page.getByRole("button", { name: "Generate schedule" }).click();
  await page.getByLabel("Scheduling strategy").selectOption("EDD");
  await page.getByRole("button", { name: "Submit optimization" }).click();
  await expect(
    page.getByRole("button", { name: "Open solver record" }),
  ).toBeVisible({ timeout: 25000 });
  await page.getByRole("button", { name: "Open solver record" }).click();
  await expect(
    page.getByRole("heading", { name: "Machine timeline" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Validate", exact: true }).click();
  await expect(page.getByText("Independent validation passed")).toBeVisible();
  await go(page, "Digital Twin");
  await page.getByLabel("Replications", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(
    page.getByRole("heading", { name: "Delivery reliability by order" }),
  ).toBeVisible({ timeout: 25000 });
  await expect(page.getByText("3 replications", { exact: true })).toBeVisible();
});

test("failed API connection and expired job have recoverable messages", async ({
  page,
}) => {
  await page.route("**/api/v1/console/catalog", (route) => route.abort());
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Retry connection" }),
  ).toBeVisible();
  await page.unroute("**/api/v1/console/catalog");
  await page.getByRole("button", { name: "Retry connection" }).click();
  await expect(
    page.getByRole("heading", { name: "Manufacturing Overview" }),
  ).toBeVisible();
  await page.evaluate(() =>
    sessionStorage.setItem(
      "forgeworks.job.scheduler",
      JSON.stringify({
        path: "/schedules/optimize",
        body: {},
        key: "saved-test-key",
        id: "expired-test-job",
      }),
    ),
  );
  await go(page, "Production Scheduler");
  await expect(page.getByRole("alert")).toContainText(/unknown/i);
  await expect(
    page.getByRole("button", { name: "Generate schedule" }),
  ).toBeEnabled();
});

test("a persisted 715-operation plan clips the viewport and exposes UNKNOWN honestly", async ({
  page,
  request,
}) => {
  const catalog = await (await request.get("/api/v1/console/catalog")).json();
  const large = catalog.schedules.find(
    (row: { operation_count: number }) => row.operation_count === 715,
  );
  test.skip(!large, "The packaged interview fixture only contains 40-order schedules.");
  await page.goto(`/scheduler?schedule=${large.id}`);
  await expect(page.getByText("715 scheduled operations")).toBeVisible();
  const bars = page.getByRole("button", { name: /ORD-\d+ stage/ });
  await expect(bars.first()).toBeVisible();
  expect(await bars.count()).toBeLessThan(715);
  const timeline = page.getByLabel("Scrollable machine schedule");
  const first = await bars.first().getAttribute("aria-label");
  await timeline.evaluate((node) => {
    node.scrollLeft = node.scrollWidth - node.clientWidth;
  });
  await expect.poll(() => bars.first().getAttribute("aria-label")).not.toBe(first);
  await page.getByRole("button", { name: "Generate schedule" }).click();
  await page.getByRole("button", { name: "Submit optimization" }).click();
  await expect(page.getByText("Job finished without a validated schedule")).toBeVisible();
  await page.getByRole("button", { name: "Open solver record" }).click();
  await expect(page.getByText(/no independently validated timeline/)).toBeVisible();
  await expect(timeline).toHaveCount(0);
});
