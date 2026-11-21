import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { components } from "./schema";

type Schema = components["schemas"];
export type Catalog = Schema["Catalog"];
type WireSchedule = Schema["ConsoleSchedule"];
export type Schedule = WireSchedule & {
  plan: WireSchedule["plan"] & {
    completion: Record<string, number>;
    tardiness: Record<string, number>;
  };
  factory: WireSchedule["factory"] & {
    outages: Record<string, Schema["Window"][]>;
  };
};
export function normalizeSchedule(value: WireSchedule): Schedule {
  return {
    ...value,
    plan: {
      ...value.plan,
      completion: value.plan.completion ?? {},
      tardiness: value.plan.tardiness ?? {},
    },
    factory: { ...value.factory, outages: value.factory.outages ?? {} },
  };
}
export type Order = Schema["Order"];
export type Operation = Schema["Operation"];
export type Risk = Schema["ConsoleRisk"];
export type OptimizeInput = Schema["OptimizeRequest"];
export type ScenarioInput = Schema["WhatIfRequest"];
export type CopilotInput = Schema["Query"];
export type SimulationInput = Schema["SimulationConfig"];
export type ApprovalInput = Schema["ApprovalRequest"];
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export type Prediction = {
  order: string;
  stage: number;
  machine: string;
  operation: string;
  erp: number;
  expected: number;
  lower: number | null;
  upper: number | null;
  minutes: number;
  method: string;
  history_mean: number | null;
  history_count: number;
  features: Record<string, string | number>;
};
type Performance = {
  mae: number;
  rmse: number;
  coverage: number;
  interval_width: number;
  n: number;
};
export type Evaluation = {
  id: string;
  dataset: string;
  selected: string;
  trained_at: string;
  models: Record<string, { test: Performance }>;
};
export type PredictionSet = {
  order: string;
  family: string;
  product: string;
  model: string | null;
  historical_dataset: string;
  predictions: Prediction[];
  evaluation: Evaluation | null;
};
export type Explanation = {
  classification: string;
  evidence: Record<string, Json>;
  result: Json;
};
export type Job = {
  id: string;
  kind: string;
  state: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  error?: string;
  result?: {
    parent?: string;
    schedule?: string;
    simulation?: string;
    valid?: boolean;
    status?: string;
    solver_status?: string;
  };
};
export const base = (import.meta.env.VITE_API_BASE ?? "/api/v1").replace(
  /\/$/,
  "",
);
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function request<T>(
  path: string,
  options: { body?: unknown; signal?: AbortSignal; key?: string } = {},
): Promise<T> {
  const timeout = AbortSignal.timeout(12000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    headers["X-ForgeWorks-Console"] = "1";
  }
  if (options.key) headers["Idempotency-Key"] = options.key;
  const response = await fetch(
    path.startsWith("/health") ? path : base + path,
    {
      method: options.body === undefined ? "GET" : "POST",
      headers,
      signal,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    },
  );
  if (!response.ok) {
    const failure = (await response.json().catch(() => ({}))) as {
      detail?: unknown;
    };
    const detail = Array.isArray(failure.detail)
      ? failure.detail.map((v: { msg: string }) => v.msg).join(". ")
      : failure.detail;
    throw new ApiError(
      response.status,
      typeof detail === "string"
        ? detail
        : `ForgeWorks returned HTTP ${response.status}`,
    );
  }
  return response.json() as Promise<T>;
}
export const segment = encodeURIComponent;
export const useCatalog = () =>
  useQuery({
    queryKey: ["catalog"],
    queryFn: ({ signal }) => request<Catalog>("/console/catalog", { signal }),
  });
export const useSchedule = (id: string) =>
  useQuery({
    queryKey: ["schedule", id],
    enabled: !!id,
    queryFn: async ({ signal }) =>
      normalizeSchedule(
        await request<WireSchedule>(`/console/schedules/${segment(id)}`, {
          signal,
        }),
      ),
  });
export const useRisk = (
  id: string,
  simulation?: string,
  order?: string,
  enabled = true,
) =>
  useQuery({
    queryKey: ["risk", id, simulation, order],
    enabled: !!id && enabled,
    retry: false,
    queryFn: ({ signal }) => {
      const search = new URLSearchParams();
      if (simulation) search.set("simulation_id", simulation);
      if (order) search.set("order", order);
      return request<Risk>(`/console/schedules/${segment(id)}/risk?${search}`, {
        signal,
      });
    },
  });

type Submission = { path: string; body: unknown; key: string; id?: string };
function loadSubmission(key: string): Submission | null {
  try {
    return JSON.parse(
      sessionStorage.getItem(key) ?? "null",
    ) as Submission | null;
  } catch {
    return null;
  }
}
export function useTask(surface: string) {
  const storageKey = `forgeworks.job.${surface}`;
  const [saved, setSaved] = useState(() => loadSubmission(storageKey));
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState("");
  const lock = useRef(false);
  const poll = useQuery({
    queryKey: ["job", saved?.id],
    enabled: !!saved?.id,
    queryFn: ({ signal }) =>
      request<Job>(`/jobs/${segment(saved!.id!)}`, { signal }),
    refetchInterval: (query) =>
      query.state.error ||
      ["SUCCEEDED", "FAILED"].includes(query.state.data?.state ?? "")
        ? false
        : 750,
    retry: (count, e) =>
      count < 2 && (!(e instanceof ApiError) || e.status >= 500),
  });
  const save = (value: Submission) => {
    sessionStorage.setItem(storageKey, JSON.stringify(value));
    setSaved(value);
  };
  const submit = async (path: string, body: unknown) => {
    if (
      lock.current ||
      poll.data?.state === "RUNNING" ||
      poll.data?.state === "QUEUED"
    )
      return;
    lock.current = true;
    setSubmitting(true);
    setFailure("");
    const same =
      saved &&
      !saved.id &&
      saved.path === path &&
      JSON.stringify(saved.body) === JSON.stringify(body);
    const draft = same ? saved : { path, body, key: crypto.randomUUID() };
    save(draft);
    try {
      const job = await request<Schema["JobAccepted"]>(path, {
        body,
        key: draft.key,
      });
      save({ ...draft, id: job.id });
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      lock.current = false;
      setSubmitting(false);
    }
  };
  const busy =
    submitting ||
    (!!saved?.id &&
      !poll.error &&
      (!poll.data || ["RUNNING", "QUEUED"].includes(poll.data.state)));
  return {
    submit,
    busy,
    job: poll.data,
    error: failure || poll.error?.message || poll.data?.error || "",
    resume:
      saved && !saved.id && !submitting
        ? () => submit(saved.path, saved.body)
        : undefined,
  };
}
