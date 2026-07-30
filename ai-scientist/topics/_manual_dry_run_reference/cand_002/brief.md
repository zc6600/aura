# Topic Brief: cand_002 — Adaptive (Closed-Loop) Policy vs. Open-Loop ETC for Nonstationary Linear Bandits with Latent Dynamics

## Hypothesis
A heuristic adaptive/closed-loop policy (recursive state tracking + adaptive re-commit triggering) achieves lower cumulative regret than the paper's open-loop explore-then-commit (ETC) policy, in the same latent-dynamics nonstationary linear bandit setting the paper studies.

## Why Open
arXiv:2510.16208 (2025), Section 8 (verbatim, confirmed via full-text fetch):
> "A natural direction for future work is to move beyond open-loop policies toward adaptive strategies."

The paper further notes that a fully optimal closed-loop policy is "both challenging and an important direction for future research" because optimal feedback policies are nonlinear in the estimated latent state. This brief does not attempt that theoretical result — it targets the empirical, reachable version: does *some* adaptive heuristic beat the open-loop baseline, even without a proof of optimality.

## Verifier Design
1. Implement a simplified version of the paper's latent-AR-dynamics linear bandit environment (reward = linear function of context + latent AR(1)-style drifting parameter).
2. Reimplement the paper's open-loop ETC baseline (explore phase of fixed length, commit phase using the SDP-relaxed estimate from the explore phase, per the paper's approach to the NP-hard commit optimization).
3. Implement the candidate adaptive policy: recursive least-squares (or Kalman-filter-style) tracking of the latent parameter, with commit-phase re-triggering when tracked drift exceeds a threshold.
4. Run both over >=30 seeds across several latent-drift-rate regimes (slow/medium/fast).
5. **Pass condition**: candidate achieves statistically significantly lower mean cumulative regret than the open-loop baseline (paired test across matched seeds/environments, p<0.05) in at least the medium/fast drift regimes, without regressing in the slow-drift regime where open-loop ETC is already near-optimal.

## Baseline(s) to Beat
- The paper's own open-loop ETC algorithm, at matched drift-rate settings.

## Compute Estimate
Pure numpy, low-dimensional linear bandit simulation (a handful of context dimensions), seconds per run, full seed/regime sweep in low minutes on CPU.

## Novelty Risk
Adaptive/closed-loop control under a partially observed drifting parameter is a well-studied idea in adaptive control and non-stationary bandits generally — the specific novelty claim is scoped to this paper's exact setting (linear bandit + latent AR dynamics + NP-hard commit optimization), which the paper itself says nobody has tested against an adaptive alternative yet. Flag in any writeup that this is an empirical existence proof ("an adaptive heuristic can beat this specific open-loop baseline"), not a general theoretical result.
