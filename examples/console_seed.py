"""Import a trusted precomputed synthetic fixture into a dedicated empty database."""

import base64
import gzip
import hashlib
import json
import os
import re
from pathlib import Path

from forgeworks import database as db
from forgeworks.service import Service

FIXTURE = Path(__file__).parent / "console-fixture" / "verified.json.gz"


def seed():
    if os.environ.get("FORGEWORKS_DEMO_SEED") != "1":
        raise RuntimeError("Set FORGEWORKS_DEMO_SEED=1 for a dedicated disposable database")
    bundle = json.loads(gzip.decompress(FIXTURE.read_bytes()))
    service = Service()
    with service.store.transaction(True) as conn:
        if db.row(conn, db.settings, "console_seed"):
            return
        for table in db.metadata.sorted_tables:
            if conn.execute(table.select().limit(1)).first():
                raise RuntimeError(f"Refusing to seed a nonempty database ({table.name})")
        for table in db.metadata.sorted_tables:
            rows = bundle["tables"].get(table.name, [])
            if rows:
                conn.execute(table.insert(), rows)
        service.model_dir.mkdir(parents=True, exist_ok=True)
        for artifact in bundle["models"]:
            key = artifact["id"]
            if re.fullmatch("[0-9a-f]{32}", key) is None:
                raise ValueError("Invalid fixture model ID")
            content = base64.b64decode(artifact["data"], validate=True)
            if hashlib.sha256(content).hexdigest() != artifact["sha256"]:
                raise ValueError("Fixture model checksum mismatch")
            destination = service.model_dir / (key + ".pkl")
            if destination.exists() and destination.read_bytes() != content:
                raise RuntimeError("Refusing to replace an unrelated model artifact")
            destination.write_bytes(content)
        provenance = {
            **bundle["provenance"],
            "schedule_ids": [schedule["id"] for schedule in bundle["tables"]["scheduling_runs"]],
        }
        db.put(conn, db.settings, "console_seed", provenance)


if __name__ == "__main__":
    seed()
