import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { normalizeSchedule, request, type Schedule } from "../src/api";
import { Evidence } from "../src/intelligence";
import { scenarioChange } from "../src/planning";
import {
  filterOperations,
  openingFilters,
  spanStyle,
  Timeline,
} from "../src/scheduler";
import {
  isValid,
  JobStatus,
  Metric,
  number,
  percent,
  riskLevel,
  Status,
  time,
  weighted,
} from "../src/ui";

const machine = {
  id: "M-01",
  department: "Cutting",
  capabilities: ["cut"],
  families: ["bracket"],
  shifts: [{ start: 0, end: 480 }],
  maintenance: [],
  rate: 1,
  condition: 1,
  cost_per_hour: 60,
  overtime: true,
  capacity: 20,
};
const order = {
  id: "ORD-101",
  product: "SKU-01",
  quantity: 2,
  release: 0,
  due: 30,
  priority: 5,
  customer: "standard",
  status: "open" as const,
  hard_due: false,
};
const op = {
  order: order.id,
  stage: 0,
  machine: machine.id,
  setup_start: 1,
  start: 6,
  end: 36,
};
const schedule: Schedule = {
  id: "example",
  dataset: "dataset",
  parent: null,
  model: null,
  state: "VALIDATED",
  epoch: "2026-01-05T11:00:00Z",
  timezone: "America/New_York",
  plan: {
    method: "CP-SAT",
    status: "FEASIBLE",
    operations: [op],
    completion: { [order.id]: 36 },
    tardiness: { [order.id]: 6 },
    seconds: 0.1,
    detail: "",
    assignment_scope: "full",
    weights: { tardiness: 20, makespan: 1, setup: 1, move: 2, reassign: 30 },
  },
  factory: {
    seed: 42,
    name: "normal",
    horizon: 480,
    machines: [machine],
    products: [
      {
        id: "SKU-01",
        family: "bracket",
        material: "steel",
        units: 1,
        route: ["cut"],
      },
    ],
    orders: [order],
    inventory: { steel: 1 },
    receipts: [{ id: "RC-0", material: "steel", at: 30, quantity: 5 }],
    variability: 0.1,
    outages: {},
  },
  validation: [],
  high_risk: false,
  frozen: 0,
  load: [
    {
      machine: machine.id,
      department: machine.department,
      busy: 35,
      available: 36,
    },
  ],
  simulations: [],
  approvals: [],
  changes: [],
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("operational presentation", () => {
  test("formats unchanged probability scale, missing evidence and factory time", () => {
    expect(number(null)).toBe("—");
    expect(percent(0.9056, 1)).toBe("90.6%");
    expect(time(schedule, 0, "clock")).toBe("6:00 AM");
    expect(time(schedule, 720, "clock")).toBe("6:00 PM");
    expect(weighted(schedule)).toBe(30);
  });
  test("distinguishes solver statuses and risk bands", () => {
    render(
      <>
        <Status value="FEASIBLE" />
        <Status value="UNKNOWN" />
      </>,
    );
    expect(screen.getByText("Feasible")).toBeVisible();
    expect(screen.getByText("Unknown")).toBeVisible();
    expect(
      isValid({ ...schedule, plan: { ...schedule.plan, status: "UNKNOWN" } }),
    ).toBe(false);
    expect([
      riskLevel(),
      riskLevel(0.02),
      riskLevel(0.1),
      riskLevel(0.55),
    ]).toEqual(["Unavailable", "Low risk", "Watch", "High risk"]);
  });
  test("renders KPI without inventing unavailable actuals", () => {
    render(
      <Metric
        title="Completed orders"
        value={number(undefined)}
        detail="Unavailable"
        icon={null}
      />,
    );
    expect(screen.getByText("—")).toBeVisible();
    expect(screen.getByText("Unavailable")).toBeVisible();
  });
});
describe("timeline and form", () => {
  test("clips timeline to horizon and filters schedule operations", () => {
    expect(spanStyle(-10, 40, 100)).toEqual({ left: "0%", width: "40%" });
    expect(
      filterOperations(schedule, { ...openingFilters, machine: "M-02" }),
    ).toHaveLength(0);
    expect(
      filterOperations(schedule, {
        ...openingFilters,
        order: "101",
        priority: "5",
      }),
    ).toEqual([op]);
  });
  test("operation selection exposes machine and order via a named button", () => {
    const select = vi.fn();
    render(
      <Timeline
        schedule={schedule}
        filters={openingFilters}
        zoom={1}
        select={select}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "ORD-101 stage 1 on M-01" }),
    );
    expect(select).toHaveBeenCalledWith(op);
  });
  test("validates scenario duration and maps valid breakdown", () => {
    const form = {
      kind: "breakdown" as const,
      machine: "M-01",
      order: order.id,
      product: order.product,
      receipt: "RC-0",
      start: 40,
      duration: 30,
      index: 0,
      stage: 0,
      due: 30,
      quantity: 10,
      newOrder: "ORD-N",
    };
    expect(scenarioChange(form, schedule)).toEqual({
      kind: "breakdown",
      machine: "M-01",
      start: 40,
      end: 70,
      index: 0,
    });
    expect(() => scenarioChange({ ...form, duration: 900 }, schedule)).toThrow(
      "horizon",
    );
    expect(() => scenarioChange({ ...form, machine: "X" }, schedule)).toThrow(
      "machine",
    );
  });
});
describe("API and evidence", () => {
  test("maps omitted optional structures safely", () => {
    expect(
      normalizeSchedule({
        ...schedule,
        plan: { ...schedule.plan, completion: undefined, tardiness: undefined },
      }).plan.completion,
    ).toEqual({});
  });
  test("reports API validation errors and sends idempotent submissions", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ detail: [{ msg: "Invalid field" }] }), {
          status: 422,
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      request("/schedules/optimize", { body: {}, key: "retry-key" }),
    ).rejects.toThrow("Invalid field");
    expect(fetcher.mock.calls[0][1].headers["Idempotency-Key"]).toBe(
      "retry-key",
    );
  });
  test("shows recorded evidence and does not invent success from an unknown job", () => {
    render(
      <>
        <Evidence
          answer={{
            classification: "simulation_estimate",
            evidence: { schedule: "example" },
            result: {
              simulation: "saved-run",
              orders: [{ order: order.id, p_late: 0.45, p95_completion: 30 }],
            },
          }}
          schedule={schedule}
        />
        <JobStatus
          busy={false}
          error=""
          job={{
            id: "saved",
            kind: "optimize",
            state: "SUCCEEDED",
            result: { solver_status: "UNKNOWN" },
          }}
        />
      </>,
    );
    expect(screen.getByText("Evidence references")).toBeVisible();
    expect(screen.getByText("45%")).toBeVisible();
    expect(screen.getByText("Unknown")).toBeVisible();
  });
});
