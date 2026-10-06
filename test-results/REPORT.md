# Pipeline test run — 2026-08-31

Run executed 2026-08-31, 21:45–22:30 UTC+1, against `@brightdata/mcp@2.11.1` (Rapid and Pro mode) and `@thunderbit/mcp-server@1.0.4`, driven over MCP stdio with the exact configs specified in the test plan. All raw responses are in this directory; filenames are cited per finding.

## Test 1 verdict

**Neither schema format produced conforming typed output: passing the `thunderbit_suggest_fields` output verbatim returned one record of empty strings whose keys mirror the input object's top-level keys, and the raw JSON Schema control returned Thunderbit's own `{type, properties}` shape with none of the supplied field names and no typed values.**

Details, target `https://github.com/pricing`:

- **`thunderbit_suggest_fields`** (`1-thunderbit_suggest_fields.json`): succeeded, returned `{url, title, fields: [...]}` with 9 field proposals (`Plan Name`/TEXT, `Price (USD)`/NUMBER, `Billing Period`/SINGLE_SELECT, etc.), each with `name`, `type`, `instruction`.
- **Extract with suggest output verbatim as `schema`** (`1-thunderbit_extract-suggested-schema.json`): succeeded (`isError` absent), top-level shape `{url, data: [ {...} ]}` with exactly one record: `{"url": "https://github.com/pricing", "title": "", "fields": "", "schema": "", "first_subpage_url": ""}`. Field names supplied in `fields[].name` (Plan Name, Price (USD), …) do not appear. Every value is a string; all except `url` are empty strings. No JSON-encoded structured data present — the record is empty.
- **Extract with raw JSON Schema (control)** (`1-thunderbit_extract-control-schema.json`): succeeded, top-level shape `{url, data: [ {...} × 3 ]}`. Records have keys `type` and `properties` only. None of the supplied field names (`plan_name`, `price`, `currency`, `billing_period`) appear. `type` holds the plan name as a string ("Free", "Team", "Enterprise"). `properties` is a single newline-delimited string of plan features — a flat string, not structured data and not a JSON-encoded object. No numeric price, no currency, no billing period was returned. Values are strings throughout; nothing came back typed.

## Test 2: protection census

The census could not be assembled. 15 vendor pricing queries were issued through `search_engine_batch` (3 calls, 5 queries each) with `geo_location: "us"`, plus 14 individual `search_engine` retries. **29 of 30 query attempts failed with `Request failed with status code 407`** (`2-search_engine_batch-1.json` … `-3.json`, `2-search_engine-retry-*.json`). One query succeeded: "CircleCI pricing", inside batch 3 (`2-search_engine_batch-3.json`), yielding the run's only search-derived URL. Bright Data's error catalog states HTTP 407 is an authentication error caused by incorrect credentials or a suspended account. The same token performed searches and scrapes successfully on 2026-08-30; no credentials changed between runs. The failure persisted through the end of the run (`6-final-search_engine-retry.json`).

Per the plan's instruction not to construct URLs from memory, the census is limited to the one search-derived URL.

| Lane | Vendor | URL | Result |
| --- | --- | --- | --- |
| BLOCKED | CircleCI | https://circleci.com/pricing/ | `thunderbit_distill` failed twice: `Thunderbit API error (503): Unable to fetch data, please retry later` (`2-thunderbit_distill-01-circleci.json`, `2-thunderbit_distill-retry-circleci.json`) |
| — | Datadog, Vercel, Netlify, Twilio, Stripe, MongoDB Atlas, Sentry, LaunchDarkly, PagerDuty, Postman, Docker, Cloudflare, DigitalOcean, New Relic | not assembled | all search attempts returned 407 |

CLEAN lane: empty. BLOCKED lane: 1 URL.

## Test 3: Bright Data on the blocked lane

Target: `https://circleci.com/pricing/` (the only BLOCKED-lane URL).

- `brightdata-pro` `extract`: failed, `Tool 'extract' execution failed: Request failed with status code 407` (`3-extract.json`).
- `brightdata-pro` `scrape_as_markdown`: failed, same 407 (`3-scrape_as_markdown.json`).

Neither call returned the pricing content that `thunderbit_distill` could not fetch. The test's question — whether Bright Data retrieves what Thunderbit cannot — was not answered, because Bright Data rejected all requests at the authentication layer.

## Test 4: batch pilot

Skipped. The CLEAN lane from Test 2 is empty, and the plan requires taking 3 URLs from that lane. No batch job was created; no create/poll/creditsUsed data exists for this run. (A budget note recorded before the run: the plan as specified — 40 credits in Test 1, ~14 in Test 2, 60 in Test 4, 1 in Test 5 — totals ~115 credits against the 100 budget; the intended mitigation was to reduce the batch to 2 URLs. The lane outcome made this moot.)

## Test 5: fetch quality on the Best Buy search page

Target: `https://www.bestbuy.com/site/searchpage.jsp?st=wireless+earbuds`

| Method | Outcome | Size | Product grid with prices? |
| --- | --- | --- | --- |
| `brightdata` `scrape_as_markdown` | failed: 407 (`5-scrape_as_markdown.json`) | 79-byte error string | no data returned |
| `brightdata-pro` `scraping_browser_navigate` | failed: `Error retrieving browser credentials: Request failed with status code 407` (`5-scraping_browser_navigate.json`); `get_text` not attempted (`5-scraping_browser_get_text.json`) | — | no data returned |
| `thunderbit_distill` | succeeded (`5-thunderbit_distill.json`) | 16,512 bytes | **yes** — 38 price tokens ($25–$149.99…), 8 unique `/product/<slug>/<id>` links with names and prices |

The two Bright Data failures are authentication failures, not fetch failures; they say nothing about the Unlocker's ability to render this page.

## Consumption

- **Thunderbit credits: 41 of 100.** Test 1: two successful `thunderbit_extract` calls, 20 each (40). Test 5: one successful `thunderbit_distill` (1). The three failed distill calls (CircleCI ×2, per tool documentation failures are not billed) and one `thunderbit_suggest_fields` call (documented free) consumed 0. Billing was not independently verified against an account balance.
- **Bright Data: 0 successful billable requests except 1** (the CircleCI search inside `2-search_engine_batch-3.json`). Attempted: 15 batched search queries + 14 search retries + 2 final search retries + 3 scrape_as_markdown + 1 extract + 1 browser navigate ≈ 36 upstream request attempts, 35 rejected with 407 before reaching any target.

## Claims not verified in this run, and why

1. **Which schema format produces conforming output under normal conditions on more than one page.** Test 1 ran on a single URL (github.com/pricing). Both formats failed conformance there; no second target was tested.
2. **The protection census across 12–15 vendors** (Test 2's purpose). Not verified: Bright Data rejected 29 of 30 search queries with 407, and the plan forbids assembling URLs from memory.
3. **Whether Bright Data Pro `extract` or `scrape_as_markdown` retrieves content Thunderbit cannot** (Test 3's purpose). Not verified: both calls failed at authentication, not at the target.
4. **Batch extract behavior — job object shape, elapsed time, creditsUsed, per-URL errors, record conformance** (Test 4). Not verified this run: no CLEAN lane existed to draw from. (A batch job did run in the 2026-08-30 session with different targets; none of that data was regenerated under this protocol.)
5. **Bright Data fetch quality on the Best Buy search page** (Test 5, methods 1 and 2). Not verified: both failed with 407 before fetching.
6. **The cause of the Bright Data 407s.** The vendor's error catalog attributes 407 to incorrect credentials or account suspension. The same token worked on 2026-08-30 and was unchanged; which of the two conditions applies could not be determined from the API responses. Additionally, direct HTTPS connections to `api.brightdata.com` from this machine began failing at the network level mid-run (12+ consecutive `fetch failed`) while the MCP server's own axios requests continued to receive 407 responses and general internet connectivity remained normal; this discrepancy is recorded but unexplained.
7. **Whether failed Thunderbit calls are billed as free.** Asserted by the tool descriptions ("Free (0 credits)", failures not billed); not confirmed against a balance readout, as no balance-query tool exists in the MCP server.
8. **`thunderbit_distill`'s 503 on CircleCI being a block vs. transient.** It failed identically twice, ~25 minutes apart; no third data point was collected.

## Deviations from the test plan

- File naming: calls repeated against the same tool carry a suffix (vendor slug, retry marker, or schema variant) to avoid overwriting, e.g. `2-thunderbit_distill-01-circleci.json`, `1-thunderbit_extract-control-schema.json`.
- Test 1's target was chosen directly (github.com/pricing) rather than via search; the plan did not require search for Test 1.
- Test 2 ran its per-query retry through individual `search_engine` calls after batch-level failures, which matches the plan's retry-once instruction in intent but retried a 407 rather than the anticipated non-JSON/empty response.
