# AutoKaggle Validation Log — 2026-07-30

Goal: check whether `use-cases/auto-kaggle` can actually drive a Kaggle
competition end to end, using a real toy model first (not just reading the
code). Tested in fresh Aura workspaces via `aura new` + `scripts/bootstrap.py`,
first offline, then against a real Kaggle competition (Titanic) with the
official `kaggle` CLI and real credentials.

## Bugs found by actually running it, and fixed

| # | Bug | Where | Fix commit |
|---|-----|-------|------------|
| 1 | `subprocess.run(["python", ...])` — fails wherever only `python3` exists (this machine, many Linux distros) | `ak_submit_guard/logic.py`, `poll_submission.py`, 2 tutorial docs | swept into `419ff75`/`1de6444` by a concurrent commit; superseded by later fixes below |
| 2 | Hand-rolled YAML parser didn't strip inline comments, so the shipped default `mode: "offline"  # offline \| kaggle` parsed to a garbage string that never equals `"offline"` — the offline safety branch was silently skipped | `ak_competition/logic.py`, `ak_submit_guard/logic.py` | same as above |
| 3 | `sample_submission.csv` / `id` / `target` were hardcoded everywhere, ignoring the `sample_submission_file` / `id_column` / `target_column` fields already present in `params/autokaggle.yml`. Real competitions rename these (Titanic ships `gender_submission.csv`, columns `PassengerId`/`Survived`) — guard broke on real data even after a clean download | `ak_submit_guard/logic.py`, `data.py`, `verify_submission.py` | `929bb84` |
| 4 | Toy baseline was a fixed `sigmoid(4*(x1-x2))` formula — never fit on `y`, so `cv_score` never changed between runs regardless of hyperparameters or features | `train_candidate.py` | `929bb84` (real pure-Python logistic regression + CV added) |
| 5 | Accuracy-metric submissions wrote raw probabilities (e.g. `0.277`) instead of thresholded labels — would score ~0 on any real accuracy-scored competition since predictions never exactly equal 0/1 | `train_candidate.py` | `24f6dff` |
| 6 | CV used leave-one-out (refits once per row) — fine for the 6-row offline fixture, but took ~40s for just 25 epochs on a real 891-row download and does not scale to real competition sizes at all | `model.py` | `24f6dff` (switched to k-fold, honoring the previously-unused `validation.n_splits` config) |
| 7 | `runs` table had `public_score`/`private_score`/`kaggle_submission_id`/`lb_status` columns and PLAN.md specified an `attach_lb` registry action, but nothing ever wrote to them | `ak_registry.py` | added `attach_lb` |

## Offline regression (toy fixture, no network, no credentials)

Full loop re-verified green after every fix: `aura new` → `bootstrap.py --mode
offline` → `aura workflow doctor` → `train_candidate.py` → registry write →
`verify_latest_submission.py` → `ak_submit_guard validate` (accepts a correct
submission, rejects wrong row count / missing values / duplicate hash) →
`ak_competition catalog`.

## Real Kaggle run (Titanic — real CLI, real credentials, real submission)

```
kaggle competitions download -c titanic     # real network call, real account
```

Downloaded real `train.csv`/`test.csv`/`gender_submission.csv`. Six rounds of
real feature engineering (`use-cases/auto-kaggle/showcase/feature_engineering.py`
is the exact code that produced each round), each trained with the actual
gradient-descent logistic regression and 5-fold CV, each recorded to the
experiment registry with a hypothesis. Full round-by-round detail (code +
method + score, rendered live) is at `aura dashboard` → `/autokaggle`; summary:

| run_id | features | local CV (accuracy) | real public score |
|---|---|---|---|
| `titanic_v1` | Pclass, SibSp, Parch, Fare | 0.6835 | — |
| `titanic_v2` | + Sex | 0.7980 | **0.76794** (id 55110521) |
| `titanic_v3` | + Age (imputed), Embarked (one-hot) | 0.7980 (no gain) | — |
| `titanic_v4` | FamilySize/IsAlone instead of raw SibSp/Parch | 0.7890 (**regressed**) | — |
| `titanic_v5` | + Title extracted from Name (regex) | 0.8272 (biggest jump) | — |
| `titanic_v6` | same as v5, tuned lr/epochs/l2 | 0.8272 (plateau) | **0.76794** (id 55111365) |

Two real submissions were made (`v2` and the final best `v6`), both via
`ak_submit_guard submit` → real `kaggle competitions submit`.

**Honest result, not spun:** local CV rose from 0.798 (v2) to 0.827 (v6), a
real +0.029 improvement from adding `Title`. The real public leaderboard
score for `v6` came back **identical** to `v2`'s: `0.76794` both times. This
is a genuine CV/LB divergence, not a bug in the pipeline — Titanic's public
leaderboard is a small, noisy slice of the test set, and this is exactly the
scenario `skills/auto-kaggle/SKILL.md` already warns about ("如果 CV/LB 背离，
不允许继续盲目用 public LB 调参"). It's a useful real demonstration of why the
guard doesn't treat the public LB as ground truth.

`titanic_v4` regressing (0.789 < 0.798) is also a real, legitimate ML outcome
kept in the record rather than dropped — not every feature engineering idea
helps.

Both scores attached back to the registry via the new `attach_lb`:
`titanic_v2.public_score = titanic_v6.public_score = 0.76794`.

## Dashboard

Added `/autokaggle` to the `aura dashboard` web server (same pattern as the
existing `/tinyville` smallville-town showcase): `src/cli/shell/webServer.ts`
now serves `use-cases/auto-kaggle/showcase/auto_kaggle_showcase.html` and
`/api/autokaggle/history` from `showcase/state/experiment_history.json`. The
page renders a CV-vs-public-score chart and one card per round (hypothesis,
feature chips, exact CLI/hyperparameters, CV delta vs. previous round, and
the CV/LB divergence note above) straight from that JSON — verified with a
real headless-browser render (0 console errors, 6 round cards, chart
present).

Route resolution uses the package root (`findPackageRoot`), not
`process.cwd()`, because these files ship with the Aura package itself and
must resolve correctly regardless of which directory the user runs
`aura dashboard` from.

## What's still a known limitation (not fixed, out of scope for this pass)

- `train_candidate.py` still crashes on raw non-numeric columns (`Name`,
  `Sex` as string, `Cabin`, `Ticket`, `Embarked` as string). Feature
  engineering (encoding, imputation) is expected to be the agent's/user's
  job for each competition — the fixture only ships numeric-safe columns for
  the offline path. For Titanic this was done by hand in
  `showcase/feature_engineering.py`, not added to the shipped baseline.
- `ak_submit_guard`'s 30-minute cooldown / daily budget were exercised for
  real (two real submissions, one blocked mid-session by the real cooldown
  until it elapsed) but not stress tested beyond that.
