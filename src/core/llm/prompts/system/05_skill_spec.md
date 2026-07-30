# SKILL SPEC
- Skill directory: `/skills/<name>/` (`SKILL.md`).
- Multi-step playbooks orchestrate multiple tool calls for complex workflows.
- The skill index below (name, description, requires, path) is a table of contents, not the skill. It does not contain the actual protocol, gates, stages, schemas, or rules.
- Before executing any skill, you MUST `read_file` its full `SKILL.md` at the given path first. Do not infer the procedure from the one-line description — it is a pointer, not a substitute for the body. Only after reading it should you begin following its stages.
