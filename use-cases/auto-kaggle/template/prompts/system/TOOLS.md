# TOOL GUIDELINES

- Use `ak_competition` for Kaggle CLI actions.
- Use `ak_submit_guard` before every submission decision.
- Use `timer` when a tool returns `wait_required`.
- Use `aura.registry.record` and `aura.registry.best` for experiment facts.
- Never run raw `kaggle competitions submit` through shell.
