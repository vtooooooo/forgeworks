import {
  Activity,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Factory,
  Flag,
  LayoutList,
} from "lucide-react";
import { Link, useNavigate } from "react-router";
import { useRisk, type Schedule } from "./api";
import { useConsole } from "./context";
import {
  Badge,
  Button,
  isValid,
  Message,
  Metric,
  number,
  PageTitle,
  Panel,
  percent,
  short,
  Status,
  Table,
  time,
} from "./ui";

export function LoadBars({ schedule }: { schedule: Schedule }) {
  return (
    <div className="load-bars">
      {schedule.load.map((m) => {
        const ratio = m.available ? m.busy / m.available : null;
        return (
          <div className="load-row" key={m.machine}>
            <span>{m.machine}</span>
            <div>
              <i style={{ width: percent(Math.min(1, ratio ?? 0), 1) }} />
            </div>
            <strong>{percent(ratio)}</strong>
          </div>
        );
      })}
    </div>
  );
}
export function Overview() {
  const { schedule: s, catalog, focusOrder, select } = useConsole();
  const risk = useRisk(
    s?.id ?? "",
    undefined,
    undefined,
    !!s?.simulations.length,
  );
  const navigate = useNavigate();
  if (!s) return null;
  const orderRisk = new Map(risk.data?.risk.map((r) => [r.order, r.p_late]));
  const orders = s.factory.orders;
  const scheduled = Object.keys(s.plan.completion).length;
  const late = orders.filter((o) => (s.plan.tardiness[o.id] ?? 0) > 0).length;
  const watch = risk.data
    ? orders.filter(
        (o) =>
          s.plan.tardiness[o.id] === 0 && (orderRisk.get(o.id) ?? 0) >= 0.1,
      ).length
    : 0;
  const onTime = scheduled - late - watch;
  const departments = [...new Set(s.load.map((m) => m.department))];
  const totalLoad = s.load.reduce((n, r) => n + r.busy, 0);
  const totalAvailable = s.load.reduce((n, r) => n + r.available, 0);
  const critical = [...orders]
    .sort(
      (a, b) =>
        (s.plan.tardiness[b.id] ?? 0) - (s.plan.tardiness[a.id] ?? 0) ||
        (orderRisk.get(b.id) ?? -1) - (orderRisk.get(a.id) ?? -1) ||
        b.priority - a.priority,
    )
    .slice(0, 6);
  const activity = [
    ...s.approvals.map((a) => ({
      id: s.id,
      date: String(a.at),
      text: `Schedule ${String(a.action)} by ${String(a.identity)}`,
      link: "/approvals",
      icon: ClipboardList,
    })),
    ...s.simulations.map((a) => ({
      id: s.id,
      date: String(a.created_at),
      text: `Simulation ${short(String(a.id))} persisted`,
      link: "/twin",
      icon: Activity,
    })),
    ...(catalog?.schedules ?? []).map((a) => ({
      id: a.id,
      date: a.created_at,
      text: a.parent
        ? `Alternative ${short(a.id)} created`
        : `Schedule ${short(a.id)} optimized`,
      link: a.parent ? "/scenarios" : "/scheduler",
      icon: CalendarDays,
    })),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);
  return (
    <>
      <PageTitle
        title="Manufacturing Overview"
        subtitle="Production health, capacity, and delivery priorities for the selected plan."
      >
        <Button onClick={() => navigate("/scheduler")} variant="primary">
          <CalendarDays size={17} /> Open scheduler
        </Button>
      </PageTitle>
      <div className="context-strip">
        <span>
          <Factory size={16} /> Precision Works · {s.factory.name}
        </span>
        <span>
          <CalendarDays size={16} /> {time(s, 0, "day")} –{" "}
          {time(s, Math.max(...Object.values(s.plan.completion), 0), "day")}
        </span>
        <span>
          <span className="dot" /> Schedule {short(s.id)}
        </span>
        <Status value={s.state} />
        {catalog?.schedules.find((row) => row.id === s.id)?.precomputed && (
          <Badge>Precomputed evidence</Badge>
        )}
        {s.changes.length > 0 && (
          <Link to="/scenarios">View scenario change</Link>
        )}
      </div>
      <div className="metric-grid">
        <Metric
          title="Production orders"
          value={number(orders.length)}
          detail={`${scheduled} scheduled · ${orders.filter((o) => o.status === "open").length} open`}
          icon={<ClipboardList size={20} />}
        />
        <Metric
          title="Scheduled late"
          value={isValid(s) ? number(late) : "—"}
          detail="Against committed due dates"
          tone="red"
          icon={<Clock3 size={20} />}
        />
        <Metric
          title="Delivery watch"
          value={risk.data ? number(watch) : "—"}
          detail={<Link to="/twin?risk=watch" className="text-link">View orders with ≥10% modeled risk</Link>}
          tone="amber"
          icon={<Flag size={20} />}
        />
        <Metric
          title="Machine utilization"
          value={percent(totalAvailable ? totalLoad / totalAvailable : null, 1)}
          detail="Scheduled work and setup / available time"
          tone="teal"
          icon={<Activity size={20} />}
        />
      </div>
      <div className="overview-grid">
        <Panel
          className="tour-target"
          title="Order delivery overview"
          subtitle="Nominal due dates and modeled delivery watch"
          action={
            <Link to="/twin" className="text-link">
              Risk analysis
            </Link>
          }
        >
          <div className="delivery-wrap">
            <div
              className="donut"
              role="img"
              aria-label={`${onTime} on time, ${watch} on watch, ${late} scheduled late`}
              style={{
                background: scheduled
                  ? `conic-gradient(#3073dd 0 ${(100 * onTime) / scheduled}%,#f6b94a 0 ${(100 * (onTime + watch)) / scheduled}%,#df6a64 0 100%)`
                  : undefined,
              }}
            >
              <div>
                <strong>{scheduled}</strong>
                <span>scheduled</span>
              </div>
            </div>
            <div className="delivery-legend">
              {[
                ["On time", "#3073dd", onTime],
                ["Delivery watch", "#f6b94a", risk.data ? watch : "—"],
                ["Scheduled late", "#df6a64", late],
              ].map(([label, color, count]) => (
                <div key={label}>
                  <i style={{ background: String(color) }} />
                  <span>{label}</span>
                  <strong>{count}</strong>
                </div>
              ))}
            </div>
          </div>
          <div className="panel-foot">
            <CheckCircle2 size={16} />{" "}
            {risk.data
              ? `${percent(risk.data.summary.on_time?.mean, 1)} estimated on-time delivery · ${String(risk.data.config.runs)} replications`
              : "No simulation evidence for this version"}
          </div>
        </Panel>
        <Panel
          title="Department workload"
          subtitle="Planned production and setup minutes"
          action={<LayoutList size={18} className="muted" />}
        >
          <div className="departments">
            {departments.map((d, i) => {
              const group = s.load.filter((r) => r.department === d),
                busy = group.reduce((n, r) => n + r.busy, 0),
                available = group.reduce((n, r) => n + r.available, 0);
              return (
                <div className="department" key={d}>
                  <div>
                    <span>{d}</span>
                    <strong>{number(busy)} min</strong>
                  </div>
                  <progress
                    max={available || 1}
                    value={busy}
                    className={`progress-${i}`}
                  />
                  <small>
                    {group.length} machines ·{" "}
                    {percent(available ? busy / available : null)} of available
                    time
                  </small>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>
      <div className="overview-grid wide-left">
        <Panel
          title="Critical orders"
          subtitle="Sorted by scheduled delay, estimated risk, then priority"
          action={
            <Link to="/scheduler" className="text-link">
              View timeline
            </Link>
          }
        >
          <Table
            columns={[
              "Order",
              "Product",
              "Due",
              "Completion",
              "Late min",
              "Risk",
              "Priority",
            ]}
            rows={critical.map((o) => [
              <button
                className="link-button"
                onClick={() => {
                  focusOrder(o.id);
                  navigate("/scheduler");
                }}
              >
                {o.id}
              </button>,
              o.product,
              time(s, o.due),
              time(s, s.plan.completion[o.id]),
              number(s.plan.tardiness[o.id]),
              percent(orderRisk.get(o.id)),
              o.priority,
            ])}
          />
        </Panel>
        <Panel
          title="Recent planning activity"
          subtitle="Persisted schedule, approval, and simulation events"
        >
          <div className="activity">
            {activity.map((a, i) => (
              <button
                key={i}
                onClick={() => {
                  select(a.id);
                  navigate(a.link);
                }}
              >
                <span>
                  <a.icon size={16} />
                </span>
                <div>
                  <strong>{a.text}</strong>
                  <small>
                    {new Date(a.date).toLocaleString("en-US", {
                      timeZone: s.timezone,
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </small>
                </div>
              </button>
            ))}
          </div>
        </Panel>
      </div>
      <Panel
        title="Machine utilization"
        subtitle="Minutes from factory epoch to makespan, excluding nonworking and maintenance intervals"
      >
        <LoadBars schedule={s} />
      </Panel>
      <Message>
        <AlertTriangle size={15} /> Completed real orders and live disruption
        status are unavailable in the synthetic factory. Planned outages appear
        on the timeline.
      </Message>
    </>
  );
}
