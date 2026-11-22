import { publicDemo } from "./public-demo";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Activity,
  Boxes,
  CalendarRange,
  ChartNoAxesCombined,
  CircleHelp,
  ClipboardCheck,
  Cpu,
  Factory,
  FlaskConical,
  LayoutDashboard,
  Menu,
  MessagesSquare,
  Radio,
  Server,
  X,
} from "lucide-react";
import { Component, lazy, Suspense, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  HashRouter,
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { ApiError, useCatalog, useSchedule } from "./api";
import { ConsoleContext } from "./context";
const Overview = lazy(() =>
  import("./overview").then((m) => ({ default: m.Overview })),
);
const Scheduler = lazy(() =>
  import("./scheduler").then((m) => ({ default: m.Scheduler })),
);
const Predictions = lazy(() =>
  import("./intelligence").then((m) => ({ default: m.Predictions })),
);
const Twin = lazy(() =>
  import("./intelligence").then((m) => ({ default: m.Twin })),
);
const Copilot = lazy(() =>
  import("./intelligence").then((m) => ({ default: m.Copilot })),
);
const Scenarios = lazy(() =>
  import("./planning").then((m) => ({ default: m.Scenarios })),
);
const Approvals = lazy(() =>
  import("./planning").then((m) => ({ default: m.Approvals })),
);
const System = lazy(() =>
  import("./planning").then((m) => ({ default: m.System })),
);
import { Badge, Button, Message, Select, short } from "./ui";
import "./styles.css";

const Router = publicDemo ? HashRouter : BrowserRouter;

const navigation = [
  { path: "/", label: "Overview", icon: LayoutDashboard },
  { path: "/scheduler", label: "Production Scheduler", icon: CalendarRange },
  { path: "/predictions", label: "AI Prediction Studio", icon: Cpu },
  { path: "/twin", label: "Digital Twin", icon: ChartNoAxesCombined },
  { path: "/copilot", label: "Planning Copilot", icon: MessagesSquare },
  { path: "/scenarios", label: "Scenario Lab", icon: FlaskConical },
  { path: "/approvals", label: "Schedule Approvals", icon: ClipboardCheck },
  { path: "/system", label: "System Information", icon: Server },
];
const stops = [
  ["/", "Review plant health and the active release."],
  [
    "/scheduler",
    "Select a scheduled operation to inspect its routing and setup.",
  ],
  [
    "/predictions",
    "Compare expected duration, ERP and historical group measurements.",
  ],
  [
    "/twin",
    "Inspect the persisted delivery risk and observed replication distributions.",
  ],
  ["/copilot", "Ask for the evidence behind a selected order or machine."],
  [
    "/scenarios",
    "Compare the verified breakdown replan with its source schedule.",
  ],
  [
    "/approvals",
    "Inspect which simulation and planner evidence supported the release.",
  ],
];
function App() {
  const catalog = useCatalog();
  const location = useLocation();
  const navigate = useNavigate();
  const [selected, setSelected] = useState(
    () =>
      new URLSearchParams(window.location.search).get("schedule") ??
      sessionStorage.getItem("forgeworks.schedule") ??
      "",
  );
  const [order, focusOrder] = useState("");
  const [menu, setMenu] = useState(false);
  const [tour, setTour] = useState<number | null>(null);
  const id =
    selected || catalog.data?.preferred || catalog.data?.schedules[0]?.id || "";
  const schedule = useSchedule(id);
  const select = (next: string) => {
    setSelected(next);
    sessionStorage.setItem("forgeworks.schedule", next);
    focusOrder("");
  };
  const startTour = (step: number) => {
    setTour(step);
    navigate(stops[step][0]);
    setMenu(false);
  };
  const current = navigation.find((item) => item.path === location.pathname);
  return (
    <ConsoleContext.Provider
      value={{
        catalog: catalog.data,
        schedule: schedule.data,
        id,
        select,
        order,
        focusOrder,
      }}
    >
      <a href="#main-content" className="skip" onClick={event=>{event.preventDefault();document.getElementById("main-content")?.focus();}}>
        Skip to workspace
      </a>
      <div className="shell">
        <aside className={`sidebar ${menu ? "expanded" : ""}`}>
          <Link to="/" className="brand" onClick={() => setMenu(false)}>
            <span className="brand-mark">
              <Factory size={21} />
            </span>
            <div>
              ForgeWorks <b>AI</b>
              <small>OPERATIONS COMMAND</small>
            </div>
          </Link>
          <div className="plant">
            <span className="plant-icon">
              <Boxes size={17} />
            </span>
            <div>
              <strong>Precision Works</strong>
              <small>Synthetic factory</small>
            </div>
          </div>
          <nav aria-label="Main navigation">
            <div className="nav-label">WORKSPACE</div>
            {navigation.slice(0, 4).map((item) => (
              <NavLink
                end
                key={item.path}
                to={item.path}
                onClick={() => setMenu(false)}
              >
                <item.icon size={17} />
                {item.label}
              </NavLink>
            ))}
            <div className="nav-label separate">PLANNING & GOVERNANCE</div>
            {navigation.slice(4).map((item) => (
              <NavLink
                end
                key={item.path}
                to={item.path}
                onClick={() => setMenu(false)}
              >
                <item.icon size={17} />
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-end">
            <button onClick={() => startTour(0)}>
              <CircleHelp size={17} /> Interview walkthrough
            </button>
            <div className="sidebar-foot">
              <span className="avatar">FW</span>
              <span>
                <strong>Planning workspace</strong>
                <small>
                  {catalog.data?.mode === "local"
                    ? "Local evaluation"
                    : "Read-only console"}
                </small>
              </span>
            </div>
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <div className="breadcrumb">
              <Button
                variant="ghost"
                className="mobile-menu"
                aria-label={menu ? "Close menu" : "Open menu"}
                onClick={() => setMenu(!menu)}
              >
                {menu ? <X size={20} /> : <Menu size={20} />}
              </Button>
              <span>Precision Works</span>
              <span className="slash">/</span>
              <strong>{current?.label ?? "Workspace"}</strong>
            </div>
            <div className="top-actions">
              <span className="health">
                <Radio size={15} />
                {catalog.isError
                  ? "API unavailable"
                  : catalog.isSuccess
                    ? publicDemo ? "Evidence loaded" : "API connected"
                    : "Connecting"}
              </span>
              {catalog.data?.demo && <Badge tone="blue">Demo mode</Badge>}
              {catalog.data?.schedules.length ? (
                <Select
                  aria-label="Schedule version"
                  value={id}
                  onChange={(e) => select(e.target.value)}
                >
                  {!catalog.data.schedules.some((s) => s.id === id) && (
                    <option value={id}>Schedule {short(id)}</option>
                  )}
                  {catalog.data.schedules.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.state.charAt(0) + s.state.slice(1).toLowerCase()} ·{" "}
                      {short(s.id)}
                    </option>
                  ))}
                </Select>
              ) : null}
            </div>
          </header>
          <main id="main-content" tabIndex={-1}>
            {publicDemo && <Message>Public read-only demo. Browse verified synthetic evidence. New schedules, simulations, scenario changes, and planner actions are disabled.</Message>}
            {tour !== null && (
              <section className="tour-banner" aria-label="Guided walkthrough">
                <Activity size={21} />
                <div>
                  <strong>
                    Interview walkthrough · {tour + 1} of {stops.length}
                  </strong>
                  <p>{stops[tour][1]}</p>
                </div>
                <Button disabled={!tour} onClick={() => startTour(tour - 1)}>
                  Back
                </Button>
                <Button
                  variant="primary"
                  onClick={() =>
                    tour + 1 === stops.length
                      ? setTour(null)
                      : startTour(tour + 1)
                  }
                >
                  {tour + 1 === stops.length ? "Finish" : "Next"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setTour(null)}
                  aria-label="Close walkthrough"
                >
                  <X size={18} />
                </Button>
              </section>
            )}
            {catalog.isPending && (
              <Message kind="loading">Loading the factory catalog</Message>
            )}
            {catalog.error && (
              <Message kind="error">
                {catalog.error.message}{" "}
                <Button onClick={() => void catalog.refetch()}>
                  Retry connection
                </Button>
              </Message>
            )}
            {catalog.data && id && schedule.isPending && (
              <Message kind="loading">Loading schedule {short(id)}</Message>
            )}
            {schedule.error && (
              <Message kind="error">
                {schedule.error instanceof ApiError &&
                schedule.error.status === 404
                  ? "This schedule version is unavailable."
                  : schedule.error.message}{" "}
                <Button onClick={() => select(catalog.data?.preferred ?? "")}>
                  Use active version
                </Button>
              </Message>
            )}
            {catalog.data && !id && location.pathname !== "/system" && (
              <Message>
                No schedules are available. See{" "}
                <Link to="/system">System Information</Link> for the deployment
                mode.
              </Message>
            )}
            {(schedule.data || location.pathname === "/system") && (
              <Suspense
                fallback={<Message kind="loading">Opening workspace</Message>}
              >
                <Routes>
                  <Route index element={<Overview />} />
                  <Route path="scheduler" element={<Scheduler />} />
                  <Route path="predictions" element={<Predictions />} />
                  <Route path="twin" element={<Twin />} />
                  <Route path="copilot" element={<Copilot />} />
                  <Route path="scenarios" element={<Scenarios />} />
                  <Route path="approvals" element={<Approvals />} />
                  <Route path="system" element={<System />} />
                  <Route
                    path="*"
                    element={
                      <Message>
                        Unknown workspace.{" "}
                        <Link to="/">Return to overview</Link>
                      </Message>
                    }
                  />
                </Routes>
              </Suspense>
            )}
          </main>
        </div>
      </div>
    </ConsoleContext.Provider>
  );
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <Message kind="error">
        The workspace could not render.{" "}
        <Button onClick={() => window.location.reload()}>
          Reload workspace
        </Button>
      </Message>
    ) : (
      this.props.children
    );
  }
}
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      retry: (count, error) =>
        count < 1 && (!(error instanceof ApiError) || error.status >= 500),
      refetchOnWindowFocus: false,
    },
  },
});
const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <Boundary>
      <QueryClientProvider client={queryClient}>
        <Router>
          <App />
        </Router>
      </QueryClientProvider>
    </Boundary>,
  );
