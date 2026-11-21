"""Typed request contracts shared by transport and execution jobs."""

from typing import Literal

from pydantic import Field

from .domain import Record, Weights
from .generation import Scenario
from .optimization import AssignmentScope, Method
from .scenarios import Change
from .simulation import SimulationConfig


class DatasetRequest(Record):
    scenario: Scenario = "normal"
    seed: int = Field(default=42, ge=0, le=2**31 - 1)
    count: int = Field(default=12, ge=0, le=300)


class TrainRequest(Record):
    dataset: str | None = None
    count: int = Field(default=2400, ge=100, le=10000)
    seed: int = Field(default=42, ge=0, le=2**31 - 1)


class PredictRequest(Record):
    dataset: str | None = None
    model: str | None = None
    order: str | None = None


class OptimizeRequest(Record):
    dataset: str | None = None
    model: str | None = None
    method: Method = "CP-SAT"
    seconds: float = Field(default=5.0, gt=0, le=45.0)
    buffer: float = Field(default=0.0, ge=0, le=2.0)
    weights: Weights = Weights()
    assignment_scope: AssignmentScope = "full"


class AlternativeRequest(Record):
    change: Change
    seconds: float = Field(default=5.0, gt=0, le=45.0)
    config: SimulationConfig | None = None


class WhatIfRequest(AlternativeRequest):
    schedule: str


class RescheduleRequest(AlternativeRequest):
    at: int = Field(ge=0)
    freeze_until: int | None = Field(default=None, ge=0)


class ApprovalRequest(Record):
    identity: str = Field(min_length=1, max_length=120)
    simulation_id: str | None = None


class PromotionRequest(Record):
    model: str | None = None
    rollback: bool = False


class Observation(Record):
    id: str = Field(min_length=1, max_length=120)
    order: str
    stage: int = Field(ge=0)
    machine: str
    duration: float = Field(gt=0, le=100000)
    at: int = Field(ge=0)
    shift: int = Field(ge=0, le=1)
    source: Literal["actual", "simulated"]


class ExecutionRequest(Record):
    dataset: str | None = None
    observations: list[Observation] = Field(min_length=1, max_length=500)


class BenchmarkRequest(Record):
    count: int = Field(default=6, ge=1, le=40)
    runs: int = Field(default=30, ge=2, le=500)
    seconds: float = Field(default=4.0, gt=0, le=45)
    seed: int = Field(default=42, ge=0, le=2**31 - 1)
    scenario: Scenario = "tight"
    scale: bool = False
