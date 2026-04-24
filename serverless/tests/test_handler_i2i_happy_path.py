from __future__ import annotations

import base64
import io
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import handler as handler_module  # noqa: E402


def make_png(width: int, height: int, color: str = "green") -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (width, height), color).save(out, format="PNG")
    return out.getvalue()


def make_b64(width: int, height: int) -> str:
    return base64.b64encode(make_png(width, height)).decode("ascii")


def size_from_b64(value: str) -> tuple[int, int]:
    with Image.open(io.BytesIO(base64.b64decode(value))) as img:
        return img.size


def test_i2i_handler_resizes_output_to_input_dimensions(monkeypatch, tmp_path):
    generated = make_png(512, 512, "purple")

    monkeypatch.setattr(handler_module, "wait_for_comfy", lambda: None)
    monkeypatch.setattr(handler_module, "queue_workflow", lambda workflow: "prompt-1")
    monkeypatch.setattr(handler_module, "poll_history", lambda prompt_id: {"outputs": {}})
    monkeypatch.setattr(handler_module, "extract_image_bytes", lambda history: generated)
    # Round 3: handler writes input image to ComfyUI input dir; redirect to tmp_path
    monkeypatch.setattr(handler_module, "COMFY_INPUT_DIR", str(tmp_path))

    result = handler_module.handler(
        {
            "id": "job-i2i",
            "input": {
                "prompt": "change the wall color",
                "input_image_b64": make_b64(720, 480),
                "seed": 123,
                "steps": 8,
                "strength": 0.7,
            },
        }
    )

    assert size_from_b64(result["image_b64"]) == (720, 480)
    assert result["metadata"]["seed"] == 123
    assert result["metadata"]["qwen_generated_width"] == 512
    assert result["metadata"]["qwen_generated_height"] == 512
    assert result["metadata"]["output_width"] == 720
    assert result["metadata"]["output_height"] == 480
    assert result["metadata"]["input_width"] == 720
    assert result["metadata"]["input_height"] == 480
    assert result["metadata"]["input_downsampled"] is False
    # Round 3 F7: tempfile cleanup post-response (finally block)
    remaining = list(tmp_path.iterdir())
    assert not remaining, f"input image tempfile leaked: {remaining}"


def test_i2i_handler_cleans_up_tempfile_on_timeout(monkeypatch, tmp_path):
    """Regression guard for Round 3 F7 cleanup: even on TimeoutError the input image
    must be removed from COMFY_INPUT_DIR. Otherwise long-running pods leak disk over
    time (each request writes a new PNG up to 8 MB decoded)."""
    monkeypatch.setattr(handler_module, "wait_for_comfy", lambda: None)
    monkeypatch.setattr(handler_module, "queue_workflow", lambda workflow: "prompt-1")
    monkeypatch.setattr(
        handler_module,
        "poll_history",
        lambda prompt_id: (_ for _ in ()).throw(TimeoutError("simulated")),
    )
    monkeypatch.setattr(handler_module, "COMFY_INPUT_DIR", str(tmp_path))

    result = handler_module.handler(
        {
            "id": "job-i2i-timeout",
            "input": {
                "prompt": "edit",
                "input_image_b64": make_b64(720, 480),
                "seed": 7,
            },
        }
    )
    assert result == {"error": "generation_timeout", "code": 504}
    assert not list(tmp_path.iterdir()), "tempfile not cleaned up on timeout"
