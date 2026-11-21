import * as Dialog from "@radix-ui/react-dialog";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock3,
  LoaderCircle,
  X,
} from "lucide-react";
import {
  type ButtonHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Schedule, Job } from "./api";

export const cn = (...values: Parameters<typeof clsx>) => twMerge(clsx(values));
export const number = (v: number | null | undefined, digits = 0) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(
        v,
      );
export const percent = (v: number | null | undefined, digits = 0) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "percent",
        maximumFractionDigits: digits,
      }).format(v);
export const short = (id?: string | null) => id?.slice(0, 8) ?? "—";
export const time = (
  s: Pick<Schedule, "epoch" | "timezone">,
  minute?: number | null,
  mode: "full" | "clock" | "day" = "full",
) => {
  if (minute == null) return "—";
  const date = new Date(Date.parse(s.epoch) + minute * 60000);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: s.timezone,
    ...(mode === "clock"
      ? { hour: "numeric", minute: "2-digit" }
      : mode === "day"
        ? { weekday: "short", month: "short", day: "numeric" }
        : {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          }),
  }).format(date);
};
export const isValid = (s: Schedule) =>
  ["FEASIBLE", "OPTIMAL"].includes(s.plan.status) && s.validation.length === 0;
export const weighted = (s: Schedule) =>
  s.factory.orders.reduce(
    (sum, o) => sum + (s.plan.tardiness[o.id] ?? 0) * o.priority,
    0,
  );
export const solverLabel = (status: string) =>
  status
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^./, (s) => s.toUpperCase());
export const riskLevel = (risk?: number) =>
  risk == null
    ? "Unavailable"
    : risk >= 0.5
      ? "High risk"
      : risk >= 0.1
        ? "Watch"
        : "Low risk";
const buttonStyles = cva("button", {
  variants: {
    variant: { primary: "primary", secondary: "secondary", ghost: "ghost", danger: "danger" },
  },
  defaultVariants: { variant: "secondary" },
});

export function Button({
  className,
  variant,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonStyles>) {
  return <button type={type} className={cn(buttonStyles({ variant }), className)} {...props} />;
}
export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="select-wrap">
      <select className={className} {...props} />
      <ChevronDown size={15} aria-hidden />
    </div>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "green" | "red" | "blue" | "amber" | "neutral";
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Status({ value }: { value: string }) {
  const green = [
    "RELEASED",
    "APPROVED",
    "VALIDATED",
    "FEASIBLE",
    "OPTIMAL",
    "SUCCEEDED",
  ];
  const tone = green.includes(value)
    ? "green"
    : ["REJECTED", "INFEASIBLE", "FAILED", "MODEL_INVALID"].includes(value)
      ? "red"
      : value === "UNKNOWN"
        ? "amber"
        : ["RUNNING", "SIMULATED", "QUEUED"].includes(value)
          ? "blue"
          : "neutral";
  return <Badge tone={tone}>{solverLabel(value)}</Badge>;
}
export function Panel({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("panel", className)}>
      <header className="panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
export function PageTitle({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="actions">{children}</div>
    </div>
  );
}
export function Metric({
  title,
  value,
  detail,
  icon,
  tone = "blue",
}: {
  title: string;
  value: ReactNode;
  detail: ReactNode;
  icon: ReactNode;
  tone?: string;
}) {
  return (
    <article className="metric">
      <div className={`metric-icon ${tone}`}>{icon}</div>
      <p>{title}</p>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}
export function Message({
  children,
  kind = "empty",
}: {
  children: ReactNode;
  kind?: "empty" | "error" | "loading" | "success";
}) {
  const Icon =
    kind === "error"
      ? AlertCircle
      : kind === "loading"
        ? LoaderCircle
        : kind === "success"
          ? CheckCircle2
          : Activity;
  return (
    <div
      className={`message ${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      <Icon size={18} className={kind === "loading" ? "spin" : ""} />
      <div>{children}</div>
    </div>
  );
}
export function JobStatus({
  job,
  error,
  busy,
  resume,
}: {
  job?: Job;
  error: string;
  busy: boolean;
  resume?: () => void;
}) {
  if (error)
    return (
      <Message kind="error">
        {error}
        {resume && <Button onClick={resume}>Retry same submission</Button>}
      </Message>
    );
  if (busy)
    return (
      <Message kind="loading">
        {job?.state === "QUEUED"
          ? "Queued behind another job"
          : "Waiting for the backend job"}
        {job && <small> Job {short(job.id)}</small>}
      </Message>
    );
  if (job?.result) {
    const solver = job.result.solver_status ?? job.result.status;
    const valid = !solver || ["FEASIBLE", "OPTIMAL"].includes(solver);
    return (
      <Message kind={valid ? "success" : "empty"}>
        {valid ? "Job finished" : "Job finished without a validated schedule"}{" "}
        {solver && <Status value={solver} />} <small>{short(job.id)}</small>
      </Message>
    );
  }
  return resume ? <Button onClick={resume}>Resume submission</Button> : null;
}
export function Modal({
  title,
  description,
  children,
  open,
  onOpenChange,
  drawer = false,
}: {
  title: string;
  description: string;
  children: ReactNode;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  drawer?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className={drawer ? "modal drawer" : "modal"}>
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
          <Dialog.Close className="close" aria-label="Close dialog">
            <X size={18} />
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Table({
  columns,
  rows,
}: {
  columns: string[];
  rows: ReactNode[][];
}) {
  if (!rows.length) return <Message>No records match this selection.</Message>;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Clock({ children }: { children: ReactNode }) {
  return (
    <span className="inline">
      <Clock3 size={15} />
      {children}
    </span>
  );
}
