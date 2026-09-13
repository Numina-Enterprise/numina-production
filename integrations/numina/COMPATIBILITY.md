# Numina 3.0 compatibility

Documentation reviewed September 12, 2026. The formats below are implemented in source and generated descriptors. **No 3.0 tests or live provider acceptance checks were run.** The older 0.2.0 checks remain historical evidence only.

| Interface | Host registration | Result format |
| --- | --- | --- |
| OpenAI Responses | `providerTools('openai-responses')` | `function_call_output`, matching `call_id` |
| OpenAI Chat Completions | `providerTools('openai-chat-completions')` | tool message, matching `tool_call_id` |
| Anthropic Messages | `providerTools('anthropic-messages')` | `tool_result`, matching `tool_use_id` |
| Gemini Interactions | `providerTools('gemini-interactions')` | `function_result`, matching `call_id` |
| Gemini GenerateContent | `providerTools('gemini-generate-content')` | `functionResponse` |
| Local MCP stdio | Launch `bin/mcp-stdio.js` | JSON-RPC tool results |
| Other compatible tool hosts | Adapt `schemas/provider-neutral.json` and execute through the client | Host-specific integration required |

OpenAI's two interfaces use different descriptor nesting. Strict JSON inputs reject extra fields. The host must execute calls and return corresponding outputs; a descriptor does not execute itself. [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling).

Anthropic uses `input_schema`; the adapter defaults to strict mode. Preserve complete assistant content and return tool results with their call identifiers. Models/configurations must support the chosen mode. [Claude strict tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use).

Gemini Interactions and GenerateContent are separate adapters. Preserve Interactions conversation identity and GenerateContent model content, including thought signatures. Model-specific schema support and API access remain the host's responsibility. [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling), [FunctionDeclaration](https://ai.google.dev/api/generate-content#FunctionDeclaration).

The local MCP server implements initialization, ping, tools/list and tools/call with newline-delimited stdio. It negotiates **2025-11-25** or **2025-06-18**. It does not implement/advertise 2026-07-28, resources, prompts, sampling, cancellation messages, streaming or Streamable HTTP. A host requiring a different revision must reject the offered revision. [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), [stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

ChatGPT/Claude web apps and provider directories are not automatically connected by this ZIP. A host supporting only a remote MCP URL cannot directly launch this local stdio process. No remote endpoint, marketplace listing, model account installation, TypeScript compiler validation or universal LLM compatibility is claimed.

Runtime-evidence revision: all five provider descriptor formats and local MCP now expose six default discovery tools, including numina_runtime_build. This additive tool uses the existing application-manifest endpoint; it introduces no remote MCP endpoint, provider-specific SDK dependency or model choice. [EVIDENCE.md](EVIDENCE.md) explains the distinction between recorded builder verification and client-side discovery.
