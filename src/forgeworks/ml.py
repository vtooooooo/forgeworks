"""Chronological duration evaluation and split-conformal calibration."""

from bisect import bisect_right
from collections import defaultdict
from math import ceil, sqrt
from statistics import mean, median
from typing import Any

from sklearn.ensemble import RandomForestRegressor
from sklearn.feature_extraction import DictVectorizer
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline

from .domain import Factory, eligible
from .generation import features

SCHEMA = ("family", "operation", "quantity", "machine", "rate", "material", "condition", "erp")


def inputs(row: dict) -> dict:
    return {k: row[k] for k in SCHEMA}


def scores(actual, predicted, radius):
    errors = [float(p - a) for a, p in zip(actual, predicted)]
    return {
        "n": len(errors),
        "mae": mean(map(abs, errors)),
        "rmse": sqrt(mean(e * e for e in errors)),
        "bias": mean(errors),
        "median_ae": median(map(abs, errors)),
        "coverage": mean(abs(e) <= radius for e in errors),
        "interval_width": 2 * radius,
    }


def train(rows: list[dict], seed: int = 42) -> tuple[dict, dict]:
    if len(rows) < 100:
        raise ValueError("Training requires at least 100 observations")
    ordered = sorted(rows, key=lambda row: row["at"])
    size = len(ordered)
    times = [row["at"] for row in ordered]
    boundaries = tuple(
        bisect_right(times, times[size * percent // 100 - 1]) for percent in (55, 70, 85)
    )
    if not 0 < boundaries[0] < boundaries[1] < boundaries[2] < size:
        raise ValueError("Insufficient distinct observation times for four chronological splits")
    training = ordered[: boundaries[0]]
    validation = ordered[boundaries[0] : boundaries[1]]
    calibration = ordered[boundaries[1] : boundaries[2]]
    test = ordered[boundaries[2] :]
    grouped = defaultdict(list)
    for row in training:
        grouped[row["family"], row["operation"]].append(row["duration"])
    models = {
        "ridge": make_pipeline(DictVectorizer(sparse=False), Ridge(alpha=15)),
        "forest": make_pipeline(
            DictVectorizer(sparse=False),
            RandomForestRegressor(n_estimators=70, min_samples_leaf=6, random_state=seed, n_jobs=1),
        ),
    }
    for model in models.values():
        model.fit([inputs(row) for row in training], [row["duration"] for row in training])
    bundle: dict[str, Any] = {
        "models": models,
        "medians": {k: median(v) for k, v in grouped.items()},
        "median": median(row["duration"] for row in training),
        "radii": {},
    }
    names = ("erp", "median", *models)
    metrics: dict[str, Any] = {}
    val_mae = {}
    for name in names:
        residuals = sorted(
            abs(p - row["duration"])
            for p, row in zip(predict(bundle, name, calibration), calibration)
        )
        radius = float(residuals[min(len(residuals), ceil((len(residuals) + 1) * 0.9)) - 1])
        bundle["radii"][name] = radius
        test_predictions = predict(bundle, name, test)
        val_mae[name] = scores(
            [r["duration"] for r in validation], predict(bundle, name, validation), radius
        )["mae"]
        metrics[name] = {
            "validation_mae": val_mae[name],
            "test": scores([r["duration"] for r in test], test_predictions, radius),
        }
        for feature in ("family", "machine", "shift"):
            groups = {}
            for group in sorted({r[feature] for r in test}):
                pairs = [
                    (r["duration"], p)
                    for r, p in zip(test, test_predictions)
                    if r[feature] == group
                ]
                a, p = zip(*pairs)
                groups[str(group)] = scores(a, p, radius)
            metrics[name][f"by_{feature}"] = groups
        shifted = [
            {
                **r,
                "quantity": 2 * r["quantity"],
                "erp": r["erp"] * 1.8,
                "duration": r["duration"] * 2.1,
            }
            for r in test
        ]
        metrics[name]["synthetic_shift_stress"] = scores(
            [r["duration"] for r in shifted], predict(bundle, name, shifted), radius
        )
    candidate = min(models, key=lambda name: val_mae[name])
    accepted = (
        val_mae[candidate] < val_mae["erp"]
        and metrics[candidate]["test"]["mae"] < metrics["erp"]["test"]["mae"]
        and metrics[candidate]["test"]["coverage"] >= 0.82
    )
    bundle["selected"] = candidate if accepted else "erp"
    return bundle, {
        "candidate": candidate,
        "eligible_for_promotion": accepted,
        "selected": bundle["selected"],
        "models": metrics,
        "split_sizes": [len(x) for x in (training, validation, calibration, test)],
        "split_time_ranges": [
            [part[0]["at"], part[-1]["at"]] for part in (training, validation, calibration, test)
        ],
        "features": SCHEMA,
        "seed": seed,
        "target_coverage": 0.9,
    }


def predict(bundle: dict, name: str, rows: list[dict]) -> list[float]:
    if not rows:
        return []
    if name == "erp":
        return [float(r["erp"]) for r in rows]
    if name == "median":
        return [
            float(bundle["medians"].get((r["family"], r["operation"]), bundle["median"]))
            for r in rows
        ]
    return [max(1.0, float(x)) for x in bundle["models"][name].predict([inputs(r) for r in rows])]


def predictions(factory: Factory, bundle: dict | None = None, quantile_buffer: float = 0):
    products = {p.id: p for p in factory.products}
    combinations = [
        (o, i, m)
        for o in factory.orders
        for i in range(len(products[o.product].route))
        for m in factory.machines
        if eligible(m, products[o.product], i, o.quantity)
    ]
    rows = [features(products[o.product], i, o.quantity, m) for o, i, m in combinations]
    name = bundle["selected"] if bundle else "erp"
    radius = bundle["radii"][name] if bundle else None
    expected = predict(bundle or {}, name, rows)
    return [
        {
            "order": o.id,
            "stage": i,
            "machine": m.id,
            "expected": value,
            "lower": max(1, value - radius) if radius is not None else None,
            "upper": value + radius if radius is not None else None,
            "minutes": ceil(value + quantile_buffer * (radius or 0)),
            "method": name,
        }
        for (o, i, m), value in zip(combinations, expected)
    ]
