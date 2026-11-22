import { expect, test } from "@playwright/test";

test.skip(process.env.FORGEWORKS_PUBLIC_SMOKE !== "1", "Runs against the read-only public build");

test("public recruiter demo provides verified evidence without write access", async ({ page }) => {
  const errors: string[] = [];
  const methods: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => methods.push(request.method()));
  const go = async (label: string) => {
    await page.getByRole("navigation").getByRole("link", { name: label, exact: true }).click();
    await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
  };
  await page.goto("/");
  await expect(page.getByText(/Public read-only demo/)).toBeVisible();
  await expect(page.getByText("40 scheduled · 40 open")).toBeVisible();
  await go("Production Scheduler");
  await expect(page.getByRole("button", { name: "Generate schedule" })).toBeDisabled();
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
  await expect(page.getByRole("button", { name: "Run simulation" })).toBeDisabled();
  await go("Planning Copilot");
  await page.getByRole("button", { name: "Explain order timing" }).click();
  await expect(page.getByText("Evidence references")).toBeVisible();
  await go("Scenario Lab");
  await expect(page.getByRole("columnheader", { name: "Alternative", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run scenario" })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Scenario Lab", exact: true })).toBeVisible();
  await go("Schedule Approvals");
  await expect(page.getByRole("button", { name: "Release", exact: true })).toBeDisabled();
  expect(methods.every(method => method === "GET")).toBe(true);
  expect(errors).toEqual([]);
});
