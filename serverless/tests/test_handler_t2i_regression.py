from __future__ import annotations

import copy
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from handler import build_workflow  # noqa: E402


EXPECTED_T2I_WORKFLOW_SHA256 = "f94d48b407f8e3e53c0d20a1bae8576eefe0d29333a689d14c12f33784d2f6ba"


def replace_placeholders(value, replacements):
    if isinstance(value, dict):
        return {k: replace_placeholders(v, replacements) for k, v in value.items()}
    if isinstance(value, list):
        return [replace_placeholders(v, replacements) for v in value]
    if isinstance(value, str) and value in replacements:
        return replacements[value]
    return value


def test_t2i_workflow_matches_reference_template():
    template_path = ROOT / "workflow_template.json"
    template = json.loads(template_path.read_text())
    template.pop("_comment", None)

    expected = replace_placeholders(
        template,
        {
            "${prompt}": "fixed regression prompt",
            "${seed}": 42,
            "${steps}": 4,
            "${width}": 1024,
            "${height}": 768,
        },
    )
    actual = build_workflow("fixed regression prompt", 4, 42, 1024, 768)

    assert actual == expected


def test_t2i_workflow_hash_stable_for_fixed_seed_payload():
    workflow = build_workflow("fixed regression prompt", 4, 42, 1024, 768)
    digest = hashlib.sha256(json.dumps(workflow, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    assert digest == EXPECTED_T2I_WORKFLOW_SHA256


def test_t2i_workflow_builder_is_pure():
    first = build_workflow("same", 4, 42, 512, 768)
    second = build_workflow("same", 4, 42, 512, 768)
    assert first == second
    assert first is not second
    assert first == copy.deepcopy(first)
