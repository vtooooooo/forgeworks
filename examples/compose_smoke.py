"""Exercise the persisted planning workflow against the Compose PostgreSQL API."""

import io
import os
import time
from zipfile import ZipFile

import httpx


def smoke(base_url: str, token: str) -> None:
    with httpx.Client(base_url=base_url, timeout=15) as client:

        def call(method, path, payload=None, expected=200, headers=None):
            response = client.request(method, path, json=payload, headers=headers)
            assert response.status_code == expected, (path, response.status_code, response.text)
            return response

        def job(path, payload, key):
            accepted = call("POST", path, payload, 202, {"Idempotency-Key": key}).json()
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                current = call("GET", f"/api/v1/jobs/{accepted['id']}").json()
                if current["state"] == "SUCCEEDED":
                    return current["result"]
                assert current["state"] != "FAILED", current
                time.sleep(0.2)
            raise TimeoutError(path)

        root = "/api/v1"
        call("GET", "/health")
        dataset = call("POST", root + "/datasets", {"count": 3}, 201).json()["dataset"]
        model = job(root + "/models/train", {"dataset": dataset, "count": 400}, "smoke-train")
        estimates = call(
            "POST",
            root + "/predictions/durations",
            {"dataset": dataset, "model": model["model"], "order": "ORD-101"},
        ).json()
        assert estimates["predictions"]
        schedule = job(
            root + "/schedules/optimize",
            {"dataset": dataset, "model": model["model"], "seconds": 3},
            "smoke-optimize",
        )["schedule"]
        source = f"{root}/schedules/{schedule}"
        assert call("POST", source + "/validate").json()["valid"]
        sim = job(source + "/simulate", {"runs": 10, "seed": 61}, "smoke-simulate")["simulation"]
        assert call("GET", source + "/risk").json()["id"] == sim
        authorization = {"X-Planner-Token": token}
        call("POST", source + "/release", {"identity": "smoke"}, 403)
        call(
            "POST",
            source + "/approve",
            {"identity": "smoke", "simulation_id": sim},
            headers=authorization,
        )
        call("POST", source + "/release", {"identity": "smoke"}, headers=authorization)
        before = call("GET", source).json()

        explanation = call(
            "POST", root + "/copilot/query", {"schedule": schedule, "tool": "get_simulation_risk"}
        ).json()
        assert explanation["result"]["simulation"] == sim
        alternative = job(
            root + "/scenarios/what-if",
            {
                "schedule": schedule,
                "seconds": 3,
                "change": {"kind": "due_date", "order": "ORD-101", "value": 120},
            },
            "smoke-what-if",
        )
        assert alternative["valid"] and call("GET", source).json() == before
        revised = job(
            source + "/reschedule",
            {
                "at": 0,
                "seconds": 3,
                "config": {"runs": 10, "seed": 61},
                "change": {"kind": "breakdown", "machine": "M-07", "start": 0, "end": 240},
            },
            "smoke-reschedule",
        )
        assert revised["valid"]
        target = f"{root}/schedules/{revised['schedule']}"
        call(
            "POST",
            target + "/approve",
            {"identity": "smoke", "simulation_id": revised["simulation"]["alternative"]},
            headers=authorization,
        )
        call("POST", target + "/release", {"identity": "smoke"}, headers=authorization)
        original = call("GET", source).json()
        assert original["state"] == "SUPERSEDED" and original["payload"] == before["payload"]
        with ZipFile(io.BytesIO(call("GET", target + "/export").content)) as archive:
            assert archive.testzip() is None
            assert "rescheduling_diff.json" in archive.namelist()
        print(f"PostgreSQL API workflow passed on schedule {revised['schedule']}")


if __name__ == "__main__":
    smoke(
        os.getenv("FORGEWORKS_SMOKE_URL", "http://127.0.0.1:8001"),
        os.environ["FORGEWORKS_PLANNER_TOKEN"],
    )
