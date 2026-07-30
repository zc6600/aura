# Generative Town Simulation via Host-Subagent Architecture

An empirical evaluation testing whether an isolated Host-Agent & Subagent orchestration model can replicate multi-agent social dynamics (Stanford Smallville Benchmark).

---

## 🔬 Experiment Architecture

- **Host-Agent**: Broadcasts objective environmental clock signals (`08:00 AM`, `11:00 AM`, `14:00 PM`, `17:00 PM`, `21:00 PM`) without plot hints or prompt leakage.
- **25 Subagent Instances**: Each resident agent operates in an isolated SQLite database environment (`.aura-workspace/state/subagents/<id>/state.db`).
- **Asynchronous Mailbox Bus**: Inter-agent communication is conducted purely via structured mailbox tools (`mailbox`), preventing direct prompt contamination.

---

## 📊 Experimental Setup & Metrics

| Parameter | Specification |
|---|---|
| **Time Step Resolution** | 3 Hours Interval |
| **Simulation Roster** | 25 Subagent Instances |
| **Simulated Scope** | Day 1 (08:00 AM - 21:00 PM) |
| **State Storage** | Per-agent SQLite DB |
| **Interaction Graph** | Auto-generated via PEP 723 script (`visualize_town_graph.py`) |

---

## 🚀 How to Run & View

### 1. View Academic Showcase Web UI
```bash
aura dashboard -p 7788
```
Open `http://localhost:7788/` in your browser to view the clean result showcase display.

### 2. Execute 25-Agent Simulation
```bash
python3 run_real_25_town.py
```

### 3. Generate Agent Interaction Network Graph
```bash
uv run visualize_town_graph.py
```
Output: `state/town_interaction_network.png`
