import base64
import importlib.util
import io
import sys
import types
from pathlib import Path

from PIL import Image


def load_handler_module():
    class FakeInferenceMode:
        def __enter__(self):
            return None

        def __exit__(self, exc_type, exc, traceback):
            return False

    class FakeGenerator:
        def __init__(self, device=None):
            self.device = device
            self.seed = None

        def manual_seed(self, seed):
            self.seed = seed
            return self

    diffusers_module = types.ModuleType("diffusers")
    diffusers_module.__version__ = "test"
    diffusers_module.LTXConditionPipeline = object
    diffusers_module.LTXPipeline = object

    diffusers_utils_module = types.ModuleType("diffusers.utils")
    diffusers_utils_module.export_to_video = lambda *args, **kwargs: None

    runpod_module = types.ModuleType("runpod")
    runpod_module.serverless = types.SimpleNamespace(start=lambda *args, **kwargs: None)

    torch_module = types.ModuleType("torch")
    torch_module.bfloat16 = "bfloat16"
    torch_module.float16 = "float16"
    torch_module.float32 = "float32"
    torch_module.Generator = FakeGenerator
    torch_module.cuda = types.SimpleNamespace(is_available=lambda: False)
    torch_module.inference_mode = FakeInferenceMode
    torch_module.version = types.SimpleNamespace(cuda=None)

    huggingface_hub_module = types.ModuleType("huggingface_hub")
    huggingface_hub_module.hf_hub_download = lambda **kwargs: "/tmp/model.safetensors"

    sys.modules["diffusers"] = diffusers_module
    sys.modules["diffusers.utils"] = diffusers_utils_module
    sys.modules["runpod"] = runpod_module
    sys.modules["torch"] = torch_module
    sys.modules["huggingface_hub"] = huggingface_hub_module

    handler_path = Path(__file__).resolve().parents[1] / "handler.py"
    spec = importlib.util.spec_from_file_location("spike_handler_under_test", handler_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["spike_handler_under_test"] = module
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def make_image_b64() -> str:
    image = Image.new("RGB", (32, 32), color=(120, 60, 30))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def test_i2v_call_kwargs_use_canonical_image_parameter(monkeypatch):
    handler = load_handler_module()
    params = handler.normalize_input(
        {
            "prompt": "gentle camera movement",
            "input_image_b64": make_image_b64(),
            "width": 704,
            "height": 512,
            "num_frames": 121,
            "seed": 1001,
        }
    )

    captured = {}

    class FakePipe:
        def __call__(self, **call_kwargs):
            captured.update(call_kwargs)
            return types.SimpleNamespace(frames=[["frame"]])

    monkeypatch.setattr(handler, "load_pipeline", lambda kind: (FakePipe(), False, 0))

    output_path, _timing = handler.generate_video(params)

    assert params.mode == "i2v"
    assert output_path.exists()
    assert "image" in captured
    assert isinstance(captured["image"], Image.Image)
    assert "conditions" not in captured
    output_path.unlink(missing_ok=True)


def test_i2v_load_pipeline_disables_dynamic_shifting(monkeypatch, tmp_path):
    """
    Story 5.1.1.3 AC4 — runtime regression test.

    The I2V pipeline (LTXConditionPipeline in diffusers 0.37.1) has an upstream bug:
    its __call__() method does NOT invoke calculate_shift() before
    scheduler.set_timesteps(), causing the runtime error
    'mu must be passed when use_dynamic_shifting is set to be True'.

    Workaround applied in handler.load_pipeline() for kind=='i2v':
        pipe.scheduler.register_to_config(use_dynamic_shifting=False)

    This test asserts the workaround is invoked. Mutation guard: if a future change
    removes the register_to_config call, this test fails — preventing reintroduction
    of the original 5.1.1.2 production failure (3/3 FAILED in
    spike/runs/20260430T182937Z-L4-24GB-i2v-fase1-close/summary.json).
    """
    handler = load_handler_module()

    # Reset module-level pipe cache so load_pipeline actually instantiates
    handler._PIPE = None
    handler._PIPE_KIND = None
    handler._MODEL_LOAD_MS = None

    register_to_config_calls = []

    class FakeConfig:
        def __init__(self):
            # Default mirrors real diffusers FlowMatchEulerDiscreteScheduler behavior
            self.use_dynamic_shifting = True

    class FakeScheduler:
        def __init__(self):
            self.config = FakeConfig()

        def register_to_config(self, **kwargs):
            register_to_config_calls.append(kwargs)
            for key, value in kwargs.items():
                setattr(self.config, key, value)

    class FakeI2VPipe:
        def __init__(self):
            self.scheduler = FakeScheduler()
            self.vae = None  # avoid enable_tiling branch

        def to(self, device):
            return self

        @classmethod
        def from_pretrained(cls, *args, **kwargs):
            return cls()

        @classmethod
        def from_single_file(cls, *args, **kwargs):
            return cls()

    class FakeT2VPipe(FakeI2VPipe):
        pass  # T2V uses LTXPipeline class; same fake shape, distinct identity for assertions

    monkeypatch.setattr(handler, "LTXConditionPipeline", FakeI2VPipe)
    monkeypatch.setattr(handler, "LTXPipeline", FakeT2VPipe)
    # Avoid env-driven CPU offload branch
    monkeypatch.setattr(handler, "ENABLE_CPU_OFFLOAD", False, raising=False)
    # Force pretrained path; from_single_file would also work but pretrained matches prod
    monkeypatch.setattr(handler, "MODEL_LOADING_PATH", "pretrained", raising=False)
    # Redirect prod cache path (/runpod-volume) to test tmp dir
    monkeypatch.setattr(handler, "MODEL_CACHE_DIR", str(tmp_path / "model-cache"), raising=False)

    pipe, _was_loaded, _model_load_ms = handler.load_pipeline("i2v")

    assert isinstance(pipe, FakeI2VPipe)
    assert {"use_dynamic_shifting": False} in register_to_config_calls, (
        "I2V load_pipeline must call scheduler.register_to_config(use_dynamic_shifting=False) "
        "to bypass the diffusers 0.37.1 LTXConditionPipeline mu/calculate_shift bug. "
        "If this assertion fails, the Story 5.1.1.3 fix has been reverted/removed."
    )
    assert pipe.scheduler.config.use_dynamic_shifting is False, (
        "Post-fix: scheduler.config.use_dynamic_shifting must be False on I2V pipeline."
    )


def test_t2v_load_pipeline_does_not_touch_dynamic_shifting(monkeypatch, tmp_path):
    """
    Story 5.1.1.3 AC3 — T2V no-regression unit guard.

    The fix in load_pipeline() must be I2V-only (gated by `if kind == "i2v"`).
    T2V (LTXPipeline) correctly computes mu via calculate_shift() upstream and
    must NOT have its dynamic shifting disabled.
    """
    handler = load_handler_module()

    handler._PIPE = None
    handler._PIPE_KIND = None
    handler._MODEL_LOAD_MS = None

    register_to_config_calls = []

    class FakeConfig:
        def __init__(self):
            self.use_dynamic_shifting = True

    class FakeScheduler:
        def __init__(self):
            self.config = FakeConfig()

        def register_to_config(self, **kwargs):
            register_to_config_calls.append(kwargs)
            for key, value in kwargs.items():
                setattr(self.config, key, value)

    class FakeT2VPipe:
        def __init__(self):
            self.scheduler = FakeScheduler()
            self.vae = None

        def to(self, device):
            return self

        @classmethod
        def from_pretrained(cls, *args, **kwargs):
            return cls()

        @classmethod
        def from_single_file(cls, *args, **kwargs):
            return cls()

    class FakeI2VPipe(FakeT2VPipe):
        pass

    monkeypatch.setattr(handler, "LTXPipeline", FakeT2VPipe)
    monkeypatch.setattr(handler, "LTXConditionPipeline", FakeI2VPipe)
    monkeypatch.setattr(handler, "ENABLE_CPU_OFFLOAD", False, raising=False)
    monkeypatch.setattr(handler, "MODEL_LOADING_PATH", "pretrained", raising=False)
    monkeypatch.setattr(handler, "MODEL_CACHE_DIR", str(tmp_path / "model-cache"), raising=False)

    pipe, _was_loaded, _model_load_ms = handler.load_pipeline("t2v")

    assert isinstance(pipe, FakeT2VPipe)
    assert register_to_config_calls == [], (
        "T2V load_pipeline must NOT call register_to_config — the fix is I2V-only. "
        "Calls observed: %r" % register_to_config_calls
    )
    assert pipe.scheduler.config.use_dynamic_shifting is True, (
        "T2V scheduler should retain its default use_dynamic_shifting=True (no mutation)."
    )
