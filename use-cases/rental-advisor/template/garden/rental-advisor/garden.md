# Rental Advisor Garden

This workspace demonstrates a renting-advice agent for Singapore.

The initial data source is 99.co. The tool boundary is intentionally narrow:
the agent asks `rental_search` for listing data, then performs reasoning and
advice in natural language. This keeps source access auditable and lets future
versions add PropertyGuru, SRX, internal CRM listings, or commute APIs without
changing the agent procedure.

Useful files:

- `params/rental_advisor.yml`: default preferences and source mode.
- `tools/rental_search`: controlled listing lookup tool.
- `reports/rental_advice.md`: final advice report.

