# Qwen-Image-Edit NOTICE Template

This file is the source template for `/runpod-volume/ComfyUI/NOTICE.md` created during Story 3.1 deployment.

## Components

| Component | Artifact | License | Source |
|---|---|---|---|
| Qwen-Image-Edit UNet fp8 | `qwen_image_edit_fp8_e4m3fn.safetensors` | Apache 2.0 | https://huggingface.co/Qwen/Qwen-Image-Edit |
| Qwen Image VAE | `qwen_image_vae.safetensors` | Apache 2.0 | https://huggingface.co/Qwen/Qwen-Image |
| Qwen2.5-VL encoder | `qwen_2.5_vl_7b_fp8_scaled.safetensors` | Apache 2.0 | https://huggingface.co/Qwen |
| Lightning 8-step LoRA for Qwen-Image | `qwen_image_lightning_8steps_lora.safetensors` | Pending `@devops` verification before upload | Fill exact source URL after selecting the artifact |

## Attribution

Qwen model components are provided by the Qwen team under Apache License 2.0. Preserve upstream license files and model-card notices when copying artifacts to the RunPod network volume.

The Lightning LoRA must not be uploaded until its exact source URL and license are verified. If the selected LoRA is not Apache/MIT-compatible, deploy the 50-step Qwen-Image-Edit path without the LoRA and update this NOTICE accordingly.
