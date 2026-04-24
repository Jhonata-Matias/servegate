from __future__ import annotations

import base64
import io
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import handler as handler_module  # noqa: E402


def image_bytes(width: int, height: int) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (width, height), "blue").save(out, format="PNG")
    return out.getvalue()


def image_b64(width: int, height: int) -> str:
    return base64.b64encode(image_bytes(width, height)).decode("ascii")


def patch_runtime(monkeypatch, image: bytes, seen: dict[str, object]) -> None:
    monkeypatch.setattr(handler_module, "wait_for_comfy", lambda: None)

    def fake_queue(workflow):
        seen["workflow"] = workflow
        return "prompt-1"

    monkeypatch.setattr(handler_module, "queue_workflow", fake_queue)
    monkeypatch.setattr(handler_module, "poll_history", lambda prompt_id: {"outputs": {}})
    monkeypatch.setattr(handler_module, "extract_image_bytes", lambda history: image)


def test_t2i_payload_routes_to_flux_workflow(monkeypatch):
    seen: dict[str, object] = {}
    patch_runtime(monkeypatch, image_bytes(32, 32), seen)

    result = handler_module.handler(
        {"id": "job-t2i", "input": {"prompt": "cat", "steps": 4, "seed": 42, "width": 512, "height": 768}}
    )

    workflow = seen["workflow"]
    assert isinstance(workflow, dict)
    assert workflow["10"]["class_type"] == "UNETLoader"
    assert result["metadata"] == {"seed": 42, "elapsed_ms": result["metadata"]["elapsed_ms"]}
    assert "image_b64" in result


def test_i2i_payload_routes_to_qwen_workflow(monkeypatch):
    seen: dict[str, object] = {}
    patch_runtime(monkeypatch, image_bytes(128, 128), seen)

    result = handler_module.handler(
        {
            "id": "job-i2i",
            "input": {
                "prompt": "make the jacket green",
                "input_image_b64": image_b64(640, 360),
                "seed": 42,
            },
        }
    )

    workflow = seen["workflow"]
    assert isinstance(workflow, dict)
    assert workflow["10"]["class_type"] == "QwenImageEditDiffusionModelLoader"
    assert workflow["13"]["class_type"] == "LoadImageBase64"
    assert workflow["18"]["inputs"]["denoise"] == 0.85
    assert result["metadata"]["qwen_generated_width"] == 128
    assert result["metadata"]["qwen_generated_height"] == 128
    assert result["metadata"]["output_width"] == 640
    assert result["metadata"]["output_height"] == 360
