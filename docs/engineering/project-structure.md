# Project Structure

This project is a Node.js agent platform with four runtime surfaces:

- API service: root `server.js`, `routes/`, `services/`, `platform/`, `utils/`
- Local data/model tools: `ContextHelper/`, `DirectDbRunner/`, `ModelTool/`
- Console app: `console/`
- Runtime/config assets: `scene-configs/`, `references/`, `runtime-assets/`, `metadata/`

## Current Layout

```text
.
├── server.js                  # API service entrypoint
├── routes/                    # HTTP route adapters
├── services/                  # API application services
├── platform/                  # workflow compiler/runtime/gateway
├── utils/                     # shared Node.js utilities
├── ContextHelper/             # local context helper service
├── DirectDbRunner/            # local direct database runner service
├── ModelTool/                 # local structured output validation service
├── console/                   # React/Vite console
├── scene-configs/             # scene configuration files
├── references/                # direct-model prompts and schemas
├── runtime-assets/            # bundled OpenClaw runtime assets
├── metadata/                  # local business dictionaries/metadata
├── scripts/                   # maintenance, verification, migration scripts
├── deploy/                    # launchd deployment templates
├── docs/                      # engineering and integration docs
└── tests/                     # regression fixtures and tests
```

## Ownership Rules

- `routes/` should only parse HTTP input, call services, and return response payloads.
- `services/` owns application behavior, scene loading, release logic, console data, and persistence adapters.
- `platform/` owns workflow compilation, runtime state, gateway orchestration, and node execution.
- `utils/` is for small shared primitives only; business logic should not move here.
- `ContextHelper/`, `DirectDbRunner/`, and `ModelTool/` are independent local services. Cross-service reuse should go through `utils/` or a clearly named shared module.
- `console/` is a separate frontend app. Backend code should not import frontend modules.
- `scene-configs/`, `references/`, `runtime-assets/`, and `metadata/` are runtime assets. Code should access them through path/config helpers instead of hard-coded absolute paths.

## Git Rules

Tracked:

- source code
- config templates such as `.env.example`
- runtime assets required to reproduce the platform
- docs and examples
- package lock files

Ignored:

- local secrets such as `.env`
- dependencies such as `node_modules/`
- local caches
- logs, temporary files, and build output

## Migration Direction

The current structure is intentionally kept stable because many modules use relative imports. Future structural changes should be split into small steps:

1. Introduce alias helpers or package boundaries.
2. Move one runtime surface at a time.
3. Run structure checks and platform config validation after each move.
4. Update README and launchd templates in the same change.

The likely long-term layout is:

```text
apps/
  api/
  console/
tools/
  context-helper/
  directdb-runner/
  model-tool/
packages/
  platform/
  shared/
configs/
  scenes/
  metadata/
runtime-assets/
scripts/
docs/
```
