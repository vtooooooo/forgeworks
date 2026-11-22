import { publicDemo } from "./public-demo";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  CheckCircle2,
  ClipboardCheck,
  FlaskConical,
  GitBranch,
  Github,
  Play,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  request,
  segment,
  useRisk,
  useSchedule,
  useTask,
  type Evaluation,
  type ScenarioInput,
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
  Modal,
  number,
  PageTitle,
  Panel,
  percent,
  Select,
  short,
  Status,
  Table,
  time,
  weighted,
} from "./ui";

const scenarios = {
  breakdown: "Machine breakdown",
  maintenance_extension: "Maintenance extension",
  receipt_delay: "Material receipt delay",
  urgent_order: "Urgent order",
  overrun: "Production duration overrun",
  extend_shift: "Shift extension",
  due_date: "Due date change",
} as const;
type EventKind = keyof typeof scenarios;
type Change = ScenarioInput["change"];
type EventForm = {
  kind: EventKind;
  machine: string;
  order: string;
  product: string;
  receipt: string;
  start: number;
  duration: number;
  index: number;
  stage: number;
  due: number;
  quantity: number;
  newOrder: string;
};
export function scenarioChange(form: EventForm, s: Schedule): Change {
  const {
    kind,
    machine,
    order,
    product,
    receipt,
    start,
    duration,
    index,
    stage,
    due,
    quantity,
    newOrder,
  } = form;
  if (kind === "due_date") {
    if (!s.factory.orders.some((x) => x.id === order) || due < 0)
      throw Error("Select an order and a non-negative due minute.");
    return { kind, order, value: due };
  }
  if (kind === "receipt_delay") {
    if (!s.factory.receipts.some((x) => x.id === receipt) || duration <= 0)
      throw Error("Select a receipt and a positive delay.");
    return { kind, receipt, minutes: duration };
  }
  if (kind === "overrun") {
    if (
      !s.plan.operations.some((o) => o.order === order && o.stage === stage) ||
      duration <= 0
    )
      throw Error("Select a valid operation and a positive overrun.");
    return { kind, order, stage, minutes: duration };
  }
  if (kind === "urgent_order") {
    if (
      !newOrder.trim() ||
      s.factory.orders.some((o) => o.id === newOrder.trim()) ||
      !s.factory.products.some((p) => p.id === product) ||
      quantity < 1 ||
      due < start
    )
      throw Error(
        "An urgent order needs a unique ID, product, positive quantity, and due minute after release.",
      );
    return {
      kind,
      order: {
        id: newOrder.trim(),
        product,
        quantity,
        release: start,
        due,
        priority: 10,
        hard_due: false,
        customer: "urgent",
        status: "open",
      },
    };
  }
  const asset = s.factory.machines.find((m) => m.id === machine);
  if (!asset || !Number.isInteger(duration) || duration <= 0 || start < 0)
    throw Error("Select a machine and positive event duration.");
  const record =
    kind === "extend_shift"
      ? asset.shifts[index]
      : kind === "maintenance_extension"
        ? asset.maintenance[index]
        : undefined;
  if (kind !== "breakdown" && !record)
    throw Error("Select an existing shift or maintenance window.");
  if (kind === "extend_shift" && !asset.overtime)
    throw Error("This machine is not eligible for overtime.");
  const begin = record?.start ?? start,
    end = (record?.end ?? start) + duration;
  if (end > s.factory.horizon)
    throw Error("The event exceeds the planning horizon.");
  return { kind, machine, start: begin, end, index };
}

function scenarioDelta(before: number | undefined, after: number | undefined, fraction: boolean) {
  if (before == null || after == null) return null;
  const delta = (after - before) * (fraction ? 100 : 1);
  if (Math.abs(delta) < 0.005) return "stayed the same";
  return `${delta > 0 ? "increased" : "decreased"} by ${number(Math.abs(delta), 2)}${fraction ? " percentage points" : ""}`;
}

export function Comparison({
  baseline,
  alternative,
}: {
  baseline: string;
  alternative: string;
}) {
  const a = useSchedule(baseline),
    b = useSchedule(alternative);
  const before = a.data,
    after = b.data;
  const saved = after?.changes.find((c) => c.parent === before?.id);
  const pair = saved?.simulation as
    | {
        baseline?: string;
        alternative?: string;
        paired_delta?: Record<string, { mean: number; ci95?: number[] }>;
      }
    | undefined;
  const ra = useRisk(
    baseline,
    pair?.baseline,
    undefined,
    !!before?.simulations.length,
  );
  const rb = useRisk(
    alternative,
    pair?.alternative,
    undefined,
    !!after?.simulations.length,
  );
  if (!alternative || !baseline || alternative === baseline)
    return <Message>Select two different persisted schedules.</Message>;
  if (a.error || b.error)
    return (
      <Message kind="error">{a.error?.message || b.error?.message}</Message>
    );
  if (!before || !after)
    return <Message kind="loading">Loading comparison schedules</Message>;
  if (!isValid(before) || !isValid(after))
    return (
      <Message>
        Both versions need independently validated schedules. Alternative solver
        status is {after.plan.status}.
      </Message>
    );
  const load = (s: Schedule) => {
    const available = s.load.reduce((n, r) => n + r.available, 0);
    return available
      ? s.load.reduce((n, r) => n + r.busy, 0) / available
      : null;
  };
  const old = new Map(
    before.plan.operations.map((o) => [`${o.order}:${o.stage}`, o]),
  );
  const moved = after.plan.operations.flatMap((o) => {
    const previous = old.get(`${o.order}:${o.stage}`);
    return previous &&
      (o.start !== previous.start ||
        o.end !== previous.end ||
        o.machine !== previous.machine ||
        o.setup_start !== previous.setup_start)
      ? [{ ...o, previous }]
      : [];
  });
  const newlyLate = after.factory.orders.filter(
    (o) =>
      before.plan.tardiness[o.id] === 0 &&
      (after.plan.tardiness[o.id] ?? 0) > 0,
  );
  const recovered = before.factory.orders.filter(
    (o) =>
      (before.plan.tardiness[o.id] ?? 0) > 0 &&
      after.plan.tardiness[o.id] === 0,
  );
  const onTime = (s: Schedule) =>
    Object.values(s.plan.tardiness).filter((v) => v === 0).length;
  const stats: [
    string,
    number | null | undefined,
    number | null | undefined,
    boolean,
  ][] = [
    ["Nominal weighted tardiness", weighted(before), weighted(after), false],
    ["Nominal on-time orders", onTime(before), onTime(after), false],
    [
      "Nominal makespan (min)",
      Math.max(0, ...Object.values(before.plan.completion)),
      Math.max(0, ...Object.values(after.plan.completion)),
      false,
    ],
    ["Machine utilization", load(before), load(after), true],
    [
      "Simulated on-time delivery",
      ra.data?.summary.on_time?.mean,
      rb.data?.summary.on_time?.mean,
      true,
    ],
    [
      "Simulated mean weighted tardiness",
      ra.data?.summary.weighted_tardiness?.mean,
      rb.data?.summary.weighted_tardiness?.mean,
      false,
    ],
    [
      "Modeled machine cost",
      ra.data?.summary.cost?.mean,
      rb.data?.summary.cost?.mean,
      false,
    ],
    [
      "Modeled late setup starts",
      ra.data?.summary.disrupted_fraction?.mean,
      rb.data?.summary.disrupted_fraction?.mean,
      true,
    ],
  ];
  const onTimeDelta = scenarioDelta(ra.data?.summary.on_time?.mean, rb.data?.summary.on_time?.mean, true);
  const tardinessDelta = scenarioDelta(ra.data?.summary.weighted_tardiness?.mean, rb.data?.summary.weighted_tardiness?.mean, false);
  return (
    <>
      <div className="context-strip">
        <span>Source {short(before.id)}</span>
        <Status value={before.state} />
        <span>Alternative {short(after.id)}</span>
        <Status value={after.state} />
        {!!saved?.change && (
          <Badge tone="blue">
            {String((saved.change as { kind?: string }).kind).replaceAll(
              "_",
              " ",
            )}
          </Badge>
        )}
      </div>
      <section className="decision-summary">
        <h3>Decision summary</h3>
        <p>Both schedules passed independent validation. {saved ? `${number(after.frozen)} operations were protected in the recorded change.` : ""}</p>
        <p>{onTimeDelta && tardinessDelta
          ? `In the stored runs, estimated on-time delivery ${onTimeDelta} and mean weighted tardiness ${tardinessDelta}.`
          : "A simulation comparison requires stored runs for both schedules."}</p>
      </section>
      <Table
        columns={["Metric", "Source", "Alternative", "Difference"]}
        rows={stats.map(([label, original, revised, fraction]) => {
          const delta = original == null || revised == null ? null : revised - original;
          const direction = label === "Machine utilization" ? 0
            : label === "Nominal on-time orders" || label === "Simulated on-time delivery" ? 1 : -1;
          const displayedDelta = delta == null ? null : Math.round((fraction ? delta * 100 : delta) * 100) / 100;
          const signal = displayedDelta == null ? "Unavailable" : displayedDelta === 0 ? "Unchanged"
            : direction === 0 ? "Changed" : direction * displayedDelta > 0 ? "Improved" : "Regressed";
          return [
            label,
            fraction ? percent(original, 1) : number(original, 2),
            fraction ? percent(revised, 1) : number(revised, 2),
            <span className="delta-value">
              {displayedDelta != null && <span>{displayedDelta > 0 ? "+" : ""}{number(displayedDelta, 2)}{fraction ? " pp" : ""}</span>}
              <Badge tone={signal === "Improved" ? "green" : signal === "Regressed" ? "amber" : "neutral"}>{signal}</Badge>
            </span>,
          ];
        })}
      />
      {ra.data?.summary.on_time && rb.data?.summary.on_time && (
        <div
          className="comparison-bars"
          role="group"
          aria-label="Modeled on-time comparison"
        >
          {[
            ["Source", ra.data.summary.on_time.mean],
            ["Alternative", rb.data.summary.on_time.mean],
          ].map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <progress max={1} value={Number(value)} />
              <strong>{percent(Number(value), 1)}</strong>
            </div>
          ))}
        </div>
      )}
      <div className="panel-foot">
        Simulation runs {short(ra.data?.id)} and {short(rb.data?.id)} ·{" "}
        {pair?.paired_delta
          ? "Paired simulation evidence available"
          : "Stored runs displayed descriptively"}
      </div>
      {pair?.paired_delta && (
        <Table
          columns={["Paired outcome", "Alternative − source", "95% interval"]}
          rows={Object.entries(pair.paired_delta).map(([k, v]) => [
            k.replaceAll("_", " "),
            k === "on_time" ? percent(v.mean, 2) : number(v.mean, 2),
            v.ci95
              ?.map((n) => (k === "on_time" ? percent(n, 2) : number(n, 2)))
              .join(" to ") ?? "Unavailable",
          ])}
        />
      )}
      <div className="context-strip">
        <span>{moved.length} moved operations</span>
        <span>
          {moved.filter((o) => o.machine !== o.previous.machine).length} machine
          reassignments
        </span>
        <span>{after.frozen} protected operations</span>
        <span>{newlyLate.length} newly late</span>
        <span>{recovered.length} recovered</span>
      </div>
      <details className="panel-copy">
        <summary>Changed operations and completions</summary>
        <Table
          columns={[
            "Order / stage",
            "Old machine",
            "New machine",
            "Start change",
            "Order completion change",
          ]}
          rows={moved.map((o) => [
            `${o.order} · ${o.stage + 1}`,
            o.previous.machine,
            o.machine,
            `${o.start - o.previous.start} min`,
            `${(after.plan.completion[o.order] ?? 0) - (before.plan.completion[o.order] ?? 0)} min`,
          ])}
        />
        <p>
          Newly late: {newlyLate.map((o) => o.id).join(", ") || "None"}.
          Recovered: {recovered.map((o) => o.id).join(", ") || "None"}.
        </p>
      </details>
    </>
  );
}

export function Scenarios() {
  const { schedule: s, catalog } = useConsole();
  const qc = useQueryClient();
  const job = useTask("scenarios");
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [compare, setCompare] = useState("");
  const [error, setError] = useState("");
  const [sim, setSim] = useState(true);
  const [replications, setReplications] = useState(30);
  const [protect, setProtect] = useState(false);
  const defaultSource = s?.parent ?? s?.id ?? "";
  const baseline = source || job.job?.result?.parent || defaultSource;
  const sourceRecord = useSchedule(baseline);
  const f = sourceRecord.data;
  const [form, setForm] = useState<EventForm>({
    kind: "breakdown",
    machine: "",
    order: "",
    product: "",
    receipt: "",
    start: 0,
    duration: 120,
    index: 0,
    stage: 0,
    due: 600,
    quantity: 12,
    newOrder: "ORD-EXPEDITE",
  });
  useEffect(() => {
    if (job.job?.state === "SUCCEEDED" && job.job.result?.schedule) {
      setCompare(job.job.result.schedule);
      if (job.job.result.parent) setSource(job.job.result.parent);
      void qc.invalidateQueries({ queryKey: ["catalog"] });
    }
  }, [
    job.job?.id,
    job.job?.state,
    job.job?.result?.schedule,
    job.job?.result?.parent,
    qc,
  ]);
  if (!s) return null;
  const target =
    compare ||
    (baseline !== s.id
      ? s.id
      : catalog?.schedules.find((x) => x.parent === baseline)?.id || "");
  const machine = form.machine || f?.factory.machines[0]?.id || "";
  const order = form.order || f?.factory.orders[0]?.id || "";
  const receipt = form.receipt || f?.factory.receipts[0]?.id || "";
  const product = form.product || f?.factory.products[0]?.id || "";
  const asset = f?.factory.machines.find((m) => m.id === machine);
  const eventOptions =
    form.kind === "extend_shift" ? asset?.shifts : asset?.maintenance;
  const events =
    form.kind === "breakdown" ||
    form.kind === "maintenance_extension" ||
    form.kind === "extend_shift";
  const canProtect = !!f && f.state === "RELEASED" && form.kind === "breakdown";
  const patch = (updates: Partial<EventForm>) =>
    setForm((value) => ({ ...value, ...updates }));
  return (
    <>
      <PageTitle
        title="Scenario Lab"
        subtitle="Evaluate isolated alternatives and inspect operational tradeoffs."
      />
      {!publicDemo && <Panel
        title="Create a what-if scenario"
        subtitle="The source plan remains unchanged. Time inputs are minutes from the factory epoch."
        action={<FlaskConical size={20} />}
      >
        <form
          className="form-stack panel-copy"
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            if (!f || job.busy) return;
            try {
              const change = scenarioChange(
                { ...form, machine, order, receipt, product },
                f,
              );
              const configuration = sim
                ? { runs: replications, seed: 42, uncertain: true }
                : null;
              if (protect && canProtect)
                void job.submit(`/schedules/${segment(f.id)}/reschedule`, {
                  at: form.start,
                  name: name.trim() || null,
                  change,
                  config: configuration,
                  seconds: 5,
                });
              else
                void job.submit("/scenarios/what-if", {
                  schedule: f.id,
                  name: name.trim() || null,
                  change,
                  config: configuration,
                  seconds: 5,
                });
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <div className="form-grid">
            <Field label="Scenario name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Example: CNC outage recovery"
                maxLength={80}
              />
            </Field>
            <Field label="Source schedule">
              <Select
                value={baseline}
                onChange={(e) => {
                  setSource(e.target.value);
                  setCompare("");
                  setProtect(false);
                  patch({ machine: "", order: "", product: "", receipt: "" });
                }}
              >
                {catalog?.schedules.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.state} · {short(x.id)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Disruption type">
              <Select
                value={form.kind}
                onChange={(e) => {
                  patch({ kind: e.target.value as EventKind, index: 0 });
                  setProtect(false);
                }}
              >
                {Object.entries(scenarios).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            {events && (
              <Field label="Affected machine">
                <Select
                  value={machine}
                  onChange={(e) => patch({ machine: e.target.value, index: 0 })}
                >
                  {f?.factory.machines.map((m) => (
                    <option key={m.id}>{m.id}</option>
                  ))}
                </Select>
              </Field>
            )}
            {(form.kind === "extend_shift" ||
              form.kind === "maintenance_extension") && (
              <Field label="Existing window">
                <Select
                  value={form.index}
                  onChange={(e) => patch({ index: +e.target.value })}
                >
                  {eventOptions?.map((w, i) => (
                    <option key={i} value={i}>
                      {time(f!, w.start)} – {time(f!, w.end)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {(form.kind === "overrun" || form.kind === "due_date") && (
              <Field label="Affected order">
                <Select
                  value={order}
                  onChange={(e) => patch({ order: e.target.value, stage: 0 })}
                >
                  {f?.factory.orders.map((o) => (
                    <option key={o.id}>{o.id}</option>
                  ))}
                </Select>
              </Field>
            )}
            {form.kind === "overrun" && (
              <Field label="Operation stage">
                <Select
                  value={form.stage}
                  onChange={(e) => patch({ stage: +e.target.value })}
                >
                  {f?.plan.operations
                    .filter((o) => o.order === order)
                    .map((o) => (
                      <option key={o.stage} value={o.stage}>
                        {o.stage + 1} · {o.machine}
                      </option>
                    ))}
                </Select>
              </Field>
            )}
            {form.kind === "receipt_delay" && (
              <Field label="Material receipt">
                <Select
                  value={receipt}
                  onChange={(e) => patch({ receipt: e.target.value })}
                >
                  {f?.factory.receipts.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.id} · {r.material}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {(form.kind === "breakdown" || form.kind === "urgent_order") && (
              <Field label="Event start minute">
                <input
                  type="number"
                  required
                  min="0"
                  max={f?.factory.horizon}
                  value={form.start}
                  onChange={(e) => patch({ start: +e.target.value })}
                />
              </Field>
            )}
            {form.kind !== "urgent_order" && form.kind !== "due_date" && (
              <Field label="Duration or delay (minutes)">
                <input
                  type="number"
                  required
                  min="1"
                  value={form.duration}
                  onChange={(e) => patch({ duration: +e.target.value })}
                />
              </Field>
            )}
            {form.kind === "urgent_order" && (
              <>
                <Field label="New order ID">
                  <input
                    value={form.newOrder}
                    required
                    onChange={(e) => patch({ newOrder: e.target.value })}
                  />
                </Field>
                <Field label="Product">
                  <Select
                    value={product}
                    onChange={(e) => patch({ product: e.target.value })}
                  >
                    {f?.factory.products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.id} · {p.family}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Quantity">
                  <input
                    type="number"
                    required
                    min="1"
                    max="5000"
                    value={form.quantity}
                    onChange={(e) => patch({ quantity: +e.target.value })}
                  />
                </Field>
              </>
            )}
            {(form.kind === "urgent_order" || form.kind === "due_date") && (
              <Field label="Due minute">
                <input
                  type="number"
                  required
                  min="0"
                  value={form.due}
                  onChange={(e) => patch({ due: +e.target.value })}
                />
              </Field>
            )}
            {sim && (
              <Field label="Replications per version">
                <input
                  type="number"
                  required
                  min="1"
                  max="500"
                  value={replications}
                  onChange={(e) => setReplications(+e.target.value)}
                />
              </Field>
            )}
          </div>
          <div className="actions">
            <label className="check">
              <input
                type="checkbox"
                checked={sim}
                onChange={(e) => setSim(e.target.checked)}
              />{" "}
              Run paired simulation
            </label>
            {canProtect && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={protect}
                  onChange={(e) => setProtect(e.target.checked)}
                />{" "}
                Replan released schedule and protect started work
              </label>
            )}
            <Button
              type="submit"
              variant="primary"
              disabled={!catalog?.can_plan || !f || !isValid(f) || job.busy}
            >
              <Play size={15} /> Run scenario
            </Button>
          </div>
          {error && <Message kind="error">{error}</Message>}
          <JobStatus {...job} />
        </form>
      </Panel>}
      <Panel
        className="tour-target"
        title="Compare schedules"
        subtitle="Choose a persisted alternative, including the verified breakdown replan."
        action={
          <div className="comparison-selects">
          {publicDemo && <Field label="Source schedule"><Select
            value={baseline}
            onChange={(event) => { setSource(event.target.value); setCompare(""); }}
          >
            {catalog?.schedules.map((item) => <option key={item.id} value={item.id}>{item.state} · {short(item.id)}</option>)}
          </Select></Field>}
          <Select
            aria-label="Alternative schedule"
            value={target}
            onChange={(e) => setCompare(e.target.value)}
          >
            <option value="">Choose a version</option>
            {catalog?.schedules
              .filter((x) => x.id !== baseline)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.state} · {short(x.id)}
                </option>
              ))}
          </Select>
          </div>
        }
      >
        <Comparison baseline={baseline} alternative={target} />
      </Panel>
      {publicDemo && <Panel title="Live what-if planning">
        <p className="panel-copy">The public demo compares saved schedule versions. Create and evaluate new disruptions in the controlled local workspace.</p>
      </Panel>}
    </>
  );
}

type Decision = "approve" | "release" | "reject";
export function Approvals() {
  const { schedule: s, catalog, select } = useConsole();
  const qc = useQueryClient();
  const [action, setAction] = useState<Decision>();
  const [identity, setIdentity] = useState("");
  const [simulation, setSimulation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [compare, setCompare] = useState(false);
  useEffect(() => {
    setAction(undefined);
    setSimulation("");
    setResult("");
    setError("");
    setCompare(false);
  }, [s?.id]);
  if (!s) return null;
  const canApprove =
    catalog?.can_approve &&
    isValid(s) &&
    ["VALIDATED", "SIMULATED"].includes(s.state);
  const canRelease =
    catalog?.can_approve &&
    s.state === "APPROVED" &&
    isValid(s) &&
    s.plan.operations.length > 0;
  const canReject =
    catalog?.can_approve &&
    ["DRAFT", "VALIDATED", "SIMULATED", "APPROVED"].includes(s.state);
  const qualifying = s.simulations.filter((x) => {
    const c = x.config as { runs: number; uncertain: boolean };
    return !s.high_risk || (c.runs >= 10 && c.uncertain);
  });
  const chosen = qualifying.some((x) => x.id === simulation)
    ? simulation
    : String(qualifying[0]?.id ?? "");
  const decide = async () => {
    if (!action || busy) return;
    setBusy(true);
    setError("");
    setResult("");
    try {
      const response = await request<{ state: string }>(
        `/console/schedules/${segment(s.id)}/${action}`,
        {
          body: {
            identity: identity.trim(),
            simulation_id: action === "approve" && chosen ? chosen : null,
          },
        },
      );
      setAction(undefined);
      setResult(
        `Server recorded ${response.state.toLowerCase()} for ${short(s.id)}.`,
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["catalog"] }),
        qc.invalidateQueries({ queryKey: ["schedule"] }),
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
        title="Schedule Approvals"
        subtitle="Review validation, simulation, and release evidence before making a planning decision."
      />
      <div className="overview-grid">
        <Panel
          title="Selected schedule"
          subtitle={s.id}
          action={<Status value={s.state} />}
        >
          <dl className="details">
            <div>
              <dt>Solver</dt>
              <dd>
                <Status value={s.plan.status} />
              </dd>
            </div>
            <div>
              <dt>Independent validation</dt>
              <dd>
                {isValid(s) ? "Passed" : `${s.validation.length} issue(s)`}
              </dd>
            </div>
            <div>
              <dt>Simulation evidence</dt>
              <dd>{s.simulations.length} stored run(s)</dd>
            </div>
            <div>
              <dt>Approval requirement</dt>
              <dd>
                {s.high_risk
                  ? "Uncertain run · at least 10 replications"
                  : "Standard review"}
              </dd>
            </div>
          </dl>
          {!publicDemo && <div className="panel-foot">
            <Button disabled={!canApprove} onClick={() => setAction("approve")}>
              <ClipboardCheck size={16} /> Approve
            </Button>
            <Button
              variant="primary"
              disabled={!canRelease}
              onClick={() => setAction("release")}
            >
              <ShieldCheck size={16} /> Release
            </Button>
            <Button
              variant="danger"
              disabled={!canReject}
              onClick={() => setAction("reject")}
            >
              Reject
            </Button>
          </div>}
          {publicDemo ? <p className="panel-copy">This snapshot records historical decisions. Approval, rejection, and release require planner authorization in the controlled local workspace.</p> : !catalog?.can_approve && (
            <Message>
              Planner actions require explicitly enabled local server
              authorization.
            </Message>
          )}
          {result && <Message kind="success">{result}</Message>}
          {s.validation.length > 0 && (
            <details className="panel-copy">
              <summary>Constraint evidence</summary>
              <pre>{JSON.stringify(s.validation, null, 2)}</pre>
            </details>
          )}
        </Panel>
        <Panel
          className="tour-target"
          title="Decision history"
          subtitle="Persisted planner identity and evidence reference"
        >
          <Table
            columns={["Action", "Planner", "Timestamp", "Simulation"]}
            rows={s.approvals.map((a) => [
              String(a.action),
              String(a.identity),
              new Date(String(a.at)).toLocaleString("en-US", {
                timeZone: s.timezone,
              }),
              a.simulation ? short(String(a.simulation)) : "—",
            ])}
          />
        </Panel>
      </div>
      <Panel
        title="Schedule history"
        subtitle="Select a version to review its evidence"
      >
        <Table
          columns={["Schedule", "State", "Solver", "Operations", "Validation"]}
          rows={(catalog?.schedules ?? []).map((a) => [
            <button className="link-button" onClick={() => select(a.id)}>
              {short(a.id)}
            </button>,
            <Status value={a.state} />,
            <Status value={a.solver} />,
            a.operation_count,
            a.valid ? "Passed" : "Failed or unavailable",
          ])}
        />
      </Panel>
      {s.parent && (
        <Panel
          title="Source comparison"
          subtitle="Inspect the parent schedule before releasing an alternative"
          action={
            <Button onClick={() => setCompare(!compare)}>
              {compare ? "Hide comparison" : "Show comparison"}
            </Button>
          }
        >
          {compare && <Comparison baseline={s.parent} alternative={s.id} />}
        </Panel>
      )}
      <Modal
        title={`Confirm ${action ?? "decision"}`}
        description={
          action === "release"
            ? "Release can supersede the active plan. Review the selected version and its evidence before continuing."
            : "This decision is recorded with your planner identity."
        }
        open={!!action}
        onOpenChange={(v) => {
          if (!v && !busy) {
            setAction(undefined);
            setError("");
          }
        }}
      >
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void decide();
          }}
        >
          <Field label="Planner identity">
            <input
              value={identity}
              maxLength={120}
              required
              onChange={(e) => setIdentity(e.target.value)}
            />
          </Field>
          {action === "approve" && (
            <Field label="Simulation evidence">
              <Select
                value={chosen}
                onChange={(e) => setSimulation(e.target.value)}
              >
                <option value="">No qualifying evidence selected</option>
                {qualifying.map((r) => (
                  <option key={String(r.id)} value={String(r.id)}>
                    {short(String(r.id))}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {error && <Message kind="error">{error}</Message>}
          <Button
            variant={action === "reject" ? "danger" : "primary"}
            type="submit"
            disabled={
              busy ||
              !identity.trim() ||
              (action === "approve" && s.high_risk && !chosen)
            }
          >
            Confirm {action}
          </Button>
        </form>
      </Modal>
    </>
  );
}

export function System() {
  const { catalog, schedule } = useConsole();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => request<{ status: string }>("/health", { signal }),
  });
  const models = useQuery({
    queryKey: ["models"],
    queryFn: ({ signal }) => request<Evaluation[]>("/models", { signal }),
  });
  const bench = useQuery({
    queryKey: ["benchmark", catalog?.latest_benchmark],
    enabled: !!catalog?.latest_benchmark,
    queryFn: ({ signal }) =>
      request<{
        scenario: string;
        orders: number;
        runs?: number;
        seconds: number;
      }>(`/benchmarks/${segment(catalog!.latest_benchmark!)}`, { signal }),
  });
  const github = "https://github.com/vtooooooo/forgeworks";
  return (
    <>
      <PageTitle
        title="System Information"
        subtitle={publicDemo ? "Evidence source, model versions, and benchmark records for this public snapshot." : "Runtime health, model versions, and verified performance evidence."}
      />
      <div className="overview-grid">
        <Panel title="Runtime" action={<Activity size={18} />}>
          <dl className="details">
            <div>
              <dt>{publicDemo ? "Evidence producer version" : "Backend version"}</dt>
              <dd>{catalog?.version ?? "Unavailable"}</dd>
            </div>
            <div>
              <dt>{publicDemo ? "Data source" : "Database"}</dt>
              <dd>{publicDemo ? "Immutable synthetic evidence" : catalog?.database ?? "Unavailable"}</dd>
            </div>
            <div>
              <dt>{publicDemo ? "Evidence index" : "Health check"}</dt>
              <dd>
                {health.data?.status === "ok" ? (
                  <Badge tone="green">
                    <CheckCircle2 size={14} /> {publicDemo ? "Available" : "Healthy"}
                  </Badge>
                ) : (
                  (health.error?.message ?? "Checking")
                )}
              </dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>{catalog?.mode ?? "Unavailable"}</dd>
            </div>
            <div>
              <dt>Planner authority</dt>
              <dd>
                {catalog?.can_approve
                  ? "Trusted local authorization"
                  : "Read-only planner controls"}
              </dd>
            </div>
            <div>
              <dt>Active model</dt>
              <dd>{short(catalog?.active_model)}</dd>
            </div>
          </dl>
        </Panel>
        <Panel
          title="Latest persisted benchmark"
          action={<GitBranch size={18} />}
        >
          {bench.data ? (
            <dl className="details">
              <div>
                <dt>Scenario</dt>
                <dd>{bench.data.scenario}</dd>
              </div>
              <div>
                <dt>Orders</dt>
                <dd>{bench.data.orders}</dd>
              </div>
              <div>
                <dt>Runtime</dt>
                <dd>{number(bench.data.seconds, 2)} seconds</dd>
              </div>
              <div>
                <dt>Run ID</dt>
                <dd>{short(catalog?.latest_benchmark)}</dd>
              </div>
            </dl>
          ) : (
            <Message>
              {bench.error?.message ?? "Benchmark evidence unavailable."}
            </Message>
          )}
        </Panel>
      </div>
      <Panel title="Registered duration models">
        <Table
          columns={[
            "Version",
            "Selected model",
            "Training time",
            "ERP MAE",
            "Selected MAE",
          ]}
          rows={(models.data ?? []).map((m) => [
            short(m.id),
            m.selected,
            m.trained_at,
            number(m.models.erp?.test.mae, 2),
            number(m.models[m.selected]?.test.mae, 2),
          ])}
        />
      </Panel>
      <div className="overview-grid">
        <Panel title="Scheduling capabilities">
          <div className="panel-copy">
            <p>
              CP-SAT supports unrestricted assignments and assignments fixed
              from an independently validated EDD dispatch. FCFS, EDD, and
              shortest-processing-time are available baselines.
            </p>
          </div>
        </Panel>
        <Panel title="Simulation configuration">
          {schedule?.simulations[0] ? (
            <>
              <dl className="details">{Object.entries(schedule.simulations[0].config as Record<string, unknown>)
                .filter(([, value]) => typeof value !== "object" || value === null)
                .map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{typeof value === "boolean" ? (value ? "Yes" : "No") : String(value ?? "Unavailable")}</dd></div>)}</dl>
              <details className="panel-copy"><summary>Technical configuration</summary><pre>{JSON.stringify(schedule.simulations[0].config, null, 2)}</pre></details>
            </>
          ) : <Message>Simulation configuration unavailable for this selection.</Message>}
        </Panel>
        <Panel title="Known limitations">
          <p className="panel-copy">Large unrestricted machine circuits can reach the construction guard. The synthetic twin uses projected shop-floor conditions and requires real factory calibration.</p>
        </Panel>
        <Panel title="Documentation">
          <div className="link-list">
            <a href={github} target="_blank" rel="noreferrer">
              <Github size={16} /> GitHub repository
            </a>
            {[
              ["Technical API", "docs/api-reference.md"],
              ["System architecture", "docs/system-architecture.md"],
              ["Benchmark report", "reports/final-delivery.md"],
              ["Adversarial audit", "reports/final-adversarial-validation.md"],
            ].map(([title, path]) => (
              <a
                key={path}
                href={`${github}/blob/main/${path}`}
                target="_blank"
                rel="noreferrer"
              >
                {title}
              </a>
            ))}
            <Link to="/">Return to factory overview</Link>
          </div>
        </Panel>
      </div>
    </>
  );
}
