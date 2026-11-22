import type { Catalog, CopilotInput, Evaluation, Explanation, PredictionSet, Risk } from "./api";
import type { components } from "./schema";

export const publicDemo = import.meta.env.VITE_PUBLIC_DEMO === "1";
const root = `${import.meta.env.BASE_URL}demo/`;
const assets = new Map<string, unknown>();

class SnapshotError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function asset<T>(name: string, signal: AbortSignal): Promise<T> {
  if (!assets.has(name)) {
    const response = await fetch(`${root}${encodeURIComponent(name)}.json`, { signal });
    if (!response.ok) throw new SnapshotError(response.status, "Could not load the verified demo evidence.");
    assets.set(name, await response.json());
  }
  return assets.get(name) as T;
}

type Index = { catalog: Catalog; models: Evaluation[]; benchmark: unknown; health: { status: string } };
type Snapshot = {
  schedule: components["schemas"]["ConsoleSchedule"];
  evidence: Record<string, Explanation>;
  predictions: Record<string, Record<string, Omit<PredictionSet, "evaluation">>>;
  evaluation: Evaluation | null;
  risks: Record<string, { projection: Risk; completions: Record<string, number>[] }>;
  validation: { valid: boolean };
};

export function snapshotExport(id: string) {
  return `${root}${encodeURIComponent(id)}.zip`;
}

export async function snapshotRequest<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
  const validation = /^\/schedules\/([a-f0-9]{32})\/validate$/.exec(path);
  if (body !== undefined && path !== "/copilot/query" && !validation) {
    throw new SnapshotError(403, "Planning changes are disabled in the public recruiter demo.");
  }
  const index = await asset<Index>("index", signal);
  const url = new URL(path, "https://forgeworks.invalid");
  if (path === "/health") return index.health as T;
  if (path === "/console/catalog") return index.catalog as T;
  if (path === "/models") return index.models as T;
  if (path === `/benchmarks/${index.catalog.latest_benchmark}`) return index.benchmark as T;
  const query = path === "/copilot/query" ? body as CopilotInput : undefined;
  const route = /^\/console\/schedules\/([^/]+)(?:\/(risk|predictions))?$/.exec(url.pathname);
  const id = query?.schedule ?? route?.[1] ?? validation?.[1];
  if (!id || !index.catalog.schedules.some((row) => row.id === id)) {
    throw new SnapshotError(404, "This schedule version is unavailable.");
  }
  const data = await asset<Snapshot>(id, signal);
  if (query) {
    const tool = query.tool;
    const reference = tool === "explain_order_delay" ? query.order
      : tool === "explain_assignment" ? `${query.order}:${query.stage}`
      : tool === "compare_schedules" ? query.other_schedule : "";
    const evidence = data.evidence[`${tool}:${reference ?? ""}`];
    if (!evidence) throw new SnapshotError(422, "Choose an evidence question from the provided options.");
    return evidence as T;
  }
  if (validation) return { ...data.validation, violations: data.schedule.validation } as T;
  if (route?.[2] === "predictions") {
    const result = data.predictions[url.searchParams.get("order") ?? ""]?.[url.searchParams.get("shift") ?? "all"];
    if (!result) throw new SnapshotError(404, "Prediction evidence is unavailable.");
    return { ...result, evaluation: data.evaluation } as T;
  }
  if (route?.[2] === "risk") {
    const id = url.searchParams.get("simulation_id") ?? String(data.schedule.simulations[0]?.id);
    const run = data.risks[id];
    if (!run) throw new SnapshotError(404, "Simulation evidence is unavailable.");
    const order = url.searchParams.get("order");
    return {
      ...run.projection,
      series: run.projection.series.map((point, index) => ({
        ...point,
        completion: order ? (run.completions[index]?.[order] ?? null) : null,
      })),
    } as T;
  }
  return data.schedule as T;
}
