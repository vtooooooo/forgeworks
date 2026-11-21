"""Console read projections and authorization cannot bypass the planning state machine."""

import importlib.util
from pathlib import Path

from fastapi.testclient import TestClient

from forgeworks import database as db
from forgeworks.api import create_app
from forgeworks.service import Service
from forgeworks.simulation import SimulationConfig

ORIGIN = "http://127.0.0.1:5173"
HEADERS = {"Origin": ORIGIN, "X-ForgeWorks-Console": "1", "Sec-Fetch-Site": "same-origin"}


def fixture_service(tmp_path):
    service = Service(f"sqlite:///{tmp_path / 'factory.db'}", tmp_path / "models")
    service.generate(count=3)
    return service


def test_empty_catalog_is_safe(tmp_path):
    service = Service(f"sqlite:///{tmp_path / 'empty.db'}", tmp_path / "models")
    with TestClient(create_app(service)) as client:
        catalog = client.get("/api/v1/console/catalog").json()
        assert catalog["preferred"] is None and catalog["schedules"] == []
        assert not catalog["can_approve"]
        assert client.get("/api/v1/console/schedules/unknown").status_code == 404


def test_console_reads_are_version_scoped(tmp_path):
    service = fixture_service(tmp_path)
    plan = service.optimize(method="EDD")
    key = plan["id"]
    result = service.simulate(key, SimulationConfig(runs=3, seed=91))
    with TestClient(create_app(service)) as client:
        prefix = f"/api/v1/console/schedules/{key}"
        data = client.get(prefix).json()
        assert data["id"] == key and data["simulations"][0]["id"] == result["id"]
        assert len(data["factory"]["orders"]) == 3
        distribution = client.get(
            prefix + "/risk", params={"simulation_id": result["id"], "order": "ORD-101"}
        )
        assert distribution.status_code == 200
        assert [r["completion"] for r in distribution.json()["series"]] == [
            r["completion"].get("ORD-101") for r in result["replications"]
        ]
        assert client.get(prefix + "/risk", params={"simulation_id": "wrong"}).status_code == 404
        estimates = client.get(prefix + "/predictions", params={"order": "ORD-101"}).json()
        assert estimates["predictions"]
        assert all(r["erp"] > 0 for r in estimates["predictions"])
        assert all(r["history_mean"] is None for r in estimates["predictions"])


def test_console_boundary_and_audited_transitions(tmp_path, monkeypatch):
    monkeypatch.setenv("FORGEWORKS_CONSOLE_MODE", "local")
    monkeypatch.setenv("FORGEWORKS_PLANNER_TOKEN", "server-only-test")
    service = fixture_service(tmp_path)
    key = service.optimize(method="EDD")["id"]
    payload = {"identity": "QA planner"}
    path = f"/api/v1/console/schedules/{key}"
    with TestClient(create_app(service)) as client:
        assert client.post(path + "/approve", json=payload).status_code == 403
        assert (
            client.post(
                path + "/approve",
                headers={**HEADERS, "Origin": "https://invalid.test"},
                json=payload,
            ).status_code
            == 403
        )
        assert (
            client.post(
                path + "/approve", headers={**HEADERS, "Sec-Fetch-Site": "cross-site"}, json=payload
            ).status_code
            == 403
        )
        assert (
            client.post(
                f"/api/v1/schedules/{key}/approve",
                headers={**HEADERS, "X-Planner-Token": "server-only-test"},
                json=payload,
            ).status_code
            == 403
        )
        assert client.post(path + "/release", headers=HEADERS, json=payload).status_code == 422
        assert (
            client.post(path + "/approve", headers=HEADERS, json=payload).json()["state"]
            == "APPROVED"
        )
        assert (
            client.post(path + "/release", headers=HEADERS, json=payload).json()["state"]
            == "RELEASED"
        )
        info = client.get(path).json()
        assert [a["action"] for a in info["approvals"]] == ["release", "approve"]
        assert "server-only-test" not in client.get("/api/v1/console/catalog").text


def test_public_read_only_blocks_live_jobs_and_copilot_side_effects(tmp_path, monkeypatch):
    monkeypatch.setenv("FORGEWORKS_CONSOLE_MODE", "read-only")
    monkeypatch.setenv("FORGEWORKS_PLANNER_TOKEN", "configured-but-disabled")
    service = fixture_service(tmp_path)
    key = service.optimize(method="EDD")["id"]
    with TestClient(create_app(service)) as client:
        public = client.get("/api/v1/console/catalog").json()
        assert not public["can_plan"] and not public["can_approve"]
        for path in (
            "/schedules/optimize",
            "/scenarios/what-if",
            f"/schedules/{key}/simulate",
            "/datasets",
            "/models/promote",
            f"/console/schedules/{key}/release",
            "/execution",
        ):
            assert client.post("/api/v1" + path, headers=HEADERS, json={}).status_code == 403
        answer = client.post(
            "/api/v1/copilot/query",
            headers=HEADERS,
            json={"schedule": key, "tool": "get_bottlenecks"},
        )
        assert answer.status_code == 200
        with service.store.transaction() as conn:
            assert not conn.execute(db.interactions.select()).all()


def test_verified_fixture_restores_only_empty_isolated_database(tmp_path, monkeypatch):
    source = Path(__file__).resolve().parents[1] / "examples/console_seed.py"
    spec = importlib.util.spec_from_file_location("console_seed", source)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setenv("FORGEWORKS_DATABASE_URL", f"sqlite:///{tmp_path / 'seed.db'}")
    monkeypatch.setenv("FORGEWORKS_MODEL_DIR", str(tmp_path / "models"))
    monkeypatch.setenv("FORGEWORKS_DEMO_SEED", "1")
    module.seed()
    module.seed()
    service = Service()
    bundle, model = service.model(None)
    assert model and bundle
    with TestClient(create_app(service)) as client:
        catalog = client.get("/api/v1/console/catalog").json()
        assert catalog["demo"] and len(catalog["schedules"]) == 3
        preferred = catalog["preferred"]
        plan = client.get(f"/api/v1/console/schedules/{preferred}").json()
        assert len(plan["plan"]["operations"]) == 148
        risk = client.get(f"/api/v1/console/schedules/{preferred}/risk").json()
        assert len(risk["series"]) == 300
