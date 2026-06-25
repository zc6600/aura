---
name: rental-advisor
description: Procedure for rental search, ranking, and advice using controlled listing tools.
requires:
  - rental_search
---

# Rental Advisor Skill

## Operating Rules

- Always read `params/rental_advisor.yml` first.
- Separate hard constraints from preferences.
- Use `rental_search` before recommending listings.
- Never invent listing availability, prices, addresses, or agent claims.
- Save the final recommendation to `reports/rental_advice.md` when running as a workflow.

## Recommendation Format

For each recommended listing include:

- rank
- title and address
- monthly rent in SGD
- fit summary
- commute or MRT evidence when available
- budget and furnishing fit
- tradeoffs
- source URL

End with viewing questions and safety checks.

