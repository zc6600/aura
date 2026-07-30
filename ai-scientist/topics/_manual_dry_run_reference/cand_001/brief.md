# Topic Brief: cand_001 — Variation-Adaptive Whittle Index Estimation for Rapidly-Varying Restless Bandits

## Hypothesis
A variation-adaptive online Whittle-index estimator (e.g. sliding-window or forgetting-factor index update) achieves lower dynamic regret than a fixed-window online Whittle-index baseline, specifically in the high-variation-budget regime (V_n not o(T)) that the source paper explicitly leaves unresolved.

## Why Open
Shisher, Tripathi, Chiang, Brinton, arXiv:2506.18186 (2025), Section 7 (verbatim, confirmed via full-text fetch):
> "Other future directions include extending this work to infinite or continuous state spaces, and designing algorithms that achieve sub-linear dynamic regret even for large V_n (rapidly varying kernels)."

This brief targets only the third thread (rapidly-varying kernels). The other two threads (regret lower bounds, continuous state spaces) are proof-theoretic / scope-expansion problems, not reachable as a CPU-only empirical experiment, and are explicitly out of scope here.

## Verifier Design
1. Construct small finite-state restless bandit environments (2-5 states per arm, 3-8 arms), each arm a Markov chain with a time-varying transition kernel. Control the variation rate directly via a parameter V_n swept from "slow" (paper's tested regime) to "fast" (the flagged unresolved regime).
2. Implement the paper's online Whittle-index baseline (fixed-window kernel estimation feeding index computation via bisection over subsidy).
3. Implement the candidate: same index computation, but with a sliding-window or exponential-forgetting kernel estimator whose window/decay adapts to detected variation rate.
4. Run both over >=30 seeds per V_n setting. Record cumulative dynamic regret against the (numerically computable, since state spaces are small) optimal time-varying policy.
5. **Pass condition**: candidate achieves statistically significantly lower mean dynamic regret than baseline at high V_n (non-overlapping 95% CIs or paired t-test, p<0.05), while not regressing at low V_n (the regime the baseline was already designed for).

## Baseline(s) to Beat
- The paper's own fixed-window online Whittle-index algorithm, at matched V_n settings.

## Compute Estimate
Pure Python/numpy, finite-state MDPs, sub-second per episode, full sweep (multiple V_n x 30+ seeds) in low minutes on a single CPU core.

## Novelty Risk
Sliding-window / forgetting-factor adaptations are a known general technique in non-stationary online learning (used elsewhere for non-stationary bandits/MDPs) — the novelty claim here is narrow: applying it specifically to Whittle-index estimation under kernel drift, which is what the source paper says nobody has done. This should be treated as an incremental, not foundational, contribution — flag explicitly in any eventual writeup rather than oversell it.
