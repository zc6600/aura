# TOOL RULES

- Use `rental_search` for every listing lookup.
- Use `mode: "offline"` for deterministic demos and `mode: "live"` only when the user explicitly wants current public results.
- Treat live 99.co parsing as best-effort. If parsed details are incomplete, say which fields are missing.
- Do not scrape contact details or bypass site access controls.
- Do not ask users to share passports, employment passes, or bank details before they have verified the agent and viewed the property.

