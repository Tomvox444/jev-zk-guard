# Jev-ZK Guard — local Cursor

Attestation: **Groth16 zk-SNARK** (`src/zk/prove.ts` vs `src/zk/verify.ts`, separate) plus hash-chained audit. Clearance L1–L3 = agent roles.

## Start control plane

```bash
npm run serve
```

- Guard UI: http://127.0.0.1:8787/
- Fleet chat: http://127.0.0.1:8787/fleet.html
- **Build plan / Build project** → isolated workspace under `data/fleet/workspaces/<runId>/`
- **Build project** runs a **real fleet**: Jev-guarded phases, then Lead finalize

## Fleet routing (complexity)

| Kind | Bucket | Role |
|------|--------|------|
| Visual design / brand / hero / landing layout | **high** | Lead |
| Integration / polish / structure | medium | Reviewer |
| Pure copy / product story / use-cases text / CTA wording | **low** | Hands |

## Lead planner → briefs

The Lead orchestrator (`leadPlan`) emits an **operative brief** per task: objective, deliverables, constraints, doNot, acceptance, handoff. Jev only scores/routes; Build executors **execute the brief** (not a vague “you are Hands…” rewrite of the whole goal). `PLAN.md` includes full briefs; finalize has its own brief (polish, don’t redesign).

## Build order + guards

1. **high** (Lead) — sequential, `guard` before each phase  
2. **medium** (Reviewer) — sequential, guard each  
3. **low** (Hands) — **parallel batches of 2**, guard each task  
4. **Lead finalize** — last, with guard  

Deny on any phase guard → stop the build (demo safety). Logs show `guard ok` / `guard review` / `guard blocked`. `fleet-phase:*` intents are scored as benign (not sent to OpenRouter as opaque shells). Policy `review` continues with a log line; only `deny` stops.

## Executors (modular)

| `FLEET_EXECUTOR` | Behavior |
|------------------|----------|
| `cursor` (default) | Local Cursor Agent CLI (`agent`) — one CLI call per role/task |
| `noop` | Writes per-task `task-*.md` (parallel-safe); finalize merges into `index.html` |

Builds never write into the guard repo root — only into the run workspace.

## Cursor Agent CLI (demo executor)

```bash
agent login
# or: export CURSOR_API_KEY=...
```

Health shows `exec=cursor|noop` and `cursor=on` when the `agent` binary is found.

- Hooks: `.cursor/hooks.json` → shells go through `/v1/guard`
- Rule: `.cursor/rules/jev-fleet.mdc` (always on)
- Route a goal: `npm run fleet -- "your goal"`

## Env

| Var | Default |
|-----|---------|
| `GUARD_API_SECRET` | `jzg_demo_secret` |
| `JEV_TENANT_ID` | `dev` |
| `JEV_AGENT_ID` | `cursor-junior` (hook) / `fleet-console` (fleet CLI) |
| `JEV_GUARD_URL` | `http://127.0.0.1:8787` |
| `JEV_STUB=1` | force stub Jev (no OpenRouter) |
| `JEV_GUARD_BYPASS=1` | skip shell hook gate |
| `FLEET_WORKSPACE_ROOT` | `data/fleet/workspaces` (per-run sandboxes) |
| `FLEET_EXECUTOR` | `cursor` (default) or `noop` |
| `FLEET_EXECUTOR_REQUIRE=1` | do not fall back to noop if Cursor CLI missing |
