import { publicDemo } from "./public-demo";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  BarChart3,
  BrainCircuit,
  Clock3,
  Gauge,
  MessagesSquare,
  Play,
  Send,
  Shield,
  Timer,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  request,
  segment,
  useRisk,
  useSchedule,
  type Risk,
  useTask,
  type CopilotInput,
  type Evaluation,
  type Explanation,
  type Json,
  type PredictionSet,
  type Schedule,
} from "./api";
import { useConsole } from "./context";
import {
  Badge,
  Button,
  Field,
  isValid,
  JobStatus,
  Message,
  Metric,
  number,
  PageTitle,
  Panel,
  percent,
  riskLevel,
  Select,
  short,
  Table,
  time,
} from "./ui";

export function Predictions() {
  const { schedule: s, order: focused } = useConsole();
  const [family, setFamily] = useState("");
  const [order, setOrder] = useState("");
  const [machine, setMachine] = useState("");
  const [stage, setStage] = useState("");
  const [shift, setShift] = useState("");
  const [featureSelection, setFeatureSelection] = useState("");
  const families = [...new Set(s?.factory.products.map((p) => p.family))];
  const accepted =
    s?.factory.orders.filter(
      (o) =>
        !family ||
        s.factory.products.find((p) => p.id === o.product)?.family === family,
    ) ?? [];
  const selected = accepted.some((o) => o.id === order)
    ? order
    : accepted.some((o) => o.id === focused)
      ? focused
      : (accepted[0]?.id ?? "");
  const pred = useQuery({
    queryKey: ["predictions", s?.id, selected, shift],
    enabled: !!s && !!selected,
    queryFn: ({ signal }) =>
      request<PredictionSet>(
        `/console/schedules/${segment(s!.id)}/predictions?order=${segment(selected)}${shift ? "&shift=" + shift : ""}`,
        { signal },
      ),
  });
  const models = useQuery({
    queryKey: ["models"],
    queryFn: ({ signal }) => request<Evaluation[]>("/models", { signal }),
  });
  const evaluation =
    pred.data?.evaluation ?? models.data?.find((m) => m.id === s?.model);
  const model = evaluation?.models[evaluation.selected]?.test;
  const erp = evaluation?.models.erp?.test;
  const rows =
    pred.data?.predictions?.filter(
      (p) =>
        (!machine || p.machine === machine) &&
        (!stage || p.operation === stage),
    ) ?? [];
  const assigned = new Set(
    s?.plan.operations
      .filter((o) => o.order === selected)
      .map((o) => `${o.stage}-${o.machine}`),
  );
  const chartRows = (
    machine ? rows : rows.filter((r) => assigned.has(`${r.stage}-${r.machine}`))
  ).slice(0, 12);
  const featureKey = (row: (typeof chartRows)[number]) => `${row.stage}:${row.machine}`;
  const featureRow = chartRows.find((row) => featureKey(row) === featureSelection) ?? chartRows[0];
  return (
    <>
      <PageTitle
        title="AI Prediction Studio"
        subtitle="Inspect persisted duration estimates and synthetic model evaluation."
      />
      <div className="context-strip">
        <BrainCircuit size={17} />
        <span>
          {evaluation
            ? evaluation.selected + " · " + short(evaluation.id)
            : "ERP or model evaluation unavailable"}
        </span>
        <Badge>Synthetic quality gate</Badge>
        <span>
          {evaluation?.trained_at
            ? new Date(evaluation.trained_at).toISOString().slice(0, 10)
            : "Training date unavailable"}
        </span>
      </div>
      <div className="metric-grid">
        <Metric
          title="Selected model MAE"
          value={number(model?.mae, 2)}
          detail="Mean absolute error in minutes · held-out data"
          icon={<Gauge size={20} />}
        />
        <Metric
          title="ERP baseline MAE"
          value={number(erp?.mae, 2)}
          detail={
            model && erp?.mae
              ? `${percent(1 - model.mae / erp.mae, 1)} MAE reduction`
              : "Baseline comparison unavailable"
          }
          icon={<BarChart3 size={20} />}
        />
        <Metric
          title="Interval coverage"
          value={percent(model?.coverage, 1)}
          detail="Observed outcomes inside the nominal 90% interval"
          tone="teal"
          icon={<Shield size={20} />}
        />
        <Metric
          title="RMSE"
          value={number(model?.rmse, 2)}
          detail={`Root mean square error · ${number(model?.n)} observations`}
          tone="amber"
          icon={<Timer size={20} />}
        />
      </div>
      <Panel
        className="tour-target"
        title="Duration comparison"
        subtitle="Assigned operations by default. Select a machine to inspect alternative estimates."
      >
        <div className="form-grid filter-grid">
          <Field label="Product family">
            <Select
              value={family}
              onChange={(e) => {
                setFamily(e.target.value);
                setOrder("");
                setStage("");
              }}
            >
              <option value="">All families</option>
              {families.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </Select>
          </Field>
          <Field label="Production order">
            <Select
              value={selected}
              onChange={(e) => {
                setOrder(e.target.value);
                setStage("");
              }}
            >
              {accepted.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.id} · {o.product}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Machine">
            <Select
              value={machine}
              onChange={(e) => setMachine(e.target.value)}
            >
              <option value="">Assigned stages</option>
              {s?.factory.machines.map((m) => (
                <option key={m.id}>{m.id}</option>
              ))}
            </Select>
          </Field>
          <Field label="Operation type">
            <Select value={stage} onChange={(e) => setStage(e.target.value)}>
              <option value="">All operations</option>
              {[...new Set(pred.data?.predictions.map((p) => p.operation))].map(
                (o) => (
                  <option key={o}>{o}</option>
                ),
              )}
            </Select>
          </Field>
          <Field label="Historical shift">
            <Select value={shift} onChange={(e) => setShift(e.target.value)}>
              <option value="">All shifts</option>
              <option value="0">First shift</option>
              <option value="1">Second shift</option>
            </Select>
          </Field>
        </div>
        {pred.error && <Message kind="error">{pred.error.message}</Message>}
        {pred.isFetching && (
          <Message kind="loading">Loading stored prediction evidence</Message>
        )}
        {chartRows.length > 0 ? (
          <div
            className="chart-frame"
            role="group"
            aria-label="Duration comparison chart in minutes. Exact values appear in the table below."
          >
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={chartRows}
                margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
              >
                <CartesianGrid vertical={false} stroke="#e6edf5" />
                <XAxis dataKey="operation" />
                <YAxis width={52} unit=" min" />
                <Tooltip />
                <Legend />
                <Bar
                  dataKey="erp"
                  name="ERP standard"
                  fill="#576e87"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="expected"
                  name="Model estimate"
                  fill="#3874d5"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="history_mean"
                  name="Historical group mean"
                  fill="#28796f"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          !pred.isFetching && (
            <Message>
              No stored duration evidence matches this selection.
            </Message>
          )
        )}
        <Table
          columns={[
            "Operation",
            "Machine",
            "ERP min",
            "Expected min",
            "Prediction interval",
            "Historical mean",
            "Observations",
          ]}
          rows={chartRows.map((p) => [
            p.operation,
            p.machine,
            number(p.erp, 1),
            number(p.expected, 1),
            p.lower === null
              ? "Unavailable"
              : <div className="prediction-range">
                  <meter min={p.lower} max={p.upper ?? p.lower} value={p.expected} aria-label={`${p.operation} estimate within the prediction interval`} />
                  <span>{number(p.lower, 1)}–{number(p.upper, 1)} min</span>
                </div>,
            number(p.history_mean, 1),
            p.history_count,
          ])}
        />
      </Panel>
      <div className="overview-grid">
        <Panel
          title="Prediction inputs"
          subtitle={`${selected || "No order selected"} · model ${short(pred.data?.model)}`}
        >
          {featureRow && <div className="panel-copy"><Field label="Operation for feature evidence">
            <Select value={featureKey(featureRow)} onChange={(event) => setFeatureSelection(event.target.value)}>
              {chartRows.map((row) => <option key={featureKey(row)} value={featureKey(row)}>Stage {row.stage + 1} · {row.operation} · {row.machine}</option>)}
            </Select>
          </Field></div>}
          <Table
            columns={["Feature", "Persisted planning value"]}
            rows={Object.entries(featureRow?.features ?? {}).map(([k, v]) => [
              k.replaceAll("_", " "),
              typeof v === "number" ? number(v, 2) : v,
            ])}
          />
        </Panel>
        <Panel title="Methodology">
          <div className="panel-copy">
            <p>
              Training, selection, calibration, and evaluation use time-disjoint
              partitions. Historical means group synthetic execution records by
              family, machine, operation, and selected shift. An historical
              group mean is unavailable when no records match.
            </p>
            <p>
              Better duration estimates can improve the time reserved for each
              operation. The evaluation uses synthetic data only. Real factory
              performance has yet to be validated.
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}

function histogram(values: number[]) {
  if (!values.length) return [];
  const min = Math.min(...values),
    max = Math.max(...values),
    step = Math.max(1, Math.ceil((max - min + 1) / 12));
  const bins = Array.from(
    { length: Math.floor((max - min) / step) + 1 },
    (_, i) => ({ start: min + i * step, count: 0 }),
  );
  for (const value of values) bins[Math.floor((value - min) / step)].count++;
  return bins;
}

function OrderRiskTable({ schedule, rows }: { schedule: Schedule; rows: Risk["risk"] }) {
  const [params] = useSearchParams();
  const watchlist = params.get("risk") === "watch";
  const watchTarget = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (watchlist) watchTarget.current?.scrollIntoView({ block: "start" });
  }, [watchlist]);
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState(watchlist ? "Delivery watch" : "");
  const [sort, setSort] = useState<{ key: "order" | "p_late" | "p50_completion" | "p95_completion" | "completed_runs"; desc: boolean }>({ key: "p_late", desc: true });
  const [page, setPage] = useState(0);
  const pageSize = 10;
  const matched = rows.filter((row) => {
    const matchesLevel = level === "Delivery watch"
      ? row.p_late >= 0.1 && schedule.plan.tardiness[row.order] === 0
      : !level || riskLevel(row.p_late) === level;
    return matchesLevel && row.order.toLowerCase().includes(search.trim().toLowerCase());
  }).sort((a, b) => {
    const left = a[sort.key], right = b[sort.key];
    if (left == null || right == null) return left == null ? (right == null ? 0 : 1) : -1;
    const result = typeof left === "string" ? left.localeCompare(String(right)) : Number(left) - Number(right);
    return (sort.desc ? -result : result) || a.order.localeCompare(b.order);
  });
  const last = Math.max(0, Math.ceil(matched.length / pageSize) - 1);
  const current = Math.min(page, last);
  const start = current * pageSize;
  const columns = [
    ["Order", "order"], ["Estimated late", "p_late"], ["95% interval", null], ["Signal", null],
    ["P50 completion", "p50_completion"], ["P95 completion", "p95_completion"], ["Completed runs", "completed_runs"],
  ] as const;

  return (
    <Panel className="tour-target" title="Delivery reliability by order" subtitle="Estimated probability of missing the due date. Wilson intervals show uncertainty in each probability.">
      <div className="panel-copy evidence-toolbar" ref={watchTarget}>
        <Field label="Search order ID"><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} /></Field>
        <Field label="Risk level">
          <Select value={level} onChange={(event) => { setLevel(event.target.value); setPage(0); }}>
            <option value="">All risk levels</option>
            {["Delivery watch", "High risk", "Watch", "Low risk"].map((label) => <option key={label}>{label}</option>)}
          </Select>
        </Field>
      </div>
      {matched.length ? <div className="table-scroll">
        <table>
          <thead><tr>{columns.map(([label, key]) => (
            <th key={label} scope="col" aria-sort={key === sort.key ? (sort.desc ? "descending" : "ascending") : undefined}>
              {key ? <button type="button" className="sort-button" onClick={() => { setSort({ key, desc: key === sort.key ? !sort.desc : key !== "order" }); setPage(0); }}>
                {label} <span aria-hidden="true">{key === sort.key ? (sort.desc ? "↓" : "↑") : "↕"}</span>
              </button> : label}
            </th>
          ))}</tr></thead>
          <tbody>{matched.slice(start, start + pageSize).map((row) => (
            <tr key={row.order}>
              <th scope="row">{row.order}</th>
              <td>{percent(row.p_late, 1)}</td>
              <td>{row.ci95.map((value) => percent(value, 1)).join(" to ")}</td>
              <td><Badge tone={row.p_late >= 0.5 ? "red" : row.p_late >= 0.1 ? "amber" : "green"}>{riskLevel(row.p_late)}</Badge></td>
              <td>{time(schedule, row.p50_completion)}</td>
              <td>{time(schedule, row.p95_completion)}</td>
              <td>{row.completed_runs}</td>
            </tr>
          ))}</tbody>
        </table>
      </div> : <Message>No orders match these filters.</Message>}
      <div className="panel-foot evidence-pagination">
        <span role="status">{matched.length ? `${start + 1}–${Math.min(start + pageSize, matched.length)} of ${matched.length} orders` : "0 orders"}</span>
        <Button disabled={current === 0} onClick={() => setPage(current - 1)}>Previous page</Button>
        <Button disabled={current === last} onClick={() => setPage(current + 1)}>Next page</Button>
      </div>
    </Panel>
  );
}

export function Twin() {
  const { schedule: s, catalog, order: focused } = useConsole();
  const [chosen, setChosen] = useState("");
  const [order, setOrder] = useState("");
  const [runs, setRuns] = useState(100);
  const [seed, setSeed] = useState(42);
  const job = useTask("twin");
  const qc = useQueryClient();
  const id = s?.id ?? "";
  const currentOrder = s?.factory.orders.some((o) => o.id === order)
    ? order
    : s?.factory.orders.some((o) => o.id === focused)
      ? focused
      : (s?.factory.orders[0]?.id ?? "");
  const activeSim = s?.simulations.some((r) => r.id === chosen)
    ? chosen
    : undefined;
  const risk = useRisk(id, activeSim, currentOrder, !!s?.simulations.length);
  useEffect(() => {
    if (job.job?.state === "SUCCEEDED") {
      void qc.invalidateQueries({
        queryKey: ["schedule", job.job.result?.schedule],
      });
      void qc.invalidateQueries({
        queryKey: ["risk", job.job.result?.schedule],
      });
      if (job.job.result?.simulation) setChosen(job.job.result.simulation);
    }
  }, [
    job.job?.id,
    job.job?.state,
    qc,
    job.job?.result?.schedule,
    job.job?.result?.simulation,
  ]);
  const snapshot = risk.data;
  const values = useMemo(
    () => ({
      completion: histogram(
        snapshot?.series.flatMap((r) =>
          typeof r.completion === "number" ? [r.completion] : [],
        ) ?? [],
      ),
      tardiness: histogram(
        snapshot?.series.flatMap((r) =>
          typeof r.weighted_tardiness === "number"
            ? [r.weighted_tardiness]
            : [],
        ) ?? [],
      ),
    }),
    [snapshot],
  );
  if (!s) return null;
  const metrics = snapshot?.summary;
  const ci = (key: string, format: (n: number) => string) =>
    metrics?.[key]?.ci95?.map(format).join(" to ") ?? "Unavailable";
  const ranked = [...(snapshot?.risk ?? [])].sort(
    (a, b) => b.p_late - a.p_late,
  );
  return (
    <>
      <PageTitle
        title="Digital Twin"
        subtitle="Synthetic execution uncertainty and order-level delivery evidence."
      />
      <Panel
        title="Simulation controls"
        subtitle={`Schedule ${short(s.id)} · ${s.simulations.length} persisted runs`}
      >
        <form
          className="form-grid filter-grid"
          onSubmit={(e) => {
            e.preventDefault();
            void job.submit(`/schedules/${segment(s.id)}/simulate`, {
              runs,
              seed,
              uncertain: true,
            });
          }}
        >
          <Field label="Simulation run">
            <Select
              value={activeSim ?? ""}
              onChange={(e) => setChosen(e.target.value)}
            >
              <option value="">Latest evidence</option>
              {s.simulations.map((r) => (
                <option key={String(r.id)} value={String(r.id)}>
                  {short(String(r.id))} ·{" "}
                  {String((r.config as { runs: number })?.runs)} replications
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Replications">
            <input
              type="number"
              min="1"
              max="500"
              required
              value={runs}
              onChange={(e) => setRuns(+e.target.value)}
            />
          </Field>
          <Field label="Random seed">
            <input
              type="number"
              min="0"
              max="2147483647"
              required
              value={seed}
              onChange={(e) => setSeed(+e.target.value)}
            />
          </Field>
          <Button
            className="at-end"
            type="submit"
            variant="primary"
            disabled={!catalog?.can_plan || !isValid(s) || job.busy}
          >
            <Play size={16} /> Run simulation
          </Button>
        </form>
        <JobStatus {...job} />
      </Panel>
      {risk.isFetching && (
        <Message kind="loading">Loading stored simulation results</Message>
      )}
      {risk.error && <Message kind="error">{risk.error.message}</Message>}
      {!snapshot && !risk.isFetching && !risk.error && (
        <Message>This schedule version has no simulation evidence yet.</Message>
      )}
      {snapshot && (
        <>
          <div className="context-strip">
            <Badge tone="blue">Modeled estimates</Badge>
            <span>Run {short(snapshot.id)}</span>
            <span>{String(snapshot.config.runs)} replications</span>
            <span>Seed {String(snapshot.config.seed)}</span>
          </div>
          <div className="metric-grid">
            <Metric
              title="Estimated on-time delivery"
              value={percent(metrics?.on_time?.mean, 1)}
              detail={`95% CI ${ci("on_time", (v) => percent(v, 1))}`}
              icon={<Gauge size={20} />}
            />
            <Metric
              title="Mean weighted tardiness"
              value={number(metrics?.weighted_tardiness?.mean, 1)}
              detail={`95% CI ${ci("weighted_tardiness", (v) => number(v, 1))}`}
              tone="amber"
              icon={<Clock3 size={20} />}
            />
            <Metric
              title="Expected makespan"
              value={`${number(metrics?.makespan?.mean, 1)} min`}
              detail={`95% CI ${ci("makespan", (v) => number(v, 1))} min`}
              icon={<Timer size={20} />}
            />
            <Metric
              title="Mean outage minutes"
              value={number(metrics?.outage_minutes?.mean, 1)}
              detail={`P95 weighted tardiness ${number(snapshot.p95_weighted_tardiness)}`}
              tone="teal"
              icon={<Activity size={20} />}
            />
          </div>
          <p className="evidence-note">The nominal plan uses scheduled durations. The twin estimates the share delivered on time across replications, sums priority-weighted late minutes, and estimates when the last order finishes. The 95% intervals describe uncertainty in the simulated means.</p>
          <OrderRiskTable schedule={s} rows={ranked} />
          <div className="overview-grid">
            <Panel
              title="Order completion distribution"
              subtitle="Observed replication completion minutes from the factory epoch"
              action={
                <Select
                  aria-label="Order completion distribution"
                  value={currentOrder}
                  onChange={(e) => setOrder(e.target.value)}
                >
                  {s.factory.orders.map((o) => (
                    <option key={o.id}>{o.id}</option>
                  ))}
                </Select>
              }
            >
              <Distribution rows={values.completion} color="#3073dd" unit="Completion minute" />
            </Panel>
            <Panel
              title="Weighted tardiness distribution"
              subtitle="Replication count by weighted-minute bin"
            >
              <Distribution rows={values.tardiness} color="#397c78" unit="Weighted late minutes" />
            </Panel>
          </div>
          <Panel
            title="Highest modeled lateness risk"
            subtitle="Estimated probability from the selected simulation"
          >
            <div className="comparison-bars">
              {ranked.slice(0, 6).map((item) => (
                <div key={item.order}>
                  <span>{item.order}</span>
                  <progress max={1} value={item.p_late} />
                  <strong>{percent(item.p_late, 1)}</strong>
                </div>
              ))}
            </div>
          </Panel>

        </>
      )}
      <Message>
        Processing variability parameter: {number(s.factory.variability, 2)}.
        The digital twin models possible factory outcomes. These synthetic
        estimates require calibration against observed production before
        operational use.
      </Message>
    </>
  );
}
function Distribution({
  rows,
  color,
  unit,
}: {
  rows: { start: number; count: number }[];
  color: string;
  unit: string;
}) {
  if (!rows.length)
    return (
      <Message>
        No completion observations were recorded for this selection.
      </Message>
    );
  return (
    <>
      <div className="chart-frame" role="group" aria-label={`Distribution of ${unit.toLowerCase()} across stored replications`}>
        <ResponsiveContainer width="100%" height={215}>
          <BarChart data={rows}>
            <CartesianGrid vertical={false} stroke="#e6edf5" />
            <XAxis dataKey="start" />
            <YAxis allowDecimals={false} />
            <Tooltip labelFormatter={(value) => `${unit}, bin starting at ${value}`} />
            <Bar
              dataKey="count"
              name="Replications"
              fill={color}
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="panel-foot">
        {number(rows.reduce((sum, r) => sum + r.count, 0))} observed values
        across {rows.length} bins
      </div>
    </>
  );
}

type EvidenceRecord = { [key: string]: Json };
const object = (value: Json): EvidenceRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
function CopilotComparison({ data, source }: { data: EvidenceRecord; source: Schedule }) {
  const comparison = useSchedule(typeof data.other === "string" ? data.other : "");
  const target = comparison.data;
  const relatedReplan = target?.parent === source.id ? target
    : source.parent === target?.id ? source : undefined;
  const moved = Array.isArray(data.moved) ? data.moved.map(object) : [];
  const previous = new Map(source.plan.operations.map((op) => [`${op.order}:${op.stage}`, op]));
  const count = (fromLate: boolean) => target ? Object.entries(source.plan.tardiness).filter(([id, old]) => {
    const revised = target.plan.tardiness[id];
    return revised != null && (old > 0) === fromLate && (revised > 0) !== fromLate;
  }).length : null;
  const rows = (changes: EvidenceRecord[]) => changes.map((change) => {
    const start = previous.get(`${change.order}:${change.stage}`)?.start;
    const delta = typeof change.minutes === "number" ? change.minutes : null;
    return [
      String(change.order), Number(change.stage) + 1, String(change.old_machine), String(change.new_machine),
      time(source, start), time(source, start != null && delta != null ? start + delta : null),
      delta == null ? "—" : `${delta > 0 ? "+" : ""}${delta} min`,
    ];
  });
  const columns = ["Order ID", "Operation stage", "Previous machine", "New machine", "Previous start", "Revised start", "Timing difference"];
  const featured = [...moved].sort((a, b) => Math.abs(Number(b.minutes)) - Math.abs(Number(a.minutes))).slice(0, 6);
  return (
    <section className="evidence-result">
      <h3>Schedule Comparison</h3>
      <dl className="details comparison-summary">
        <div><dt>Operations moved</dt><dd>{moved.length}</dd></div>
        <div><dt>Machine reassignments</dt><dd>{number(typeof data.reassignments === "number" ? data.reassignments : null)}</dd></div>
        <div><dt>Protected operations</dt><dd>{number(relatedReplan?.frozen)}</dd></div>
        <div><dt>Newly late orders</dt><dd>{number(count(false))}</dd></div>
        <div><dt>Recovered orders</dt><dd>{number(count(true))}</dd></div>
      </dl>
      <p>Comparing the selected schedule with {short(String(data.other))}. The table shows the largest changes in planned start time.</p>
      <Table columns={columns} rows={rows(featured)} />
      {moved.length > featured.length && <details><summary>All {moved.length} changed operations</summary><Table columns={columns} rows={rows(moved)} /></details>}
      {comparison.error && <Message>Additional schedule details are unavailable.</Message>}
    </section>
  );
}

export function Evidence({
  answer,
  schedule: s,
}: {
  answer: Explanation;
  schedule: Schedule;
}) {
  const data = object(answer.result);
  const timeline = Array.isArray(data.timeline) ? data.timeline : [];
  const risk = Array.isArray(data.orders) ? data.orders : [];
  const utilization = Array.isArray(answer.result) ? answer.result : [];
  const stage = object(data.chosen ?? null);
  const eligible = Array.isArray(data.eligible_estimates)
    ? data.eligible_estimates
    : [];
  const date = (v: Json | undefined) =>
    time(s, typeof v === "number" ? v : null);
  return (
    <div className="evidence">
      <div className="context-strip">
        <Badge
          tone={
            answer.classification === "simulation_estimate" ? "blue" : "neutral"
          }
        >
          {answer.classification.replaceAll("_", " ")}
        </Badge>
        <span>Schedule {short(String(answer.evidence.schedule))}</span>
        {answer.evidence.solver_status && <span>Solver {String(answer.evidence.solver_status)}</span>}
        {data.simulation && (
          <span>Simulation {short(String(data.simulation))}</span>
        )}
      </div>
      {data.reason && <p>{String(data.reason)}</p>}
      {timeline.length > 0 && (
        <>
          <p>
            <strong>{String(object(data.order).id)}</strong> · Scheduled
            completion {date(data.completion)} · {String(data.tardiness)} late
            minutes · {String(data.material)}
          </p>
          <Table
            columns={[
              "Stage",
              "Machine",
              "Planned start",
              "Wait after ready",
              "Previous machine order",
            ]}
            rows={timeline.map((value) => {
              const row = object(value),
                op = object(row.operation);
              return [
                Number(op.stage) + 1,
                String(op.machine),
                date(op.start),
                `${String(row.wait_after_release_or_predecessor)} min`,
                String(object(row.preceding_machine_operation).order ?? "—"),
              ];
            })}
          />
        </>
      )}
      {risk.length > 0 && (
        <Table
          columns={["Order", "Estimated late", "P95 completion"]}
          rows={risk.slice(0, 10).map((value) => {
            const row = object(value);
            return [
              String(row.order),
              percent(Number(row.p_late), 1),
              date(row.p95_completion),
            ];
          })}
        />
      )}
      {utilization.length > 0 && (
        <Table
          columns={[
            "Machine",
            "Busy minutes",
            "Available minutes",
            "Utilization",
          ]}
          rows={utilization.map((value) => {
            const row = object(value);
            return [
              String(row.machine),
              Number(row.busy),
              Number(row.available),
              percent(Number(row.utilization), 1),
            ];
          })}
        />
      )}
      {eligible.length > 0 && (
        <>
          <p>
            Assigned machine {String(stage.machine ?? "unavailable")}.{" "}
            {String(data.interpretation)}
          </p>
          <Table
            columns={[
              "Eligible machine",
              "Expected minutes",
              "Scheduled minutes",
            ]}
            rows={eligible.map((value) => {
              const row = object(value);
              return [
                String(row.machine),
                number(Number(row.expected), 1),
                Number(row.minutes),
              ];
            })}
          />
        </>
      )}
      {Array.isArray(data.moved) && <CopilotComparison data={data} source={s} />}
      {!Array.isArray(data.moved) && !timeline.length &&
        !risk.length &&
        !utilization.length &&
        !eligible.length &&
        !data.reason && <Message>No structured details are available for this answer. Open Technical evidence to inspect the recorded result.</Message>}
      <details>
        <summary>Evidence references</summary>
        <dl className="details">
          {Object.entries(answer.evidence).filter(([, value]) => typeof value !== "object" || value == null).map(([key, value]) => (
            <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{String(value ?? "Unavailable")}</dd></div>
          ))}
        </dl>
      </details>
      <details><summary>Technical evidence</summary><pre>{JSON.stringify(answer, null, 2)}</pre></details>
    </div>
  );
}

export function Copilot() {
  const { schedule: s, catalog, order: focused } = useConsole();
  const [order, setOrder] = useState("");
  const [stage, setStage] = useState(0);
  const [other, setOther] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<
    { id: string; prompt: string; answer: Explanation; schedule: Schedule }[]
  >([]);
  if (!s) return null;
  const orderId = s.factory.orders.some((o) => o.id === order)
    ? order
    : s.factory.orders.some((o) => o.id === focused)
      ? focused
      : (s.factory.orders[0]?.id ?? "");
  const compare =
    other ||
    s.parent ||
    catalog?.schedules.find((x) => x.id !== s.id)?.id ||
    "";
  const ask = async (prompt: string, extra: Partial<CopilotInput> = {}) => {
    if (busy || !prompt.trim()) return;
    setBusy(true);
    setError("");
    try {
      const answer = await request<Explanation>("/copilot/query", {
        body: { schedule: s.id, question: prompt, ...extra },
      });
      setMessages((items) => [
        ...items,
        { id: crypto.randomUUID(), prompt, answer, schedule: s },
      ]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageTitle
        title="Planning Copilot"
        subtitle="Retrieve and explain evidence for the selected schedule."
      />
      <div className="overview-grid copilot-grid">
        <Panel
          title="Investigation"
          subtitle={`Schedule ${short(s.id)} · deterministic tools available`}
          action={<MessagesSquare size={19} />}
        >
          <div className="conversation">
            {!messages.length && (
              <Message>
                {publicDemo ? "Choose a structured question to read a saved explanation." : "Choose an evidence question or enter a supported planning request."}
              </Message>
            )}
            {messages.map((m) => (
              <div key={m.id}>
                <div className="prompt">{m.prompt}</div>
                <Evidence answer={m.answer} schedule={m.schedule} />
              </div>
            ))}
            {busy && (
              <Message kind="loading">Retrieving operational evidence</Message>
            )}
            {error && <Message kind="error">{error}</Message>}
          </div>
          {!publicDemo && <form
            className="compose"
            onSubmit={(e) => {
              e.preventDefault();
              const text = input;
              setInput("");
              void ask(text);
            }}
          >
            <input
              aria-label="Ask a planning question"
              value={input}
              maxLength={1000}
              placeholder="Why is Order 105 late?"
              onChange={(e) => setInput(e.target.value)}
            />
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !input.trim()}
              aria-label="Send question"
            >
              <Send size={17} />
            </Button>
          </form>}
        </Panel>
        <Panel
          className="tour-target"
          title="Evidence context"
          subtitle="Structured options work without an LLM"
        >
          <div className="form-stack panel-copy">
            <Field label="Order">
              <Select
                value={orderId}
                onChange={(e) => {
                  setOrder(e.target.value);
                  setStage(0);
                }}
              >
                {s.factory.orders.map((o) => (
                  <option key={o.id}>{o.id}</option>
                ))}
              </Select>
            </Field>
            <Field label="Operation stage">
              <Select value={stage} onChange={(e) => setStage(+e.target.value)}>
                {s.plan.operations
                  .filter((o) => o.order === orderId)
                  .sort((a, b) => a.stage - b.stage)
                  .map((o) => (
                    <option value={o.stage} key={o.stage}>
                      Stage {o.stage + 1} · {o.machine}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Comparison schedule">
              <Select
                value={compare}
                onChange={(e) => setOther(e.target.value)}
              >
                {catalog?.schedules
                  .filter((x) => x.id !== s.id)
                  .map((x) => (
                    <option value={x.id} key={x.id}>
                      {x.state} · {short(x.id)}
                    </option>
                  ))}
              </Select>
            </Field>
            <Button
              disabled={busy || !orderId}
              onClick={() =>
                void ask(`Why is ${orderId} late?`, {
                  tool: "explain_order_delay",
                  order: orderId,
                })
              }
            >
              Explain order timing
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void ask("Which machines are bottlenecks?", {
                  tool: "get_bottlenecks",
                })
              }
            >
              Inspect machine utilization
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void ask("Which orders have the highest delivery risk?", {
                  tool: "get_simulation_risk",
                })
              }
            >
              Find highest delivery risk
            </Button>
            <Button
              disabled={busy || !compare}
              onClick={() =>
                void ask("What changed between these schedules?", {
                  tool: "compare_schedules",
                  other_schedule: compare,
                })
              }
            >
              Compare schedule versions
            </Button>
            <Button
              disabled={busy || !orderId}
              onClick={() =>
                void ask("Why was this operation assigned to this machine?", {
                  tool: "explain_assignment",
                  order: orderId,
                  stage,
                })
              }
            >
              Inspect machine assignment
            </Button>
          </div>
        </Panel>
      </div>
    </>
  );
}
