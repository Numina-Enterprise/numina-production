# NVIDIA NIM host integration

The adapter uses NIM's OpenAI-compatible Chat Completions API. It checks the Numina application and rc26 identity before requesting a model response, exposes the existing discovery tools, and validates the entire bounded tool batch before execution. It creates no new root, journal or treasury. A model response is not a FINAL receipt or proof of hardware deployment.

Use an already configured host SDK:

```js
import {nvidiaNimRoundTrip} from './nvidia-nim.mjs';
const response=await nvidiaNimRoundTrip({
  endpoint:process.env.NUMINA_NIM_BASE_URL,
  model:process.env.NUMINA_NIM_MODEL,
  createProvider:options=>new OpenAI({...options,apiKey:process.env.NVIDIA_API_KEY}),
  messages:[{role:'user',content:'Call numina_application_release once. Report the application version and build ID if present. Label missing fields “not reported.” State that this server-reported record does not independently prove deployment or financial backing. Use at most four bullets.'}],
  toolNames:['numina_application_release']
});
```

The release example exposes only its required discovery tool. The host can select other read-only discovery tools for other tasks; a call to a tool absent from the selected menu is rejected before dispatch.

The host supplies `OpenAI` and its credentials; the kit installs no SDK. Numina requests always use `https://numinalabs.xyz`. Remote NIM endpoints require HTTPS; HTTP is limited to loopback development. The host is responsible for honoring the supplied request timeout and retry limit. The helper makes at most two model calls and one discovery batch of at most eight calls.

`nvidia-local.example.json` creates a named local target configuration, not a running endpoint. Its RTX 5080 candidate is based on NVIDIA's documented single-GPU Llama 3.1 8B INT4 AWQ throughput profile. Resolve and review the immutable image digest before starting it. Confirm actual `/v1/models` output and a tool-capable profile before selecting the model. An image tag is not a verified digest.

Windows requires the supported WSL2/Linux container setup and NVIDIA Container Toolkit. WSL installation may require administrator access and a restart. Keep this candidate bound to loopback. The RTX workstation license exception does not establish entitlement to run a public multi-user service; that deployment requires its own supported hardware/profile and applicable NVIDIA entitlement. No driver, OS, container runtime, registry account, inference service or fleet enrollment is installed by this archive.

L1 retains the root and head; L2 retains Principal, Authority, Objective and Intent; L3 retains scoped authority and policy; this adapter consumes L4 interfaces; L5 retains canonical evidence and `readTreasury()` / `writeTreasury(event)`. Discovery never writes treasury events. Execution adapters require the existing authorization and verified canonical route; selecting NVIDIA cannot enable them.

Run the included Windows bootstrap in stages using PowerShell 7:

```powershell
./setup-nvidia-wsl.ps1 -Stage Check
# Administrator PowerShell is required for InstallWSL.
./setup-nvidia-wsl.ps1 -Stage InstallWSL
# After any requested restart and Ubuntu first-run setup:
./setup-nvidia-wsl.ps1 -Stage InstallContainer
./setup-nvidia-wsl.ps1 -Stage Verify
```

The script follows [NVIDIA's WSL setup](https://docs.nvidia.com/nim/wsl2/1.0.0/getting-started.html), installs Podman and NVIDIA Container Toolkit inside Ubuntu, and generates CDI GPU access. It does not restart Windows, change the Windows display driver, download a model, or open an unauthenticated public port. `nvidia-provider-policy.json` defines Numina as provider for the owner-enrolled GeForce RTX target group; membership is not a blanket model-compatibility assertion or NVIDIA authorization.

## Start and observe the selected local NIM

In the GPU-enabled Ubuntu distribution, `start-nvidia-nim.sh` provides `check`, `pull`, `profiles` and `start` stages. It prompts for the NGC key without echo and keeps registry login in a temporary auth file. The NIM process receives the key for model download; restrict container administration to trusted operators because container environment variables are visible to them. No key is included in the archive or passed on a command line.

Authenticate in [NGC](https://org.ngc.nvidia.com/account/api-keys), select the authorized organization and obtain a key with the required Catalog permissions. Verify the intended model's license separately. Resolve its actual registry digest and select a supported 64-character model profile from `profiles`; do not copy a digest from a different Numina artifact.

```bash
bash start-nvidia-nim.sh check
# Set NUMINA_NIM_IMAGE to the reviewed nvcr.io/nim/...@sha256:... reference.
bash start-nvidia-nim.sh pull
bash start-nvidia-nim.sh profiles
# Set NIM_MODEL_PROFILE to the chosen compatible profile digest.
bash start-nvidia-nim.sh start
```

The start stage binds only `127.0.0.1:8000`, uses a dedicated cache volume and refuses to replace an existing `numina-nim` container. It never changes Numina's root or treasury. Model initialization can take time; container startup is not a readiness result.

Use Node.js 24+ on a host that can reach that loopback listener:

```bash
export NUMINA_NIM_BASE_URL=http://127.0.0.1:8000/v1
export NUMINA_NIM_MODEL=meta/llama-3.1-8b-instruct
node verify-nvidia-nim.mjs nim-readiness.json
```

This fresh observation checks both health endpoints, the exact model ID and a completed discovery-tool round trip against the existing Numina release. It exits nonzero on failure and writes each result separately without saving provider credentials or model output. It refuses to overwrite an existing observation. `NVIDIA_API_KEY` is optional for an authenticated HTTPS gateway and is sent only to the configured NIM endpoint; `NGC_API_KEY` is for registry/model access and is not automatically reused as an inference credential.

Public multi-user enablement remains a separate operation: verify the applicable NVIDIA subscription/program license, covered hardware and model rights, then validate the TLS gateway, per-user authorization, tenant isolation and resource limits. An endpoint check or builder-signed Numina source statement cannot verify an NVIDIA entitlement. The probe therefore always leaves public-service readiness false; it makes no treasury write or financial submission.

References: [NGC keys](https://docs.nvidia.com/ngc/latest/ngc-user-guide.html), [NIM 1.8 startup](https://docs.nvidia.com/nim/large-language-models/1.8.0/getting-started.html), [NIM tools and MCP](https://docs.nvidia.com/nim/large-language-models/latest/advanced-use-cases/tool-calling-and-mcp.html), [NIM 1.15 support matrix](https://docs.nvidia.com/nim/large-language-models/1.15.0/supported-models.html), [NVIDIA product-specific terms](https://www.nvidia.com/en-us/agreements/enterprise-software/product-specific-terms-for-ai-products/).
