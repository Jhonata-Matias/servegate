# Qwen-Image-Edit NOTICE Template

This file is the source template for `/runpod-volume/ComfyUI/NOTICE.md` created during Story 3.1 deployment.

## Components

| Component | Artifact | License | Source |
|---|---|---|---|
| Qwen-Image-Edit UNet fp8 | `qwen_image_edit_fp8_e4m3fn.safetensors` | Apache 2.0 | https://huggingface.co/Qwen/Qwen-Image-Edit |
| Qwen Image VAE | `qwen_image_vae.safetensors` | Apache 2.0 | https://huggingface.co/Qwen/Qwen-Image |
| Qwen2.5-VL encoder | `qwen_2.5_vl_7b_fp8_scaled.safetensors` | Apache 2.0 | https://huggingface.co/Qwen |
| Lightning 8-step LoRA for Qwen-Image | `qwen_image_lightning_8steps_lora.safetensors` (renamed from upstream `Qwen-Image-Lightning-8steps-V1.0.safetensors`) | Apache 2.0 | https://huggingface.co/lightx2v/Qwen-Image-Lightning |

## Attribution

Qwen base model components (UNet, VAE, Qwen2.5-VL encoder) are provided by the Qwen team under Apache License 2.0.

The Lightning 8-step LoRA adapter is provided by lightx2v under Apache License 2.0 (verified `2026-04-24` from the lightx2v/Qwen-Image-Lightning HuggingFace repository).

Preserve upstream license files and model-card notices when copying artifacts to the RunPod network volume. All four components are Apache 2.0 — compatible with MIT distribution of the consumer SDK and with commercial use.
