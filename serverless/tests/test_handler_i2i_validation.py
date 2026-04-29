from __future__ import annotations

import base64
import io
import sys
from pathlib import Path

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from handler import (  # noqa: E402
    MAX_DECODED_IMAGE_BYTES,
    MAX_INPUT_PIXELS,
    DEFAULT_I2I_STEPS,
    DEFAULT_STRENGTH,
    InputValidationError,
    normalize_input,
)


def image_b64(width: int, height: int, fmt: str = "PNG") -> str:
    out = io.BytesIO()
    Image.new("RGB", (width, height), "red").save(out, format=fmt)
    return base64.b64encode(out.getvalue()).decode("ascii")


def test_i2i_defaults_applied():
    r = normalize_input({"prompt": "edit background", "input_image_b64": image_b64(640, 360), "seed": 7})
    assert r["steps"] == DEFAULT_I2I_STEPS
    assert r["strength"] == DEFAULT_STRENGTH
    assert r["seed"] == 7
    assert r["input_width"] == 640
    assert r["input_height"] == 360
    assert r["source_width"] == 640
    assert r["source_height"] == 360
    assert r["input_downsampled"] is False
    assert r["input_mime_type"] == "image/png"


def test_i2i_second_image_normalized_when_present():
    r = normalize_input(
        {
            "prompt": "blend",
            "input_image_b64": image_b64(640, 360),
            "input_image_b64_2": image_b64(720, 480),
            "seed": 7,
        }
    )
    assert r["input_width"] == 640
    assert r["input_height"] == 360
    assert r["input_width_2"] == 720
    assert r["input_height_2"] == 480
    assert r["source_width_2"] == 720
    assert r["source_height_2"] == 480
    assert r["input_downsampled_2"] is False
    assert r["input_mime_type_2"] == "image/png"


def test_square_input_rejected_with_code():
    with pytest.raises(InputValidationError) as exc:
        normalize_input({"prompt": "edit", "input_image_b64": image_b64(512, 512)})
    assert exc.value.error == "invalid_aspect_ratio"


def test_large_input_downsampled_to_one_megapixel_or_less():
    r = normalize_input({"prompt": "edit", "input_image_b64": image_b64(2000, 800)})
    assert r["input_downsampled"] is True
    assert r["input_width"] * r["input_height"] <= MAX_INPUT_PIXELS
    assert r["source_width"] == 2000
    assert r["source_height"] == 800
    assert r["input_width"] > r["input_height"]


def test_payload_over_eight_mb_rejected_before_image_parse():
    oversized = base64.b64encode(b"x" * (MAX_DECODED_IMAGE_BYTES + 1)).decode("ascii")
    with pytest.raises(InputValidationError) as exc:
        normalize_input({"prompt": "edit", "input_image_b64": oversized})
    assert exc.value.error == "image_too_large"


def test_invalid_mime_rejected_by_magic_bytes():
    with pytest.raises(InputValidationError) as exc:
        normalize_input({"prompt": "edit", "input_image_b64": base64.b64encode(b"not an image").decode("ascii")})
    assert exc.value.error == "unsupported_mime_type"


def test_invalid_base64_rejected():
    with pytest.raises(InputValidationError) as exc:
        normalize_input({"prompt": "edit", "input_image_b64": "not@@base64"})
    assert exc.value.error == "invalid_image_base64"


def test_second_image_invalid_base64_rejected_with_field_name():
    with pytest.raises(InputValidationError) as exc:
        normalize_input(
            {
                "prompt": "edit",
                "input_image_b64": image_b64(640, 360),
                "input_image_b64_2": "not@@base64",
            }
        )
    assert exc.value.error == "invalid_image_base64"
    assert "input_image_b64_2" in exc.value.message


def test_second_image_invalid_mime_rejected():
    with pytest.raises(InputValidationError) as exc:
        normalize_input(
            {
                "prompt": "edit",
                "input_image_b64": image_b64(640, 360),
                "input_image_b64_2": base64.b64encode(b"not an image").decode("ascii"),
            }
        )
    assert exc.value.error == "unsupported_mime_type"


def test_second_image_payload_over_eight_mb_rejected():
    oversized = base64.b64encode(b"x" * (MAX_DECODED_IMAGE_BYTES + 1)).decode("ascii")
    with pytest.raises(InputValidationError) as exc:
        normalize_input({"prompt": "edit", "input_image_b64": image_b64(640, 360), "input_image_b64_2": oversized})
    assert exc.value.error == "image_too_large"


def test_strength_range_enforced():
    with pytest.raises(InputValidationError) as exc:
        normalize_input({"prompt": "edit", "input_image_b64": image_b64(640, 360), "strength": 0})
    assert exc.value.error == "invalid_strength"


def test_i2i_steps_range_enforced():
    with pytest.raises(InputValidationError) as exc:
        normalize_input({"prompt": "edit", "input_image_b64": image_b64(640, 360), "steps": 3})
    assert exc.value.error == "invalid_steps"


def test_i2i_width_height_mixed_payload_rejected():
    with pytest.raises(InputValidationError) as exc:
        normalize_input({"prompt": "edit", "input_image_b64": image_b64(640, 360), "width": 640})
    assert exc.value.error == "invalid_i2i_parameters"
