# Carrier 101 + 102 — market access and underwriting rules

**Carrier 101 answers how to reach a market. Carrier 102 answers whether an account may fit.** Both
live in the agency's own, private carrier list and work together in Market Finder.

No agency data is in this repository: markets, contacts, producer codes and rules are entered or
imported by the agency's admin into its own database rows. Tests and examples use synthetic data.

## What changed in the existing architecture

| Piece | Change |
|---|---|
| `agency_carriers` (0023) | **Extended**, not duplicated (migration `0049_carrier_access_and_rules.sql`): access route (direct/indirect), status (ready/partial/not ready/inactive), wholesaler, MGA, carrier paper, portal name/URL, submission email, producer code, appointment, contacts, source, source date, verified date, notes. No credential fields exist. |
| `agency_carrier_rules` (new) | One row per underwriting rule of one market — see below. Same RLS shape as 0023: agency members read, agency admins write, other agencies see nothing, no deletes (archive). |
| `import_agency_carrier_directory` (new RPC) | Admin-only, reviewed import with a dry run. Matches markets by import reference, then by name. **Never changes a market's existing appetite criteria** and never deletes. Logged in `agency_carrier_imports`. |
| Matching engine (`services/appetite`) | Markets with access details or rules are matched on their rules (`carrierRules.ts`), coverage by coverage, plus whatever built-in criteria are *verified* for them (unknown built-in criteria step aside; nothing is overwritten). Built-in markets match exactly as before. Inactive markets are never suggested. |
| Market Finder / account Carrier Appetite | Cards show access status, the intermediary chain and per-coverage verdicts; the market drawer adds **How to submit**, **By coverage**, passed/failed/review/confirm counts and the market's rules with source and verification. |
| Market Access Directory (new page) | `/market-finder/directory`: search and filter by status/route; open a market for route, contacts and rules. Admins edit access, add/verify/remove rules and import. |

## Carrier 102 — rule structure

| Field | Values |
|---|---|
| coverage | every coverage, or one line (Auto Liability, Motor Truck Cargo, Physical Damage, …) |
| category | state, commodity, operation type, radius, fleet size, years in business, driver age, driver experience, vehicle type, vehicle age, claims (3 yrs), telematics, dash cameras, DOT number, coverage written, other |
| test + value | any of (list), under / over / between (numbers), none, missing, text |
| answer | YES · NO · REFERRAL · UNKNOWN |
| strength | Hard · Soft · Informational |
| conditions | further tests that must hold (e.g. "fleet size over 10"), plus conditions in words |
| provenance | source, source date, last verified date, verified by, notes |

### How a rule decides (one account, one coverage)

| | Account matches the rule's test | Account clear of it | Account data missing |
|---|---|---|---|
| NO, hard, **verified** | **Not Eligible** | passed | confirm (needs info) |
| NO, soft or unverified | underwriter review | passed | confirm |
| REFERRAL | underwriter review | passed | confirm |
| YES | passed | outside stated appetite → review (never a decline) | confirm |
| UNKNOWN | confirm (**never** a decline) | not relevant | confirm |
| Informational / "other" | shown, not scored / checked by hand | | |

Market verdict per coverage: any verified hard NO → **Not Eligible**; no verified passes or more to
confirm than verified passes → **Needs More Information**; any review or confirm → **Possible Match /
Underwriter Review**; otherwise **Likely Match**. The market shows its best coverage and lists each one.
A market with an access route but no rules (unknown appetite) is **Needs More Information**, with
its submission route shown.

## Import (secure, reviewable, agency-only)

Directory → **Import directory** (agency admins). One CSV the agency keeps in a spreadsheet — download
the template from the dialog — or the same content as JSON. Rows: `market`, `contact`, `rule`
(columns in `services/appetite/directoryImport.ts`). The file is read in the browser; the preview
lists every market as new or updating an existing one, with errors (bad status, non-https portal,
unknown category, …) and warnings (e.g. a hard NO without a verified date will not decline). **Check**
asks the database for the exact counts without saving; **Import** saves. Columns that look like
passwords or logins are refused.

## Order of work and status

1. Infrastructure, engine, directory, import, tests — **done** (synthetic data).
2. Corgi / CarrierGuard as the first market: access route via CarrierGuard, appetite unknown →
   import as a market with no rules (shows Needs More Information + route). **Waiting for the cheat
   sheet.**
3. Validate with a real DXP Risk Profile — on DXP's agency after 0049 is applied.
4. STAR Mutual, County Hall, Cover Whale, Evolum, MTM rules — from the cheat sheet, each rule with its
   source and date, unverified until Denis confirms.
5. More markets after those pass.

## Deployment

`0049` needs 0011 and 0023; it does not depend on 0047/0048 and changes no existing row. Apply it after
the V4 release (0047/0048) — `0049` is additive and re-runnable. No Edge Function change. Branch:
`claude/carrier-101-102` (Preview only). Nothing is imported into production until approved.

## Tests

- `src/services/appetite/__tests__/carrierRules.test.ts` — rule semantics (only verified hard NO declines, UNKNOWN never does, conditions, coverage by coverage, existing appetite preserved).
- `src/services/appetite/__tests__/carrierScenarios.test.ts` — five anonymized accounts × six synthetic markets.
- `src/services/appetite/__tests__/directoryImport.test.ts` — import parsing, matching, credential refusal, errors.
- `supabase/tests/agency_rls` CR1–CR15 — member read / admin write, cross-agency isolation, import permissions, dry run, no overwrite of existing appetite, invalid import rolled back.
