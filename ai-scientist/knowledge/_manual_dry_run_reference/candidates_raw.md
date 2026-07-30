# Stage 1: Raw Literature Sweep — Bandit / Online Learning (2026-07-30)

Subfield: multi-armed bandits, contextual bandits, non-stationary/restless bandits, best-arm identification.
Recency window: ~2024-2026. Method: WebSearch for recent papers + WebFetch of the actual paper page/full text to pull verbatim quotes (search-engine summaries are not accepted as quotes — several candidates below were rejected specifically because a verbatim statement could not be located).

---

### cand_001 — Whittle Indices for Restless Bandits with Non-Stationary Transition Kernels
- Shisher, Tripathi, Chiang, Brinton. arXiv:2506.18186 (2025).
- Verbatim (Section 7, Conclusions and Future Work):
  > "An interesting direction of future work involves proving lower bounds for regret."
  > "Other future directions include extending this work to infinite or continuous state spaces, and designing algorithms that achieve sub-linear dynamic regret even for large V_n (rapidly varying kernels)."
- Source verified by fetching full text at arxiv.org/html/2506.18186 (not just the abstract page).

### cand_002 — Explore-then-Commit for Nonstationary Linear Bandits with Latent Dynamics
- arXiv:2510.16208 (2025).
- Verbatim (Section 8, Conclusion):
  > "A natural direction for future work is to move beyond open-loop policies toward adaptive strategies."
  > extending to feedback/closed-loop designs is "both challenging and an important direction for future research."
- Also noted in the paper: current regret bound is Õ(T^(2/3)), commit-phase optimization is NP-hard (solved via SDP relaxation).
- Source verified by fetching full text at arxiv.org/html/2510.16208.

### cand_003 — A Practical Algorithm for Feature-Rich, Non-Stationary Bandit Problems ("C3")
- arXiv:2603.16755 (2026).
- Verbatim (Section 7, Conclusion and Future Works):
  > "While this work contributes to the practical side of bandit algorithms, future works should include obtaining a non-stationary bound that extends the stationary regret bound in Theorem 3."
- Verbatim (Section 6, Limitations):
  > "The transductive learning aspect and importance weight updates can result in high numerical instability since it relies on many sum and division operations of floating points."
  > "The performance of C₃ is dependent on heuristics and whether the learned embedding space is well-calibrated."
- Source verified by fetching full text at arxiv.org/html/2603.16755.
- **Flag**: the base algorithm ("C3": transductive learning + importance weighting) is non-trivial to reimplement faithfully from limitation-section fragments alone — a full read of the method section is required before this is actionable.

---

## Rejected at the raw stage — no verbatim quote obtained

These were found via WebSearch and looked plausible from the search engine's summary, but direct WebFetch of the paper (abstract page, in these cases — full text wasn't reachable) did not turn up an explicit, quotable limitations/future-work statement. Per the skill's own rule, a paraphrase from a search summary is not evidence — these are logged as rejected-for-now, not discarded from future sweeps.

- **cand_004** — "A Modularized Framework for Piecewise-Stationary Restless Bandits" (arXiv:2604.10177, AISTATS 2026 Spotlight). WebFetch of the abstract page found no explicit stated limitation.
- **cand_005** — "Non-Stationary Lipschitz Bandits" (arXiv:2505.18871). WebFetch of the abstract page found no explicit stated limitation.
- **cand_006** — "Open Problem: Optimal Best Arm Identification with Fixed Budget" (arXiv:2303.00950 / COLT workshop). Outside the ~2-year recency window (2023) and not independently re-verified as still-open by a more recent source.
- **cand_007** — "Variance-Dependent Regret Lower Bounds for Contextual Bandits" (OpenReview id kXdW2KySK5) — claimed via search summary to identify "first-order regret bounds for contextual bandits remain an open problem." WebFetch could not load the actual OpenReview content (login/verification wall) — quote unverified.
- **cand_008** — "Optimal Best-Arm Identification under Fixed Confidence with Multiple Optima" (arXiv:2505.15643). WebFetch of the abstract page found no explicit stated limitation.
