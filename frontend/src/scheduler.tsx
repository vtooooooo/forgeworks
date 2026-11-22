import { publicDemo, snapshotExport } from "./public-demo";
import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Check,
  Download,
  GitCompareArrows,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import {
  base,
  request,
  segment,
  useTask,
  type Operation,
  type OptimizeInput,
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
  Modal,
  number,
  PageTitle,
  Panel,
  percent,
  Select,
  short,
  Status,
  time,
} from "./ui";

type Filters = {
  department: string;
  machine: string;
  order: string;
  priority: string;
};
export const openingFilters: Filters = {
  department: "",
  machine: "",
  order: "",
  priority: "",
};
export function filterOperations(schedule: Schedule, filters: Filters) {
  const orders = new Map(schedule.factory.orders.map((o) => [o.id, o]));
  const machines = new Map(schedule.factory.machines.map((m) => [m.id, m]));
  return schedule.plan.operations.filter(
    (op) =>
      (!filters.order ||
        op.order.toLowerCase().includes(filters.order.trim().toLowerCase())) &&
      (!filters.priority ||
        Number(filters.priority) === orders.get(op.order)?.priority) &&
      (!filters.department ||
        machines.get(op.machine)?.department === filters.department) &&
      (!filters.machine || op.machine === filters.machine),
  );
}
export function spanStyle(start: number, end: number, horizon: number) {
  const left = Math.max(0, start),
    right = Math.min(horizon, end);
  return {
    left: `${(100 * left) / horizon}%`,
    width: `${(100 * Math.max(0, right - left)) / horizon}%`,
  };
}
const palette = [
  "#2667d2",
  "#6486c9",
  "#268c91",
  "#4a72bf",
  "#8b61c4",
  "#4c8d77",
  "#407cac",
];
const orderColor = (id: string) =>
  palette[[...id].reduce((v, c) => v + c.charCodeAt(0), 0) % palette.length];
export function Timeline({
  schedule: s,
  filters,
  zoom,
  select,
  selected,
}: {
  schedule: Schedule;
  filters: Filters;
  zoom: number;
  select: (op: Operation) => void;
  selected?: Operation;
}) {
  const operations = useMemo(() => filterOperations(s, filters), [s, filters]);
  const groups = useMemo(
    () => Map.groupBy(operations, (op) => op.machine),
    [operations],
  );
  const [viewport, setViewport] = useState({ left: 0, width: 1100 });
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const resize = () =>
      setViewport({ left: element.scrollLeft, width: element.clientWidth });
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => observer.disconnect();
  }, [s.id, operations.length]);
  const horizon = Math.max(
    480,
    Math.ceil(Math.max(...Object.values(s.plan.completion), 0) / 240) * 240,
  );
  const chartWidth = Math.max(860, Math.min(18000, horizon * 0.51 * zoom));
  const ticksEvery = Math.max(60, Math.ceil((80 * horizon) / chartWidth / 60) * 60);
  const ticks = Array.from(
    { length: Math.floor(horizon / ticksEvery) + 1 },
    (_, i) => i * ticksEvery,
  );
  const machines = s.factory.machines.filter(
    (m) =>
      (!filters.department || filters.department === m.department) &&
      (!filters.machine || filters.machine === m.id),
  );
  const scope =
    filters.order || filters.priority
      ? machines.filter((m) => groups.has(m.id))
      : machines;
  const departments = [...new Set(scope.map((m) => m.department))];
  const activeOrder = selected?.order;
  const visible = (op: Operation) => {
    const p = (chartWidth * op.start) / horizon;
    return (
      p >= viewport.left - 900 && p <= viewport.left + viewport.width + 500
    );
  };
  if (!scope.length)
    return <Message>No machines or operations match these filters.</Message>;
  return (
    <div
      className="gantt-scroll"
      ref={scroller}
      tabIndex={0}
      aria-label="Scrollable machine schedule"
      onScroll={(e) =>
        setViewport({
          left: e.currentTarget.scrollLeft,
          width: e.currentTarget.clientWidth,
        })
      }
    >
      <div
        className="gantt"
        style={{
          minWidth: chartWidth + 158,
          gridTemplateColumns: `158px minmax(${chartWidth}px,1fr)`,
        }}
      >
        <div className="gantt-heading machine-cell">
          Machine <small>Utilization</small>
        </div>
        <div className="gantt-heading ticks">
          {ticks.map((t) => (
            <div
              key={t}
              className={t % 1440 === 0 ? "day-tick" : undefined}
              style={{ left: `${(100 * t) / horizon}%` }}
            >
              <strong>
                {t % 1440 === 0 ? time(s, t, "day") : time(s, t, "clock")}
              </strong>
              {t % 1440 === 0 && <small>{time(s, t, "clock")}</small>}
            </div>
          ))}
        </div>
        {departments.flatMap((dept) => {
          const lane = scope.filter((m) => m.department === dept);
          return [
            <div className="dept-cell machine-cell" key={dept}>
              <span className="dept-dot" />
              {dept}
            </div>,
            <div className="dept-track" key={dept + "track"}>
              {lane.length} machines
            </div>,
            ...lane.flatMap((m) => {
              const load = s.load.find((x) => x.machine === m.id);
              return [
                <div className="machine-cell lane-label" key={m.id}>
                  <strong>{m.id}</strong>
                  <span>
                    {percent(
                      load?.available ? load.busy / load.available : null,
                    )}
                  </span>
                </div>,
                <div className="track" key={m.id + "track"}>
                  {m.shifts
                    .filter((w) => w.start < horizon)
                    .map((w, i) => (
                      <i
                        key={"shift" + i}
                        className="shift-block"
                        style={spanStyle(w.start, w.end, horizon)}
                        title="Working shift"
                      />
                    ))}
                  {ticks.map((t) => (
                    <i
                      className="tick-line"
                      key={t}
                      style={{ left: `${(t / horizon) * 100}%` }}
                    />
                  ))}
                  {m.maintenance
                    .filter((w) => w.start < horizon)
                    .map((w, i) => (
                      <i
                        key={"maint" + i}
                        className="maintenance-block"
                        style={spanStyle(w.start, w.end, horizon)}
                        title={`Maintenance ${time(s, w.start)} – ${time(s, w.end)}`}
                      />
                    ))}
                  {(s.factory.outages[m.id] ?? [])
                    .filter((w) => w.start < horizon)
                    .map((w, i) => (
                      <i
                        key={"outage" + i}
                        className="outage-block"
                        style={spanStyle(w.start, w.end, horizon)}
                        title={`Modeled outage ${time(s, w.start)} – ${time(s, w.end)}`}
                      />
                    ))}
                  {(groups.get(m.id) ?? []).filter(visible).map((op) => {
                    const chosen =
                      op.order === activeOrder && selected?.stage === op.stage;
                    const predecessor =
                      op.order === activeOrder &&
                      (selected?.stage ?? 0) - 1 === op.stage;
                    return (
                      <div key={op.order + "-" + op.stage}>
                        {op.setup_start < op.start && (
                          <i
                            className="setup-block"
                            style={spanStyle(op.setup_start, op.start, horizon)}
                            title="Set-up interval"
                          />
                        )}
                        <button
                          type="button"
                          className={`operation ${chosen ? "selected" : ""} ${predecessor ? "predecessor" : ""}`}
                          style={{
                            ...spanStyle(op.start, op.end, horizon),
                            background: orderColor(op.order),
                          }}
                          title={`${op.order} · ${m.id} · ${time(s, op.start)} – ${time(s, op.end)}`}
                          aria-label={`${op.order} stage ${op.stage + 1} on ${m.id}`}
                          aria-pressed={chosen}
                          onClick={() => select(op)}
                        >
                          {(chartWidth * (op.end - op.start)) / horizon >= 36
                            ? op.order.replace("ORD-", "#")
                            : ""}
                        </button>
                      </div>
                    );
                  })}
                </div>,
              ];
            }),
          ];
        })}
      </div>
    </div>
  );
}

export function Scheduler() {
  const { schedule: s, catalog, select, order, focusOrder } = useConsole();
  const qc = useQueryClient();
  const job = useTask("scheduler");
  const [filters, setFilters] = useState(openingFilters);
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<Operation>();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [config, setConfig] = useState(false);
  const [method, setMethod] = useState<OptimizeInput["method"]>("CP-SAT");
  const [scope, setScope] = useState<OptimizeInput["assignment_scope"]>("full");
  const [seconds, setSeconds] = useState(5);
  const [validation, setValidation] = useState<{
    valid: boolean;
    violations: unknown[];
  }>();
  const [validateBusy, setValidateBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setFilters({ ...openingFilters, order });
    setSelected(undefined);
    setDetailsOpen(false);
    setValidation(undefined);
    setError("");
  }, [s?.id, order]);
  useEffect(() => {
    if (job.job?.state === "SUCCEEDED")
      void qc.invalidateQueries({ queryKey: ["catalog"] });
  }, [job.job?.id, job.job?.state, qc]);
  if (!s) return null;
  const departments = [...new Set(s.factory.machines.map((m) => m.department))];
  const opOrder = s.factory.orders.find((o) => o.id === selected?.order);
  const opProduct = s.factory.products.find((p) => p.id === opOrder?.product);
  const machine = s.factory.machines.find((m) => m.id === selected?.machine);
  const predecessor = s.plan.operations.find(
    (op) =>
      op.order === selected?.order && op.stage === (selected?.stage ?? 0) - 1,
  );
  async function validate(id: string) {
    setValidateBusy(true);
    setError("");
    try {
      setValidation(
        await request(`/schedules/${segment(id)}/validate`, { body: {} }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setValidateBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        title="Production Scheduler"
        subtitle="Inspect machine assignments, shift windows, and order dependencies."
      >
        <a
          className="button secondary"
          download={publicDemo ? `forgeworks-${short(s.id)}.zip` : undefined}
          href={publicDemo ? snapshotExport(s.id) : `${base}/schedules/${segment(s.id)}/export?format=zip`}
        >
          <Download size={16} /> Export
        </a>
        <Button
          variant="primary"
          disabled={!catalog?.can_plan || job.busy}
          onClick={() => setConfig(true)}
        >
          <Plus size={18} /> Generate schedule
        </Button>
      </PageTitle>
      <div className="context-strip">
        <span>
          <CalendarDays size={16} /> {time(s, 0, "day")} · {s.timezone}
        </span>
        <span>Version {short(s.id)}</span>
        <Status value={s.state} />
        <Badge tone={isValid(s) ? "green" : "amber"}>
          {isValid(s)
            ? "Constraints validated"
            : "Validation unavailable or failed"}
        </Badge>
        <Badge>
          {s.plan.assignment_scope === "dispatch"
            ? "Fixed assignments"
            : s.plan.method}
        </Badge>
      </div>
      <div className="metric-grid solver-grid">
        <Metric
          title="Solver status"
          value={<Status value={s.plan.status} />}
          detail={
            s.plan.detail || `${s.plan.operations.length} scheduled operations`
          }
          icon={<Settings2 size={18} />}
        />
        <Metric
          title="Objective"
          value={number(s.plan.objective)}
          detail={`Best bound ${number(s.plan.bound, 2)}`}
          icon={<CalendarDays size={18} />}
        />
        <Metric
          title="Optimality gap"
          value={percent(s.plan.gap, 2)}
          detail={
            s.plan.assignment_scope === "dispatch"
              ? "Fixed-assignment bound"
              : "Unrestricted assignment scope"
          }
          tone="amber"
          icon={<GitCompareArrows size={18} />}
        />
        <Metric
          title="Runtime"
          value={`${number(s.plan.seconds, 2)} s`}
          detail={
            s.plan.profile
              ? `Search ${number(s.plan.profile.search_seconds, 2)} s`
              : "Solver and construction"
          }
          tone="teal"
          icon={<ShieldCheck size={18} />}
        />
      </div>
      {s.plan.status === "FEASIBLE" && isValid(s) && (
        <details className="evidence-note solver-note">
          <summary>The solver found a feasible schedule that passed independent constraint validation. Optimality has not been established.</summary>
          <p>The optimality gap compares this schedule’s objective with the solver’s best bound. A weak bound can leave a large gap even when the schedule satisfies the constraints.</p>
        </details>
      )}
      {job.job?.result?.schedule && job.job.result.schedule !== s.id && (
        <Message>
          Review the persisted optimization result{" "}
          <Button onClick={() => select(job.job!.result!.schedule!)}>
            Open solver record
          </Button>
        </Message>
      )}
      <JobStatus {...job} />
      <Panel
        className="tour-target"
        title="Machine timeline"
        subtitle="Scroll to explore the horizon. Select an operation for setup, timing, and dependencies."
        action={
          <div className="actions compact">
            <Button onClick={() => void validate(s.id)} disabled={validateBusy}>
              <ShieldCheck size={16} />{" "}
              {validateBusy ? "Validating…" : "Validate"}
            </Button>
            <Link className="button secondary" to="/twin">
              <Play size={15} /> Simulation
            </Link>
            <Link className="button secondary" to="/scenarios">
              <GitCompareArrows size={16} /> Compare
            </Link>
          </div>
        }
      >
        <div className="gantt-tools">
          <label className="search">
            <Search size={16} />
            <input
              aria-label="Search order"
              value={filters.order}
              placeholder="Search order ID"
              onChange={(e) =>
                setFilters({ ...filters, order: e.target.value })
              }
            />
          </label>
          <Select
            aria-label="Department filter"
            value={filters.department}
            onChange={(e) =>
              setFilters({
                ...filters,
                department: e.target.value,
                machine: "",
              })
            }
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </Select>
          <Select
            aria-label="Machine filter"
            value={filters.machine}
            onChange={(e) =>
              setFilters({ ...filters, machine: e.target.value })
            }
          >
            <option value="">All machines</option>
            {s.factory.machines
              .filter(
                (m) =>
                  !filters.department || m.department === filters.department,
              )
              .map((m) => (
                <option key={m.id}>{m.id}</option>
              ))}
          </Select>
          <Select
            aria-label="Priority filter"
            value={filters.priority}
            onChange={(e) =>
              setFilters({ ...filters, priority: e.target.value })
            }
          >
            <option value="">All priorities</option>
            {[...new Set(s.factory.orders.map((o) => o.priority))]
              .sort((a, b) => b - a)
              .map((p) => (
                <option key={p} value={p}>
                  Priority {p}
                </option>
              ))}
          </Select>
          <div className="zoom">
            <Button
              aria-label="Zoom out"
              disabled={zoom <= 0.55}
              onClick={() => setZoom(Math.max(0.55, zoom / 1.35))}
            >
              <ZoomOut size={16} />
            </Button>
            <Button aria-label="Reset zoom" title="Reset zoom to 100%" onClick={() => setZoom(1)}>{percent(zoom)}</Button>
            <Button
              aria-label="Zoom in"
              disabled={zoom >= 4}
              onClick={() => setZoom(Math.min(4, zoom * 1.35))}
            >
              <ZoomIn size={16} />
            </Button>
          </div>
        </div>
        {error && <Message kind="error">{error}</Message>}
        {validation && (
          <Message kind={validation.valid ? "success" : "error"}>
            {validation.valid
              ? publicDemo ? "Saved independent validation passed" : "Independent validation passed"
              : `${validation.violations.length} validation issue(s)`}
            {!validation.valid && (
              <pre>{JSON.stringify(validation.violations, null, 2)}</pre>
            )}
          </Message>
        )}
        {isValid(s) ? (
          <Timeline
            schedule={s}
            filters={filters}
            zoom={zoom}
            select={(op) => {
              setSelected(op);
              setDetailsOpen(true);
            }}
            selected={selected}
          />
        ) : (
          <Message>
            {s.plan.status} · This version has no independently validated
            timeline.
          </Message>
        )}
        <div className="timeline-legend" aria-label="Timeline legend">
          <span>
            <i className="key-operation" /> Operation · colors distinguish orders
          </span>
          <span>
            <i className="key-setup" /> Setup
          </span>
          <span>
            <i className="key-shift" /> Shift availability
          </span>
          <span>
            <i className="key-maint" /> Maintenance
          </span>
          <span>
            <i className="key-outage" /> Modeled outage
          </span>
          <span>
            <i className="key-prev" /> Selected predecessor
          </span>
        </div>
      </Panel>
      {selected && (
        <Modal
          drawer
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
          title={`${selected.order} · ${opProduct?.route[selected.stage] ?? `Stage ${selected.stage + 1}`}`}
          description="Persisted operation details"
        >
          <dl className="details">
            <div>
              <dt>Product</dt>
              <dd>{opOrder?.product}</dd>
            </div>
            <div>
              <dt>Department / machine</dt>
              <dd>
                {machine?.department} / {selected.machine}
              </dd>
            </div>
            <div>
              <dt>Start / end</dt>
              <dd>
                {time(s, selected.start)} – {time(s, selected.end)}
              </dd>
            </div>
            <div>
              <dt>Production time</dt>
              <dd>{selected.end - selected.start} minutes</dd>
            </div>
            <div>
              <dt>Setup</dt>
              <dd>
                {selected.start - selected.setup_start} minutes ·{" "}
                {time(s, selected.setup_start)}
              </dd>
            </div>
            <div>
              <dt>Due / priority</dt>
              <dd>
                {time(s, opOrder?.due)} · {opOrder?.priority}
              </dd>
            </div>
            <div>
              <dt>Predecessor</dt>
              <dd>
                {predecessor
                  ? `${predecessor.machine} finishes ${time(s, predecessor.end)}`
                  : "First routing operation"}
              </dd>
            </div>
            <div>
              <dt>Validation</dt>
              <dd>
                <Badge tone="green">
                  <Check size={14} /> Validated schedule
                </Badge>
              </dd>
            </div>
          </dl>
          <div className="panel-foot">
            <Link
              className="button secondary"
              onClick={() => focusOrder(selected.order)}
              to="/predictions"
            >
              View duration evidence
            </Link>
            <Link
              className="button secondary"
              onClick={() => focusOrder(selected.order)}
              to="/copilot"
            >
              Explain this order
            </Link>
          </div>
        </Modal>
      )}
      <Modal
        title="Generate schedule"
        description="Runs the existing optimizer against the selected schedule’s factory inputs."
        open={config}
        onOpenChange={setConfig}
      >
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            setConfig(false);
            void job.submit("/schedules/optimize", {
              dataset: s.dataset,
              model: s.model ?? "erp",
              method,
              seconds,
              assignment_scope: method === "CP-SAT" ? scope : "full",
            });
          }}
        >
          <Field label="Scheduling strategy">
            <Select
              value={method}
              onChange={(e) =>
                setMethod(e.target.value as OptimizeInput["method"])
              }
            >
              {["CP-SAT", "FCFS", "EDD", "SPT"].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </Field>
          {method === "CP-SAT" && (
            <Field label="Machine assignment scope">
              <Select
                value={scope}
                onChange={(e) =>
                  setScope(e.target.value as OptimizeInput["assignment_scope"])
                }
              >
                <option value="full">Unrestricted CP-SAT</option>
                <option value="dispatch">
                  Fixed assignments from validated EDD
                </option>
              </Select>
            </Field>
          )}
          <Field label="Solver time limit (seconds)">
            <input
              type="number"
              min=".1"
              max="45"
              step=".1"
              required
              value={seconds}
              onChange={(e) => setSeconds(+e.target.value)}
            />
          </Field>
          {method === "CP-SAT" && scope === "dispatch" && (
            <Message>Bounds apply to this fixed-assignment model only.</Message>
          )}
          <Button variant="primary" type="submit">
            Submit optimization
          </Button>
        </form>
      </Modal>
    </>
  );
}
