import { expect, test } from "@playwright/test";

test.skip(process.env.FORGEWORKS_PUBLIC_SMOKE !== "1", "Runs against the read-only public build");

test("public recruiter demo provides verified evidence without write access", async ({ page }) => {
  const errors: string[] = [];
  const writes: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", event => {
    const path = new URL(event.url()).pathname;
    if (event.method() !== "GET" && /\/(api|demo)\//.test(path)) {
      writes.push(`${event.method()} ${path}`);
    }
  });
  const go = async (label: string) => {
    await page.getByRole("navigation").getByRole("link", { name: label, exact: true }).click();
    await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
  };
  await page.goto("/");
  await expect(page.getByText(/Public read-only demo/)).toBeVisible();
  await expect(page.getByText("40 scheduled · 40 open")).toBeVisible();
  await go("Production Scheduler");
  const polished = await page.locator("details.snapshot-notice").count() > 0;
  const generate = page.getByRole("button", { name: "Generate schedule" });
  if (polished) await expect(generate).toHaveCount(0);
  else await expect(generate).toBeDisabled();
  await page.getByRole("button", { name: /ORD-\d+ stage/ }).first().click();
  await expect(page.getByRole("dialog")).toContainText("Production time");
  await page.keyboard.press("Escape");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.zip$/);
  await go("AI Prediction Studio");
  await expect(page.getByRole("columnheader", { name: "Historical mean" })).toBeVisible();
  await go("Digital Twin");
  await expect(page.getByRole("heading", { name: "Delivery reliability by order" })).toBeVisible();
  const simulate = page.getByRole("button", { name: "Run simulation" });
  if (polished) await expect(simulate).toHaveCount(0);
  else await expect(simulate).toBeDisabled();
  await go("Planning Copilot");
  await page.getByRole("button", { name: "Explain order timing" }).click();
  await expect(page.getByText("Evidence references")).toBeVisible();
  await go("Scenario Lab");
  await expect(page.getByRole("columnheader", { name: "Alternative", exact: true })).toBeVisible();
  // The published release predates the refinement and still shows disabled actions.
  if (await page.getByRole("heading", { name: "Live what-if planning" }).count()) {
    await expect(page.getByRole("button", { name: "Run scenario" })).toHaveCount(0);
  } else {
    await expect(page.getByRole("button", { name: "Run scenario" })).toBeDisabled();
  }
  await page.reload();
  await expect(page.getByRole("heading", { name: "Scenario Lab", exact: true })).toBeVisible();
  await go("Schedule Approvals");
  const release = page.getByRole("button", { name: "Release", exact: true });
  if (await page.getByText(/This snapshot records historical decisions/).count()) {
    await expect(release).toHaveCount(0);
  } else {
    await expect(release).toBeDisabled();
  }
  expect(writes).toEqual([]);
  const denied = await page.evaluate(async () => {
    const url = new URL("./api/v1/schedules/demo/release", location.href);
    return (await fetch(url, { method: "POST", body: "{}" })).status;
  });
  expect([404, 405, 501]).toContain(denied);
  expect(errors).toEqual([]);
});
