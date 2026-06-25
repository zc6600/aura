# Rental Advisor Use Case

Rental Advisor is an Aura use-case package for a renting-advice agent. The
agent reads the user's housing preferences, calls a controlled rental-search
tool, and returns ranked rental suggestions with tradeoffs and follow-up checks.

This first version uses Singapore rentals on 99.co as the example source. It
supports:

- `offline` mode: stable sample listings for demos and tests.
- `live` mode: fetches `https://www.99.co/singapore/rent` and parses visible
  listing text. Live parsing is best-effort because public listing pages can
  change.

```bash
aura new ~/rentals/singapore
cd ~/rentals/singapore

python /path/to/aura/use-cases/rental-advisor/scripts/bootstrap.py \
  --area "one-north" \
  --budget 4200 \
  --mode offline

aura workflow doctor
aura kernel run_call rental_search '{"action":"search","area":"one-north","max_budget":4200,"bedrooms":1}'
```

After bootstrap, users should mainly edit `params/rental_advisor.yml`.

Example user request:

> I work near one-north. Find a 1-bedroom or studio in Singapore under S$4,200,
> close to MRT, furnished, and suitable for moving in within one month.

