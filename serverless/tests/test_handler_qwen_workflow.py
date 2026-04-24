from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from handler import build_qwen_edit_workflow  # noqa: E402


def replace_placeholders(value, replacements):
    if isinstance(value, dict):
        return {k: replace_placeholders(v, replacements) for k, v in value.items()}
    if isinstance(value, list):
        return [replace_placeholders(v, replacements) for v in value]
    if isinstance(value, str) and value in replacements:
        return replacements[value]
    return value


def test_qwen_edit_workflow_matches_reference_template():
    template_path = ROOT / "workflow_template_qwen_edit.json"
    template = json.loads(template_path.read_text())
    template.pop("_comment", None)

    expected = replace_placeholders(
        template,
        {
            "${prompt}": "make the jacket green",
            "${input_image_b64}": "BASE64",
            "${strength}": 0.85,
            "${seed}": 42,
            "${steps}": 8,
        },
    )
    actual = build_qwen_edit_workflow("make the jacket green", "BASE64", 0.85, 42, 8)

    assert actual == expected


def test_qwen_edit_workflow_contains_required_node_classes():
    workflow = build_qwen_edit_workflow("edit", "BASE64", 0.85, 42, 8)
    classes = {node["class_type"] for node in workflow.values()}

    assert {
        "QwenImageEditDiffusionModelLoader",
        "QwenImageEditCLIPLoader",
        "QwenImageEditVAELoader",
        "LoadImageBase64",
        "VAEEncode",
        "LoraLoader",
        "CLIPTextEncode",
        "KSampler",
        "VAEDecode",
        "SaveImage",
    }.issubset(classes)
