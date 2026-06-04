# Chapter 6: Seeds — Capturing Uncertainty

"Seeds" represent the initial goals, specifications, and checklists that guide the execution path of the agent. They capture the structured uncertainties that are cultivated into resolved engineering solutions over time.

## Lightweight checklists: `task.md`

In the root of the workspace (and mirrored in `.aura/task.md`), a lightweight `task.md` file serves as the immediate checklist for the active agent run. This checklist is edited dynamically by the agent as it completes sub-tasks or discovers new blockers. Injected directly into the prompt context, `task.md` provides a visible, high-priority target state.

## Step Anchors and the Anchor Graph

For long-horizon, multi-stage pipelines where sequential dependency is critical, Aura uses the **`anchors/` directory**.
- Anchors are represented by individual JSON or YAML files (e.g. `anchors/01_baseline_verified.json`).
- Each anchor contains a unique `id` and a `call_when` array defining the physical verification conditions required to unlock the step.

Example:
```json
{
  "id": "01_baseline_verified",
  "call_when": ["Baseline benchmarks have been run and recorded in task.md"]
}
```

The `AnchorProvider` scans this directory, compares the nodes against the active checklist and database state, and compiles a stateful progress map. This keeps the agent anchored on the current phase, preventing it from skipping critical validation steps or getting stuck in infinite loops.
