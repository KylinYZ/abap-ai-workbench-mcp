[简体中文](README.zh-CN.md) | [中文 usage guide](docs/使用指南.md) | [Agent setup prompt](docs/agent-setup-prompt.md)

# ABAP AI Workbench MCP

`abap-ai-workbench-mcp` is an AI-native ABAP workbench for SAP teams: developers first, then business consultants and operations. The default `focused` entry exposes the practical daily surface first; the complete low-level ADT surface stays available through `expert`. The ADT client is embedded under `src/adt/`, so the runtime does not depend on the external `abap-adt-api` package.

> **Provenance**: this repository is a secondary-development (fork-based) version of [`mario-andreschak/mcp-abap-abap-adt-api`](https://github.com/mario-andreschak/mcp-abap-abap-adt-api) and serves as the ongoing maintenance and improvement version. The upstream author remains credited under the MIT license (see [`LICENSE`](LICENSE)); the upstream remote is kept for reference.

## Current release

- Version `0.10.1`, published as `abap-ai-workbench-mcp@0.10.1` — response-JSON formatting switch (`SAP_MCP_JSON_PRETTY`) and client-enforced `rowNumber` cap on `tableContents`/`runQuery` (the ADT datapreview service returns one row more than requested). 0.10.0 = S/4HANA low-release adaptation (BASIS 7.50/7.51): release-capability negotiation with per-tool gating, 72-character RFC read-table compatibility, and controlled-creation kind trimming. Full history: [`CHANGELOG.md`](CHANGELOG.md).
- Repository: [`KylinYZ/abap-ai-workbench-mcp`](https://github.com/KylinYZ/abap-ai-workbench-mcp) — the maintenance repo; the previous repo `KylinYZ/mcp-abap-adt` is no longer updated.
- Role entry points: `focused`/`developer` (185 tools), `business` (18), `operations` (58), `expert` (220). Older profiles (`safe`, `development`, `diagnostic-readonly`, `legacy-full`) remain supported; see [`docs/产品定位.md`](docs/产品定位.md).
- Repository creation catalog: 31 kinds — `REAL_DEV_VERIFIED=28`, `CONTROLLED_IMPLEMENTED=1`, `AUTOMATION_VERIFIED=2`. The checked-in manifest is the authority: [`docs/evidence/repository-creation-maturity-evidence.json`](docs/evidence/repository-creation-maturity-evidence.json).
- Automation baseline (2026-10-16): 199 Jest suites, 2244 tests.

## Install

### npm (recommended)

```bash
npx -y abap-ai-workbench-mcp@0.10.1
```

Example MCP configuration:

```json
{
  "mcpServers": {
    "abap-ai-workbench-mcp": {
      "command": "npx",
      "args": ["-y", "abap-ai-workbench-mcp@0.10.1"],
      "env": { "SAP_MCP_ENV_FILE": "C:\\path\\to\\sap-dev.env" }
    }
  }
}
```

### Source

Requires Node.js 22.14+ (Node 18/20 are EOL and unsupported since 0.7.0; on Windows switch via nvm-windows using the repo `.nvmrc`).

```bash
npm install
npm run build
node dist/index.js
```

Use an absolute `dist/index.js` path in an MCP client when testing unpublished changes. Keep credentials outside the repository; `.env.example` lists supported fields.

## Roles and safety

`focused`/`developer` is the developer workbench; `business`, `operations`, and `expert` are the read-only business, read-only operations, and full compatibility surfaces. QAS, PRD, missing, and unknown system roles stay local/read-only regardless of profile.

All remote mutations use a server-generated preview plan, one native confirmation, and a single apply. Caller-supplied confirmation flags, URLs, XML/JSON payloads, media types, and lock handles are not accepted. An uncertain remote result is terminal: inspect SAP state and create a new plan; never replay the old plan.

## Quick start

Call `sapDoctor` first, then `sap` with `action=help`. Use `action=read` for source, `action=search` for object discovery, `action=diagnose` for system/runtime triage, and `action=edit`/`action=create` for guarded previews.

Source changes: `inspectAbapObject` → `previewAbapChange` (with an existing unreleased transport) → review the returned diff → `applyAbapChange` with only the returned `changePlanId` → `getAbapChangeStatus` for syntax, activation, hash, and unlock results. Repository objects use the five `list/describe/preview/apply/status` tools; cleanup is a separate destructive workflow, only exposed in explicitly scoped DEV validation (per-kind evidence under [`docs/evidence/`](docs/evidence/)).

## Configuration

Copy `.env.example` to a private environment file and set at least `SAP_URL`, `SAP_USER`, `SAP_PASSWORD`, `SAP_CLIENT`, `SAP_MCP_TOOL_PROFILE`, and `SAP_MCP_SYSTEM_ROLE`. On older S/4HANA releases (BASIS 7.50/7.51) the server negotiates capabilities automatically; set `SAP_MCP_BASIS_RELEASE` only if the probe fails. Keep `SAP_MCP_MAX_CONCURRENT_TOOLS=1` unless a separately verified deployment requires another value.

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
