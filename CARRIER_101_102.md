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
| category | state, commodity, operation type, operations (cargo or equipment), radius, fleet size, years in business, driver age, driver experience, vehicle type, vehicle age, claims (3 yrs), telematics, dash cameras, DOT number, coverage written, other |
| test + value | any of (list), under / over / between (numbers), none, missing, text |
| answer | YES · NO · REFERRAL · UNKNOWN |
| strength | Hard · Soft · Informational |
| conditions | further tests that must hold (e.g. "fleet size over 10"), plus conditions in words |
| provenance | source, source date, last verified date, verified by, notes |
| documented status | the source's own wording (e.g. "VERIFIED", "SUPPORTED") kept exactly as written — a record, **not** a RenewalIQ verification |

### How a rule decides (one account, one coverage)

| | Account matches the rule's test | Account clear of it | Account data missing |
|---|---|---|---|
| NO, hard, **verified** | **Not Eligible** | passed | confirm (needs info) |
| NO, soft or unverified | underwriter review | passed | confirm |
| REFERRAL | underwriter review | passed | confirm |
| YES | passed | outside stated appetite → review (never a decline) | confirm |
| UNKNOWN | confirm (**never** a decline) | not relevant | confirm |
| Informational / "other" | shown, not scored / checked by hand | | |

Matching details: a YES range must hold for **every** driver, unit and operating state (one driver
outside "ages 25–70" is a review); a NO or REFERRAL triggers on **any** one. Keywords match the
account's own words at a word start and skip negated wording ("non-hazmat tanker" is not hazmat).
"Operations (cargo or equipment)" looks at commodities and vehicle types together.

Market verdict per coverage: any verified hard NO → **Not Eligible**. **No verified evidence** (no
verified rule passed or flagged a review — e.g. an agency sheet nobody has confirmed yet), nothing
scorable, or more open questions than passes (an unverified pass counts half) → **Needs More
Information**, and the card says **Appetite not verified**. At least two verified passes with nothing
to review or confirm → **Likely Match**; otherwise **Possible Match / Underwriter Review**. So a market
is never presented as a match on unconfirmed rules alone. Unverified rules still order the results:
within a verdict, fewer underwriter-review flags and more passes come first, so an account that clears
every documented rule never ranks below one that hits an exclusion. The market shows its best coverage
and lists each one. A market with an access route but no rules (unknown appetite) is **Needs More
Information**, with its submission route shown.

Verification: `last_verified_at` is set only by an agency admin after independent confirmation
("Mark verified"). An imported document's own "VERIFIED" goes in *documented status* and does not let
a rule decline.

## Import (secure, reviewable, agency-only)

Directory → **Import directory** (agency admins). One CSV the agency keeps in a spreadsheet — download
the template from the dialog — or the same content as JSON. Rows: `market`, `contact`, `rule`
(columns in `services/appetite/directoryImport.ts`). The file is read in the browser; the preview
lists every market as new or updating an existing one, with errors (bad status, non-https portal,
unknown category, …) and warnings (e.g. a hard NO without a verified date will not decline). **Check**
asks the database for the exact counts without saving; **Import** saves. Columns that look like
passwords or logins are refused.

## Linking to existing markets (no duplicates; programs stay separate)

An imported market can be linked instead of added: `baseRecordId` makes it the agency's version of a
built-in market (one card in Market Finder; the built-in's verified criteria still apply, never
overwritten), `linkTo` points at one of the agency's own markets whose name differs. The import
matches by import reference → chosen link → the agency's existing version of that built-in → exact
name. The preview lists look-alikes ("may already exist under another name") with a **Link to**
choice per market — default **Keep separate**; nothing is linked on a guess. Rules that keep programs
apart:

- Each program of a carrier is its own market; a route that doesn't say which program it reaches is
  kept separate and offered every program to choose from.
- A built-in that models one coverage (e.g. a carrier's Auto Liability program) applies its criteria to
  that coverage only when linked to a wider agency market.
- Two imported markets are never merged into one (refused by the preview and the database), and a
  link to another agency's market is refused.
- The built-in link of a market already in the list can't be changed on re-import (0023 keeps
  `base_record_id` fixed); the preview says so.
- An agency's version of a built-in that is later removed from the dataset stays, on its own details.

## Order of work and status

1. Infrastructure, engine, directory, import, tests — **done** (synthetic data).
2. First real agency directory: prepared as a private import file outside this repository, checked
   with the preview and the database dry run, and imported into a **local** test database only.
   The first market (direct, portal route, appetite unknown) shows Needs More Information with its route.
3. Agency review of the prepared rules (strengths, duplicates, open questions), then admin
   verification rule by rule; nothing is imported into production until approved.
4. More markets after those pass.

## Deployment

`0049` needs 0011 and 0023; it does not depend on 0047/0048 and touches none of their tables, and the
V4 release check applies only up to 0046 plus 0047/0048, so it is unaffected. No Edge Function change.
Tested both ways on a local copy: the V4 app on a database **with** 0049 (and an imported directory),
and this app on a database **without** 0049 (Market Finder and Carrier Appetite work as before; the
directory lists markets as "Access not on file" and an import says the database update is needed).

Rollback: `supabase/release/rollback_0049.sql` — nothing to change; redeploy the previous app and the
data waits for the new one (the file only reports counts). `supabase/release/remove_0049.sql` deletes
the feature's data and structure, keeps the markets themselves, and refuses to run unless the session
sets `renewaliq.confirm_remove_0049 = 'yes'`. Re-running 0049 afterwards restores the structure.

### Launch order

1. Ship the V4 release first, exactly as planned in RELEASE_V4.md.
2. Ship the built-in dataset withdrawal on its own (it applies cleanly to the release branch).
   Before it, run a read-only check in production for agency markets, saved quotes, appetite
   overrides, update requests and feedback that refer to the withdrawn built-ins. They keep working
   (agency versions stay on their own details; saved quotes keep the market name).
3. Merge this branch; back up the database; apply `0049` in the SQL editor (re-runnable); confirm
   with `rollback_0049.sql` (counts only); promote the Preview; smoke-test Market Finder, Carrier
   Appetite and the Market Access Directory as an admin and as a broker.
4. The agency's admin imports its directory in production through the app (preview → Check → Import),
   only after the new app is live. Nothing is verified by the import; an admin verifies rules one by
   one against an independent source.

## Tests

- `src/services/appetite/__tests__/carrierRules.test.ts` — rule semantics (only verified hard NO declines, UNKNOWN never does, a source's own "VERIFIED" cannot decline, every-driver/any-driver ranges, negated keywords, operations, conditions, coverage by coverage, ordering on unverified markets, existing appetite preserved).
- `src/services/appetite/__tests__/carrierScenarios.test.ts` — five anonymized accounts × six synthetic markets.
- `src/services/appetite/__tests__/directoryImport.test.ts` — import parsing, matching, credential refusal, errors.
- `supabase/tests/agency_rls` CR1–CR16 (incl. documented status kept as written, operations rules, linking: own agency only, never merging two imported markets) — member read / admin write, cross-agency isolation, import permissions, dry run, no overwrite of existing appetite, invalid import rolled back.
