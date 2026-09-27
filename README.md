# Jev-ZK Guard

Control plane for **AI agent fleets**: every proposed action is scored by **Jev**, gated by **policy**, attested with a **real Groth16 zk-SNARK** (scores stay private), written to a **tamper-evident audit chain**, then allowed / held / escalated by clearance.

> Agent proposes → Jev scores → Policy decides → **Groth16 prove** → **Groth16 verify (no witness)** → Audit seal → clearance

Built for local Cursor: IDE shells hit the same `/v1/guard` API as the fleet builder.

## Demo URLs (after `npm run serve`)

| UI | URL |
|----|-----|
| Guard control plane | http://127.0.0.1:8787/ |
| Fleet chat / build | http://127.0.0.1:8787/fleet.html |
| Health | http://127.0.0.1:8787/health |

## Quick start

```bash
npm install
cp .env.example .env   # optional — edit secrets / keys
npm run serve
```

Open the Guard UI, switch **Junior L1** / **Lead L3**, propose a safe command (`ls`) then a dangerous one (`cat ~/.ssh/id_rsa`) to see allow vs escalate.

### Live Jev vs stub

- With `OPENROUTER_API_KEY` (or a jevctl keychain entry) and `JEV_STUB` unset: health shows `"jev":"openrouter"`.
- If OpenRouter is unreachable or `JEV_STUB=1`: offline regex stub scores — **same policy / Groth16 / audit / clearance pipeline**.

Check: `curl -s http://127.0.0.1:8787/health` → prefer `"jev":"openrouter"`, `"stubForced":false`.

## Connect your AI fleet

### 1. Cursor IDE shells (always-on gate)

This repo ships Cursor hooks:

- `.cursor/hooks.json` → `beforeShellExecution`
- `.cursor/hooks/jev-guard.mjs` → `POST /v1/guard`

Identity (env, defaults shown):

| Variable | Default |
|----------|---------|
| `JEV_GUARD_URL` | `http://127.0.0.1:8787` |
| `GUARD_API_SECRET` | `jzg_demo_secret` |
| `JEV_TENANT_ID` | `dev` |
| `JEV_AGENT_ID` | `cursor-junior` (L1 hands) |

Use `JEV_AGENT_ID=cursor-lead` for L3 actions. Escape hatch for local debugging only: `JEV_GUARD_BYPASS=1`.

### 2. Fleet builder (multi-role implement)

1. Install / login Cursor Agent CLI:

```bash
agent login
# or: export CURSOR_API_KEY=...
```

2. Ensure health shows a Cursor binary when you want real builds (`cursorAgent: true`). Executor:

| `FLEET_EXECUTOR` | Behavior |
|------------------|----------|
| `cursor` (default) | One `agent` CLI call per role/task (+ finalize) |
| `noop` | Smoke only — writes `task-*.md`, no real coding |

3. In **Fleet chat** (`/fleet.html`):

   - Describe a goal → **Send** (Lead plans + Jev routes complexity)
   - **Build plan** → isolated workspace + `PLAN.md` with operative briefs
   - **Build project** → guarded phases → artifacts under `data/fleet/workspaces/<runId>/`

CLI alternative:

```bash
npm run fleet -- "your goal here"
```

### 3. Register your own agents

Edit [`config/tenants.json`](config/tenants.json):

- `role`: `hands` | `reviewer` | `lead`
- `clearance`: `L1` | `L2` | `L3`
- `maxComplexity`: routing cap (Hands ~0.35, Reviewer ~0.7, Lead ~1.0)
- `escalatesTo`: senior agent id for tickets

Point the UI / hooks at your tenant + agent via `x-tenant-id` / `x-agent-id` (or the env vars above).

## Roles, clearance, and models

| Agent (tenant `dev`) | Role | Clearance | Typical work |
|----------------------|------|-----------|--------------|
| `cursor-junior` | hands | L1 | Low-complexity copy / small tasks |
| `cursor-reviewer` | reviewer | L2 | Medium structure / polish |
| `cursor-lead` / `fleet-console` | lead | L3 | Design, finalize, escalation decisions |

**Cursor models:** all fleet build steps use the **same** local Cursor Agent CLI and your account’s **default model**. Roles differ by **briefs + clearance**, not by a per-role model flag. (Labels like “opus-lead” in sample tenants are names only.)

**Jev model:** `jev-1.13` via OpenRouter Decisions API (`JEV_MODEL` to override) — scores risk; it does not write project files.

## How security works

1. **Jev** — scores `dangerous`, `exfil`, `offPolicy`, `benign` (**private witness**)
2. **Policy** — thresholds → `allow` / `review` / `deny` (**public**)
3. **Groth16 zk-SNARK** ([`circuits/policy.circom`](circuits/policy.circom)):
   - **Prover** ([`src/zk/prove.ts`](src/zk/prove.ts)) knows the scores and emits `{ proof, publicSignals }`
   - **Verifier** ([`src/zk/verify.ts`](src/zk/verify.ts)) checks with the **verification key only** — it never receives the scores
   - Third party: `POST /v1/zk/verify` with `{ proof, publicSignals }` from a guard response
   - L1/L2/L3 labels = decision severity (allow/review/deny); **same circuit**
4. **Audit seal** — hash-chained Ed25519 JSONL for operator forensics (commands in clear on purpose)
5. **Clearance** — agent roles L1/L2/L3 for allow / review / deny escalation

Setup (once): put `circom` in `bin/circom`, then `npm run zk:setup`. Artifacts live under `circuits/build/` (`policy.wasm`, `policy_final.zkey`, `verification_key.json`).

Smoke: `npm run smoke:zk` — proves with witness, verifies **without** witness, rejects tampered public signals.

## Fleet orchestration (modular layout)

| Path | Responsibility |
|------|----------------|
| `src/jev/` | Live Jev (OpenRouter) + stub + complexity routing |
| `src/policy.ts` | Deterministic gates |
| `src/zk/` | Groth16 prove / verify (separated) |
| `circuits/` | Circom policy circuit + build artifacts |
| `src/audit/` | Hash-chained Ed25519 audit log |
| `src/escalation/` | Tickets + clearance |
| `src/fleet/lead-plan.ts` | Lead briefs (objective, doNot, acceptance…) |
| `src/fleet/orchestrate.ts` | Plan → score → assign |
| `src/fleet/jobs.ts` | Plan/build jobs, phase guards, parallel Hands |
| `src/fleet/cursor-bridge.ts` | Cursor Agent CLI adapter |
| `.cursor/hooks/` | IDE shell → guard |

**Build order:** high (Lead) sequential → medium sequential → Hands in parallel (batches of 2) → Lead finalize. Each phase calls `guard` on `fleet-phase:…` before the executor runs.

Lead briefs are the source of truth for builders — see `PLAN.md` in each run workspace.

## Environment

See [`.env.example`](.env.example). Important vars:

| Var | Meaning |
|-----|---------|
| `GUARD_API_SECRET` | Bearer shared with UI / hooks |
| `OPENROUTER_API_KEY` | Live Jev |
| `JEV_STUB=1` | Force stub Jev |
| `JEV_MODEL` | Default `jev-1.13` |
| `FLEET_EXECUTOR` | `cursor` \| `noop` |
| `CURSOR_API_KEY` / `CURSOR_AGENT_BIN` | Fleet builder CLI |

`data/` is gitignored (audit, escalations, workspaces).

## Scripts

```bash
npm run serve              # control plane
npm run typecheck
npm run zk:setup           # compile circom + Groth16 keys (needs bin/circom)
npm run smoke:zk           # prove with witness / verify without
npm run smoke:fleet        # fleet chat API smoke
npm run smoke:fleet-build  # stub Jev + noop executor build smoke
npm run smoke:escalate     # escalation ticket flow
npm run fleet -- "goal"    # CLI orchestrate
```

## Honest scope

- **Real ZK:** Groth16 over policy compliance — private Jev scores, public thresholds/decision/cmdHash. Prover and verifier are **separate modules**; `POST /v1/zk/verify` does not take the witness.
- Trusted setup is a **local demo ceremony** (`npm run zk:setup`), not a multi-party production MPC.
- Audit chain is complementary forensics (not ZK).
- Fleet quality tracks **Lead briefs + executor**, not magic multi-model routing.
- Guard `sim` never executes real shells; Cursor hooks deny/allow the IDE command separately after the verdict.

## License

ISC
