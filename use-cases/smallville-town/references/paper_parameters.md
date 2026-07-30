# Stanford Generative Agents (Smallville) Paper Parameters

> **Paper**: *Generative Agents: Interactive Simulacra of Human Behavior* (arXiv:2304.03442)

## 1. Memory Retrieval Score Formula
$$Score = \alpha_{recency} \cdot Recency + \alpha_{importance} \cdot Importance + \alpha_{relevance} \cdot Relevance$$

- $\alpha_{recency} = 1.0$
- $\alpha_{importance} = 1.0$
- $\alpha_{relevance} = 1.0$
- $Recency = 0.99^{\Delta t}$ ($\Delta t$ is game hours since last memory access)
- $Importance \in [1, 10]$ (Scored via LLM prompt)
- $Relevance = \cos(\vec{q}, \vec{m})$ (Cosine similarity of vector embeddings)

## 2. Reflection Architecture Parameters
- **Accumulated Importance Threshold**: $\sum Importance \ge 150$ (Triggers reflection phase when cumulative new observation importance reaches 150)
- **Top Memories Inspected**: Top 100 recent memories
- **Generated High-Level Insights**: 3 key questions per reflection cycle

## 3. Time Steps & Planning Granularity
- **Simulation Tick Size**: 15 seconds per game tick
- **Coarse Schedule**: Hourly blocks (e.g., 8:00 AM Cafe Opening)
- **Fine Schedule**: 5 to 15-minute action chunks
- **Dynamic Reaction**: Triggered when interacting with another agent or encountering an environmental barrier.
