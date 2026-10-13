[简体中文](README.zh-CN.md) | [中文 usage guide](docs/使用指南.md) | [Agent setup prompt](docs/agent-setup-prompt.md)

# ABAP AI Workbench MCP

`abap-ai-workbench-mcp` is an AI-native ABAP workbench for SAP teams. Developers are the primary users, followed by business consultants and operations. The default `focused` entry point follows the Focused/Expert model used by `vibing-steampunk`: expose the practical daily surface first, and keep the complete low-level ADT surface for explicit expert use. It embeds the ADT client under `src/adt/`, so the runtime does not depend on the external `abap-adt-api` package.

## Current release

- Version `0.9.2`, published as `abap-ai-workbench-mcp@0.9.2`. 0.9.0 = MCP v2 dual-era (native 2026-07-28 + 2025 compatibility); 0.9.1 = capability consolidation batch (62/71); 0.9.2 = `analysis.lint` & `rfc.helper-bridge` promotions (64/71) + the controlled repository import chain.
- Repository: [`KylinYZ/mcp-abap-adt`](https://github.com/KylinYZ/mcp-abap-adt).
- The unscoped upstream package is a separate project; always use the scoped name.
- Role entry points: `focused`/`developer` (150 development tools), `business` (18 read-only tools), `operations` (49 read-only tools), and `expert` (203 compatibility tools). Legacy profile names remain supported; see [`docs/产品定位.md`](docs/产品定位.md).
- Repository creation catalog: 31 kinds; `REAL_DEV_VERIFIED=28`, `CONTROLLED_IMPLEMENTED=1`, `AUTOMATION_VERIFIED=2`. The checked-in maturity manifest is the authority: [`docs/evidence/repository-creation-maturity-evidence.json`](docs/evidence/repository-creation-maturity-evidence.json).
- Automation baseline (2026-10-13): 198 Jest suites, 2189 tests.

## Install

### npm (recommended)

```bash
npx -y abap-ai-workbench-mcp@0.9.2
```

Example MCP configuration:

```json
{
  "mcpServers": {
    "abap-ai-workbench-mcp": {
      "command": "npx",
      "args": ["-y", "abap-ai-workbench-mcp@0.9.2"],
      "env": { "SAP_MCP_ENV_FILE": "C:\\path\\to\\sap-dev.env" }
    }
  }
}
```

### Source

Requires Node.js 22.14+ (Node 18/20 are EOL and unsupported from 0.7.0; on
Windows switch via nvm-windows using the repo `.nvmrc`).

```bash
npm install
npm run build
node dist/index.js
```

Use an absolute `dist/index.js` path in an MCP client when testing unpublished changes. Keep credentials outside the repository; `.env.example` lists supported fields.

## Profiles

`focused` and `developer` are aliases for the developer workbench (`development-workbench`). `business`, `operations`, and `expert` are aliases for the business-readonly, operations-readonly, and legacy-full surfaces. The older profile names remain supported for compatibility; `safe` is still available when a minimal guarded surface is required.

QAS, PRD, missing, and unknown system roles remain local/read-only regardless of profile. Raw mutation tools never bypass these role gates.

## Quick start

With the default `focused` entry point, call `sapDoctor` first, then `sap` with `action=help`. Use `action=read` for source, `action=search` for object discovery, `action=diagnose` for system/runtime triage, and `action=edit` to create a guarded source preview. `sapDoctor` is read-only; edits still use the existing server plan and confirmation workflow.

## Guarded workflows

All remote mutations use a server-generated preview plan, one native confirmation, and a single apply. Caller-supplied confirmation flags, URLs, XML/JSON payloads, media types, and lock handles are not accepted. An uncertain remote result is terminal: inspect SAP state and create a new plan; never replay the old plan.

For source changes:

1. Read the complete source with `inspectAbapObject`.
2. Preview with `previewAbapChange` and an existing unreleased transport.
3. Review the returned diff.
4. Apply only the returned `changePlanId`.
5. Check `getAbapChangeStatus` for syntax, activation, hash, and unlock results.

For repository objects, use the five `list/describe/preview/apply/status` tools. Cleanup is a separate destructive workflow and is only exposed during explicitly scoped DEV validation. Current per-kind evidence and blocked identities are listed under [`docs/evidence/`](docs/evidence/).

## Configuration and limits

Copy `.env.example` to a private environment file and set at least `SAP_URL`, `SAP_USER`, `SAP_PASSWORD`, `SAP_CLIENT`, `SAP_MCP_TOOL_PROFILE`, and `SAP_MCP_SYSTEM_ROLE`. Keep `SAP_MCP_MAX_CONCURRENT_TOOLS=1` unless a separately verified deployment requires another value. Query, search, argument, response, source-cache, plan, and audit limits are validated at startup.

## Documentation map

- [`docs/使用指南.md`](docs/使用指南.md): Chinese installation, configuration, tool catalog, safe operations, troubleshooting, and verification boundaries.
- [`docs/agent-setup-prompt.md`](docs/agent-setup-prompt.md): copy-paste prompt that lets any AI agent install and configure this MCP server automatically.
- [`docs/evidence/repository-validation-campaign-matrix.md`](docs/evidence/repository-validation-campaign-matrix.md): current 31-kind status.
- [`docs/evidence/repository-creation-productionization-handoff.md`](docs/evidence/repository-creation-productionization-handoff.md): concise handoff and next actions.
- [`PROGRESS.md`](PROGRESS.md): current progress summary.
- [`BLOCKED.md`](BLOCKED.md): active blockers and historical issue index.
- [`CHANGELOG.md`](CHANGELOG.md): release history.

## Development

```bash
npm test -- --runInBand
npm run build
npm run check:repository-creation-coverage
git diff --check
```

Real SAP smoke scripts require explicit authorization and a dedicated DEV environment file. Automated tests and local builds do not prove deployment or live SAP behavior.

## License

MIT. The embedded upstream client remains attributed in [`third-party/abap-adt-api/LICENSE`](third-party/abap-adt-api/LICENSE).
