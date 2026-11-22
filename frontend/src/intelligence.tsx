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
import { useEffect, useMemo, useState } from "react";
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
          detail="Minutes · final chronological partition"
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
          detail="Empirical coverage · nominal 90%"
          tone="teal"
          icon={<Shield size={20} />}
        />
        <Metric
          title="RMSE"
          value={number(model?.rmse, 2)}
          detail={`${number(model?.n)} final-partition observations`}
          tone="amber"
          icon={<Timer size={20} />}
        />
      </div>
      <Panel
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
            aria-label="Duration comparison chart in minutes"
          >
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={chartRows}
                margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
              >
                <CartesianGrid vertical={false} stroke="#e6edf5" />
                <XAxis dataKey="operation" />
                <YAxis width={45} />
                <Tooltip />
                <Legend />
                <Bar
                  dataKey="erp"
                  name="ERP standard"
                  fill="#a5b5ca"
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
                  fill="#36a49a"
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
              : `${number(p.lower, 1)}–${number(p.upper, 1)} min`,
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
          <Table
            columns={["Feature", "Persisted planning value"]}
            rows={Object.entries(chartRows[0]?.features ?? {}).map(([k, v]) => [
              k,
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
              Synthetic test-set performance requires field calibration before
              real manufacturing use.
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
              <Distribution rows={values.completion} color="#3073dd" />
            </Panel>
            <Panel
              title="Weighted tardiness distribution"
              subtitle="Replication count by weighted-minute bin"
            >
              <Distribution rows={values.tardiness} color="#609e9d" />
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
          <Panel
            title="Delivery reliability by order"
            subtitle="Wilson intervals and estimated lateness"
          >
            <Table
              columns={[
                "Order",
                "Estimated late",
                "95% interval",
                "Signal",
                "P50 completion",
                "P95 completion",
                "Completed runs",
              ]}
              rows={ranked.map((r) => [
                r.order,
                percent(r.p_late, 1),
                r.ci95.map((p) => percent(p, 1)).join(" to "),
                <Badge
                  tone={
                    r.p_late >= 0.5
                      ? "red"
                      : r.p_late >= 0.1
                        ? "amber"
                        : "green"
                  }
                >
                  {riskLevel(r.p_late)}
                </Badge>,
                time(s, r.p50_completion),
                time(s, r.p95_completion),
                r.completed_runs,
              ])}
            />
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
}: {
  rows: { start: number; count: number }[];
  color: string;
}) {
  if (!rows.length)
    return (
      <Message>
        No completion observations were recorded for this selection.
      </Message>
    );
  return (
    <>
      <div className="chart-frame">
        <ResponsiveContainer width="100%" height={215}>
          <BarChart data={rows}>
            <CartesianGrid vertical={false} stroke="#e6edf5" />
            <XAxis dataKey="start" />
            <YAxis allowDecimals={false} />
            <Tooltip />
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
        <span>{String(answer.evidence.solver_status ?? "")}</span>
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
      {!timeline.length &&
        !risk.length &&
        !utilization.length &&
        !eligible.length &&
        !data.reason && <pre>{JSON.stringify(answer.result, null, 2)}</pre>}
      <details>
        <summary>Evidence references</summary>
        <pre>{JSON.stringify(answer.evidence, null, 2)}</pre>
      </details>
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
