"""Unit tests for `handler.normalize_input`.

Covers AC6 of Story 2.1.1 — 13 cases spanning edge-case rejection,
default filling, and full-spec acceptance. No endpoint needed; pure function.

Run:
    pytest serverless/tests/test_normalize_input.py -v
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from handler import (  # noqa: E402
    DEFAULT_HEIGHT,
    DEFAULT_STEPS,
    DEFAULT_WIDTH,
    MAX_STEPS,
    MAX_DIM,
    MIN_DIM,
    normalize_input,
)


# --- Rejections (11 cases covering input validation surface) ---


def test_empty_prompt_rejected():
    with pytest.raises(ValueError, match="prompt"):
        normalize_input({"prompt": ""})


def test_whitespace_prompt_rejected():
    with pytest.raises(ValueError, match="prompt"):
        normalize_input({"prompt": "   "})


def test_none_prompt_rejected():
    with pytest.raises(ValueError, match="prompt"):
        normalize_input({"prompt": None})


def test_non_string_prompt_rejected():
    with pytest.raises(ValueError, match="prompt"):
        normalize_input({"prompt": 42})


def test_dict_prompt_rejected():
    with pytest.raises(ValueError, match="prompt"):
        normalize_input({"prompt": {"nested": "value"}})


def test_steps_zero_rejected():
    """L1 regression — explicit 0 must NOT coerce to default (previous bug)."""
    with pytest.raises(ValueError, match="steps"):
        normalize_input({"prompt": "x", "steps": 0})


def test_steps_over_max_rejected():
    with pytest.raises(ValueError, match="steps"):
        normalize_input({"prompt": "x", "steps": MAX_STEPS + 1})


def test_width_below_min_rejected():
    with pytest.raises(ValueError, match="width/height"):
        normalize_input({"prompt": "x", "width": MIN_DIM - 8})


def test_width_zero_rejected():
    """L1 regression — 0 must not coerce to default."""
    with pytest.raises(ValueError, match="width/height"):
        normalize_input({"prompt": "x", "width": 0})


def test_width_not_multiple_of_8_rejected():
    with pytest.raises(ValueError, match="multiples of 8"):
        normalize_input({"prompt": "x", "width": 1025})


def test_negative_seed_rejected():
    with pytest.raises(ValueError, match="seed"):
        normalize_input({"prompt": "x", "seed": -1})


# --- Acceptances (4 cases covering happy paths + explicit-zero for seed) ---


def test_valid_defaults_applied():
    r = normalize_input({"prompt": "a cat"})
    assert r["prompt"] == "a cat"
    assert r["steps"] == DEFAULT_STEPS
    assert r["width"] == DEFAULT_WIDTH
    assert r["height"] == DEFAULT_HEIGHT
    assert isinstance(r["seed"], int)
    assert 0 <= r["seed"] < 2**31


def test_full_explicit_params_preserved():
    r = normalize_input(
        {
            "prompt": "neon city",
            "steps": 8,
            "seed": 42,
            "width": 512,
            "height": 768,
        }
    )
    assert r == {
        "prompt": "neon city",
        "steps": 8,
        "seed": 42,
        "width": 512,
        "height": 768,
    }


def test_seed_zero_preserved_not_randomized():
    """seed=0 is a valid explicit seed, must NOT be replaced by random."""
    r = normalize_input({"prompt": "x", "seed": 0})
    assert r["seed"] == 0


def test_prompt_trimmed():
    r = normalize_input({"prompt": "  spaced  "})
    assert r["prompt"] == "spaced"


# --- Edge case: upper boundaries accepted ---


def test_max_steps_accepted():
    r = normalize_input({"prompt": "x", "steps": MAX_STEPS})
    assert r["steps"] == MAX_STEPS


def test_max_dim_accepted():
    r = normalize_input({"prompt": "x", "width": MAX_DIM, "height": MAX_DIM})
    assert r["width"] == MAX_DIM
    assert r["height"] == MAX_DIM
