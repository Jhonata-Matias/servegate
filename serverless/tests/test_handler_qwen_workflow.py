"""Qwen-Image-Edit workflow tests — Round 3 F7 remediation.

QA Round 3 flagged the previous test suite as TAUTOLOGICAL (asserted the handler
returns strings it hardcoded to return). These tests are rewritten to validate
every class_type + enum value in the emitted workflow against a known-good
fixture (`fixtures/comfyui-v0_3_62-object-info.json`) captured from ComfyUI
v0.3.62 source (the version pinned in serverless/Dockerfile).

If ComfyUI is ever upgraded via Dockerfile COMFY_REF bump, regenerate the
fixture from the new version and re-run — the fixture is the single source of
truth for what class_types the real worker will accept.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from handler import build_qwen_edit_workflow  # noqa: E402

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "comfyui-v0_3_62-object-info.json"


def load_registry() -> dict:
    return json.loads(FIXTURE_PATH.read_text())


def replace_placeholders(value, replacements):
    if isinstance(value, dict):
        return {k: replace_placeholders(v, replacements) for k, v in value.items()}
    if isinstance(value, list):
        return [replace_placeholders(v, replacements) for v in value]
    if isinstance(value, str) and value in replacements:
        return replacements[value]
    return value


# ===========================================================================
# Structural reference test — workflow matches committed template
# ===========================================================================


def test_qwen_edit_workflow_matches_reference_template():
    template_path = ROOT / "workflow_template_qwen_edit.json"
    template = json.loads(template_path.read_text())
    template.pop("_comment", None)

    expected = replace_placeholders(
        template,
        {
            "${prompt}": "make the jacket green",
            "${input_image_filename}": "qwen-edit-abc123.png",
            "${strength}": 0.85,
            "${seed}": 42,
            "${steps}": 8,
        },
    )
    actual = build_qwen_edit_workflow(
        "make the jacket green", "qwen-edit-abc123.png", 0.85, 42, 8
    )

    assert actual == expected


def test_qwen_edit_workflow_uses_single_image_encoder_by_default():
    workflow = build_qwen_edit_workflow("prompt", "qwen-edit-a.png", 0.85, 42, 8)

    load_image_nodes = [node for node in workflow.values() if node["class_type"] == "LoadImage"]
    assert len(load_image_nodes) == 1
    assert workflow["16"]["class_type"] == "TextEncodeQwenImageEdit"
    assert workflow["16"]["inputs"]["image"] == ["13", 0]
    assert "TextEncodeQwenImageEditPlus" not in [node["class_type"] for node in workflow.values()]


def test_qwen_edit_workflow_uses_plus_encoder_for_two_images():
    workflow = build_qwen_edit_workflow(
        "blend image 1 with image 2",
        "qwen-edit-a.png",
        0.85,
        42,
        8,
        input_image_filename_2="qwen-edit-b.png",
    )

    load_image_nodes = {
        nid: node for nid, node in workflow.items() if node["class_type"] == "LoadImage"
    }
    assert len(load_image_nodes) == 2
    assert load_image_nodes["13"]["inputs"]["image"] == "qwen-edit-a.png"
    assert load_image_nodes["21"]["inputs"]["image"] == "qwen-edit-b.png"

    positive_node = workflow[workflow["18"]["inputs"]["positive"][0]]
    assert positive_node["class_type"] == "TextEncodeQwenImageEditPlus"
    assert positive_node["inputs"]["image1"] == ["13", 0]
    assert positive_node["inputs"]["image2"] == ["21", 0]
    assert "image_1" not in positive_node["inputs"]
    assert "image_2" not in positive_node["inputs"]


# ===========================================================================
# F7 regression guard — class_types must resolve against real ComfyUI registry
# ===========================================================================


def test_every_class_type_exists_in_comfyui_registry():
    """Every class_type emitted must be a real ComfyUI v0.3.62 node.

    This replaces the tautological Round 2 test (asserted handler returned
    the invented strings `QwenImageEditDiffusionModelLoader`, etc.). Source
    of truth: fixtures/comfyui-v0_3_62-object-info.json, captured from
    https://raw.githubusercontent.com/comfyanonymous/ComfyUI/v0.3.62/nodes.py
    and comfy_extras/nodes_qwen.py on 2026-04-24.
    """
    registry = load_registry()
    workflow = build_qwen_edit_workflow("prompt", "qwen-edit-x.png", 0.85, 42, 8)

    unknown = [
        (nid, node["class_type"])
        for nid, node in workflow.items()
        if node["class_type"] not in registry
    ]
    assert not unknown, (
        f"F7 regression: workflow emits class_type(s) not in ComfyUI v0.3.62 registry: {unknown}. "
        f"Either add them to the Dockerfile via custom_nodes install OR replace with a registered class."
    )


def test_multi_image_plus_class_type_exists_in_comfyui_registry():
    registry = load_registry()
    workflow = build_qwen_edit_workflow("prompt", "a.png", 0.85, 42, 8, input_image_filename_2="b.png")

    unknown = [
        (nid, node["class_type"])
        for nid, node in workflow.items()
        if node["class_type"] not in registry
    ]
    assert not unknown, f"workflow emits class_type(s) not in verified ComfyUI registry: {unknown}"

    plus_inputs = registry["TextEncodeQwenImageEditPlus"]["inputs"]["optional"]
    assert {"image1", "image2", "image3"}.issubset(plus_inputs)
    assert "image_1" not in plus_inputs


def test_clip_loader_type_is_valid_enum_value():
    """CLIPLoader.inputs.type MUST be one of the enum values real ComfyUI accepts."""
    registry = load_registry()
    allowed = registry["CLIPLoader"]["inputs"]["required"]["type"]
    workflow = build_qwen_edit_workflow("p", "f.png", 0.5, 1, 4)

    clip_type = workflow["11"]["inputs"]["type"]
    assert clip_type in allowed, (
        f"CLIPLoader type '{clip_type}' not in allowed enum {allowed}. "
        f"Qwen-Image-Edit requires 'qwen_image' specifically."
    )
    assert clip_type == "qwen_image"


def test_unet_loader_weight_dtype_is_valid_enum_value():
    """UNETLoader.inputs.weight_dtype MUST be one of the enum values real ComfyUI accepts."""
    registry = load_registry()
    allowed = registry["UNETLoader"]["inputs"]["required"]["weight_dtype"]
    workflow = build_qwen_edit_workflow("p", "f.png", 0.5, 1, 4)

    dtype = workflow["10"]["inputs"]["weight_dtype"]
    assert dtype in allowed, f"UNETLoader weight_dtype '{dtype}' not in allowed enum {allowed}"
    assert dtype == "fp8_e4m3fn"  # matches Qwen UNet file suffix


def test_ksampler_sampler_and_scheduler_are_valid_enum_values():
    """KSampler sampler_name + scheduler MUST be registered enum values."""
    registry = load_registry()
    allowed_samplers = registry["KSampler"]["inputs"]["required"]["sampler_name"]
    allowed_schedulers = registry["KSampler"]["inputs"]["required"]["scheduler"]
    workflow = build_qwen_edit_workflow("p", "f.png", 0.5, 1, 4)

    sampler = workflow["18"]["inputs"]["sampler_name"]
    scheduler = workflow["18"]["inputs"]["scheduler"]
    assert sampler in allowed_samplers, f"KSampler sampler '{sampler}' not in {allowed_samplers[:5]}..."
    assert scheduler in allowed_schedulers, f"KSampler scheduler '{scheduler}' not in {allowed_schedulers}"


def test_node_references_resolve_within_workflow():
    """Every input that references another node must point to a node that exists."""
    workflow = build_qwen_edit_workflow("prompt", "f.png", 0.85, 42, 8)
    node_ids = set(workflow.keys())

    dangling_refs = []
    for nid, node in workflow.items():
        for input_key, input_value in node["inputs"].items():
            if isinstance(input_value, list) and len(input_value) == 2 and isinstance(input_value[0], str):
                referenced_node = input_value[0]
                if referenced_node not in node_ids:
                    dangling_refs.append(f"node {nid}.{input_key} -> node {referenced_node} (not found)")
    assert not dangling_refs, f"Dangling node references in workflow: {dangling_refs}"


def test_multi_image_node_references_resolve_within_workflow():
    workflow = build_qwen_edit_workflow("prompt", "f.png", 0.85, 42, 8, input_image_filename_2="g.png")
    node_ids = set(workflow.keys())

    dangling_refs = []
    for nid, node in workflow.items():
        for input_key, input_value in node["inputs"].items():
            if isinstance(input_value, list) and len(input_value) == 2 and isinstance(input_value[0], str):
                referenced_node = input_value[0]
                if referenced_node not in node_ids:
                    dangling_refs.append(f"node {nid}.{input_key} -> node {referenced_node} (not found)")
    assert not dangling_refs, f"Dangling node references in workflow: {dangling_refs}"


def test_workflow_uses_qwen_specific_conditioning_not_plain_clip_text_encode():
    """Qwen-Image-Edit requires TextEncodeQwenImageEdit (image-aware encoder),
    not plain CLIPTextEncode. Regression guard: Rounds 1+2 used CLIPTextEncode
    for the positive prompt which would have produced bad edits even after F7
    loader fix."""
    workflow = build_qwen_edit_workflow("edit this", "f.png", 0.85, 42, 8)

    # The positive conditioning node (referenced by KSampler.positive) must be
    # TextEncodeQwenImageEdit for proper image-aware conditioning.
    ksampler = workflow["18"]
    positive_node_id = ksampler["inputs"]["positive"][0]
    positive_node = workflow[positive_node_id]
    assert positive_node["class_type"] == "TextEncodeQwenImageEdit"
    # Must reference both vae (for reference_latents) and image (for vision encoding)
    assert "vae" in positive_node["inputs"]
    assert "image" in positive_node["inputs"]


def test_lora_loader_strengths_are_positive_floats():
    """Lightning LoRA must be applied with non-zero strength to actually accelerate."""
    workflow = build_qwen_edit_workflow("p", "f.png", 0.85, 42, 8)
    lora = workflow["14"]
    assert lora["class_type"] == "LoraLoader"
    assert lora["inputs"]["strength_model"] > 0
    assert lora["inputs"]["strength_clip"] > 0
    assert lora["inputs"]["lora_name"].endswith(".safetensors")


def test_workflow_has_no_orphan_nodes():
    """Every non-terminal node should be referenced by at least one other node.
    SaveImage is the only allowed terminal (no outgoing references). This catches
    dead-code additions during future refactors."""
    workflow = build_qwen_edit_workflow("p", "f.png", 0.85, 42, 8)
    referenced: set[str] = set()
    for node in workflow.values():
        for value in node["inputs"].values():
            if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str):
                referenced.add(value[0])

    terminals = {nid for nid, n in workflow.items() if n["class_type"] == "SaveImage"}
    orphans = set(workflow.keys()) - referenced - terminals
    assert not orphans, f"Orphan nodes (not referenced, not terminal): {orphans}"
