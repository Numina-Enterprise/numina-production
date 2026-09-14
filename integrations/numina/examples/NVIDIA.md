# NVIDIA NIM host integration

The adapter uses NIM's OpenAI-compatible Chat Completions API. It checks the Numina application and rc26 identity before requesting a model response, exposes the existing discovery tools, and validates the entire bounded tool batch before execution. It creates no new root, journal or treasury. A model response is not a FINAL receipt or proof of hardware deployment.

Use an already configured host SDK:

```js
import {nvidiaNimRoundTrip} from './nvidia-nim.mjs';
const response=await nvidiaNimRoundTrip({
  endpoint:process.env.NUMINA_NIM_BASE_URL,
  model:process.env.NUMINA_NIM_MODEL,
  createProvider:options=>new OpenAI({...options,apiKey:process.env.NVIDIA_API_KEY}),
  messages:[{role:'user',content:'Read the current Numina release.'}]
});
```

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

References: [NIM tools and MCP](https://docs.nvidia.com/nim/large-language-models/latest/advanced-use-cases/tool-calling-and-mcp.html), [NIM 1.15 support matrix](https://docs.nvidia.com/nim/large-language-models/1.15.0/supported-models.html), [NVIDIA product-specific terms](https://www.nvidia.com/en-us/agreements/enterprise-software/product-specific-terms-for-ai-products/).
