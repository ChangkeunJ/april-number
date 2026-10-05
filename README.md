# Your April Number

Australian health funds raise premiums on 1 April and the Minister announces one
industry average. In 2026 that figure was 4.41%. Across the 29,702 hospital products
priced in both the March and April files the middle one moved 4.15%; across the 14,574
of those open to the general public, 3.54%. The spread by tier ran from Basic at 2.37%
to Gold at 5.67%. 596 products rose more than 20%, 526 of them at one insurer, and
2,392 did not move at all.

The announced average is not the same measure. It is weighted by how many people each
product covers, spans hospital and extras together, and includes rate protection and
age-based discounts that this file does not carry. No individual product is expected to
match it.

The percentage your own policy rose is not published anywhere — not by your fund, not
by privatehealth.gov.au, not by any comparison site. It is a join of two files the
government already publishes. This does the join.

## Method

The Private Health Insurance Ombudsman publishes a monthly snapshot of every open
health insurance product to data.gov.au under CC BY 3.0 AU. Take the March snapshot
and the April snapshot, match products, and the difference is the rise.

Matching is on `(ProductCode, State, whoIsCoveredSignature, ExcessPerPerson,
ExcessPerAdmission)`. `ProductCode` is stable across this window; the `ProductID` GUID
rotates whenever a fund edits a product, so anything keyed on it gets no history at all
— only 259 of April's 30,563 products keep March's `ProductID`.

That key is verified against the publisher's own record rather than assumed. Each ZIP
ships a `Product Changes` CSV carrying `ProductID` and `OLD_ProductID`, which chains
each product to its previous version, and every row also carries a `ProductItemID`
that stays fixed across versions (29,702 matched hospital rows share it between March
and April, against 259 sharing a `ProductID`). Following that chain (`src/idjoin.mjs`) reproduces the same 29,702 matches
and the same 4.1534% median, and selects the same March row as the key above for every
single product.

The who-is-covered signature is derived from the adult count, the `OnlyOnePerson` flag
and the sorted list of dependant types marked covered — a fund can publish the same
product code as single, couple and family rows with different premiums.

Premiums do not move between April rate rises. Comparing August 2026 against April
2026 gives 29,268 common products and exactly zero price changes. So the history line
uses April snapshots only, five of them, back to 2022 — the first April rate rise for
which every product uses the `WhoIsCovered` element, per the dataset's ReadMe. 49.0% of
currently open hospital products have all five points; 87.6% have at least 2025 and
2026 (combined: 31.2% and 70.3%). Where a point is missing the
chart says so per product rather than drawing a shorter line.

## What it will not tell you

**It never shows what anyone pays.** Every figure is the listed premium before rebate,
straight out of the file. That excludes the Australian Government Rebate tier, payment
frequency, direct-debit discounts, age-based discounts and Lifetime Health Cover
loading. None of those adjustments are applied — the file records only whether an
age-based discount is *available* on a product, never the amount, and carries no
rebate, frequency or loading figures at all. The rebate percentage also fell on
1 April 2026, from 24.288% to 24.118% at the base tier under 65, so a premium net of
rebate rose by slightly more than the figure shown.

**It never says one product is better than another.** The same-cover panel lists
products whose medical-services vector, state, scale and excess match yours exactly,
and puts the six fields where they still differ in the same table — excess
waivers, co-payments, known-gap cover, accommodation, ambulance and waiting periods.
Identical clinical cover is not an identical policy: agreement hospital networks differ
between funds and are not in the product file at all.

**It excludes products you cannot buy.** 11,629 of 30,563 open hospital products carry
`Corporate IsCorporate="true"` and a further 2,380 carry a non-`NotApplicable`
`OnlyAvailableWith`. Separately, nine insurers are restricted — you must be eligible to
join them. The product file does not record that, but the Funds file in the same ZIP
does (`<FundType>Restricted</FundType>`, the same nine codes). The build reads the set
from `rise.json` (`restrictedFunds`), checks it against that Funds file and fails if the
two disagree; the list matches
[privatehealth.gov.au](https://privatehealth.gov.au/dynamic/insurer/restricted).
All three are filtered out of every alternatives list. Leaving them in puts an
employer-only or members-only product at the top of a list sorted by price.

**It excludes policies closed to new members.** 18,406 closed hospital and 28,444
closed combined products sit in the same ZIP and are never parsed. A reader who cannot
find their policy is most likely on one of them, and nothing on the page tells them
that beyond a line in the footer.

**It says nothing about tax.** No Medicare Levy Surcharge page, no Lifetime Health
Cover calculator. Those exist on government sites that keep them current. The file
carries a `MedicareLevySurchargeExempt` flag per product and it is deliberately not
surfaced — do not add it. Telling a reader whether a specific product discharges a
taxation obligation is the one thing on this page that walks toward the Tax Agent
Services Act; nothing else here goes near it.

## Rebuild

    npm run fetch                 # ~350 MB, six snapshots; three XML members and the Product Changes CSV from each, zip deleted after
    npm run check                 # the join test: 29,702 common, median 4.15%, bands 524/17538/9515/1352/177/596
    npm run check -- --candidate  # a year with nothing pinned yet: prints the block, writes reports/candidate-<year>.json
    npm run build                 # emits site/index.json, ~1.2 MB gzipped, and site/version.js
    npm test                      # verifies the index against what app.js assumes
    npm run smoke                 # runs render() over every branch in every language without a browser
    npm run test:unit             # fixtures only, no network, a few seconds
    npm run discover              # asks data.gov.au whether a new March or April snapshot exists (exit 10 if so)
    npm run report                # writes reports/rise-<year>.md from the candidate numbers and the build
    node src/i18n.mjs             # after editing site/strings.<lang>.json: regenerates site/strings.js
    npm run serve

`npm run check` is the one that matters. The six numbers it asserts were measured from the raw
ZIPs and live in `rise.json` under `expected`, one block per year, with the rest of the gate —
open and retail counts, sibling splits, unchanged premiums, the top band — checked by `npm test`
from the same block. If they ever stop reproducing, the scale signature or the excess extraction
has silently drifted and every percentage on the page is wrong. A year with no `expected` block
cannot be built for publication: `check` exits 2, `build` refuses a null `announcedAverage`, and
`--candidate` (or `CANDIDATE=1`) is the only way past either. CI never deploys a candidate build.

Two files configure everything. `rise.json` is edited by hand: the rise year and date, the two
snapshot names, the April history, the announced average and the circular it came from, the
restricted-fund codes, the hosts a download may come from, and the pinned numbers per year.
`snapshots.json` is written by the machine: for each snapshot, the CKAN resource id and URL,
`last_modified`, the sha256 of the zip and of every extracted member, and the file-name stamp.
It is trust-on-first-use. A clean clone's first `npm run fetch` records what it downloaded; every
later fetch compares against the record and stops if a zip's hash has changed. A reviewer can
reproduce any entry with `curl -L <url> | sha256sum`. The first fetch after this change
re-downloads all six snapshots once, because an existing `data/` has no manifest entries;
afterwards fetch prints `verified` for each and downloads nothing. Fetch now keeps the
Product Changes CSV (`src/idjoin.mjs` reads it) and deletes the zips once the members are out.

Refresh twice a year: early March for the pre-rise baseline, early April when the new file lands
(the 2026 one was extracted on 5 April). The workflow in the next section does the asking.

Resources are matched on `resource.name`, never the URL. Eight of the 73 filenames
break any date pattern you would write — `privatehealth-05-apr-2026.zip`,
`privatehealth.gov.au-april-2022.zip`. The CKAN `created` timestamps are junk too; the
October 2021 resource claims 2019.

### CI

`.github/workflows/ci.yml` runs two jobs on every pull request and on every push to `master`:
`unit` (`npm run test:unit` on the fixtures, no network) and `test` (the real data: fetch, check,
build, test, smoke, csp-check). On a push to `master` the `test` job uploads `site/` and, once both
jobs are green, a `deploy` job publishes it to GitHub Pages — the bytes that just passed the gate,
never a candidate build. Actions are pinned to commit SHAs and Dependabot keeps them current. The
`data/` cache is keyed on `snapshots.json` and fetch re-verifies every restored file against it, so
a stale or damaged cache is simply downloaded again. That verification needs a populated manifest:
while `snapshots.json` has no `resources` entries — as committed here, because the file is filled
by a machine that can reach data.gov.au and the `test` job runs read-only — fetch cannot vouch for
a restored cache and every `test` run downloads all six snapshots. Run `npm run fetch` once locally
and commit the `snapshots.json` it writes; from then on CI verifies the cache and downloads nothing.

## Updating for a new rise year

`.github/workflows/update.yml` asks data.gov.au for new snapshots every Monday, and every day
in March and April. When `discover` finds a `March <year>` or `April <year>` that
`snapshots.json` does not know, the `propose` job runs the whole pipeline in candidate mode and
opens a pull request from the branch `update/rise-<year>` — or adds to the one already open —
with `reports/rise-<year>.md` as its body: resource metadata and hashes, the candidate
`expected` block, last year's numbers beside this year's, the restricted-fund set, the funds
with the highest median listed-premium change, and the checklist below. Only `rise.json`,
`snapshots.json` and `reports/` are committed; `data/`, `site/index.json` and `site/version.js`
never are. A March-only find produces a baseline PR that records the new resource in
`snapshots.json` and adds `reports/rise-<year>.md` for the coming year; `rise.json` is untouched,
and the report says at the top that it was asked for a year `rise.json` is not at yet, so its
candidate section still describes the previous rise. Nothing is published until a person pins the
numbers in `rise.json` and merges.
A pull request opened with the workflow's own token does not trigger `ci.yml`; the pinning
commit pushed to that branch does. GitHub disables a schedule after 60 days without commits —
if nothing has run by early March, `gh workflow run update` starts it (`-f force=true` opens a
PR even when nothing is new).

Pin by hand, in this order (the same list is in `.github/PULL_REQUEST_TEMPLATE/update.md`):

1. Fill `announcedAverage` and `links.circular` in `rise.json` from the PHI circular. The
   figure is the Minister's industry average, copied as published.
2. Spot-check three products against the raw XML in `data/<snapshot>/Hospital Open *.xml`:
   March premium, April premium, the percentage the page shows.
3. Paste the `expected` block from `reports/rise-<year>.md` into `rise.json`, `excludedMin`
   included.
4. Confirm the restricted-fund set: the build log's `restricted funds: N codes match the Funds
   file`, and privatehealth.gov.au's own list.
5. `npm run build && npm run serve` and read the dates in all seven languages (`?lang=ko`,
   `zh`, `ja`, `vi`, `es`, `fr`): rise date, both snapshot dates, the footer build line.
6. Rewrite the rebate sentence in `footer2_html` — the one string that still names a year and
   two rebate percentages — in `site/strings.js` and all six `site/strings.<lang>.json`, then
   `node src/i18n.mjs`. `npm run smoke` without `CANDIDATE` fails while any string still carries
   an earlier year (in candidate mode it only warns, so the automated PR can open first).
7. Update the numbers in this README with the same hedged wording.
8. `npm run check && npm run build && npm test && npm run smoke` without `--candidate`, push,
   let `ci.yml` run strict, merge; `deploy` follows.

If a file changes under a name already recorded, `discover` reports it as republished: the
scheduled `propose` job does not run for that alone (the run shows a warning instead), and `fetch`
stops on the hash mismatch whenever it has to download that file again;
`node src/discover.mjs --refresh "<name>"` is the one way to accept that. If a download redirects to a host outside `rise.json` `downloadHosts`, fetch
refuses it; `node src/discover.mjs --probe "<name>"` prints the redirect chain so the host can be
added on purpose.

One-time repository settings, not in version control: Settings → Pages → Source = GitHub
Actions; Settings → Actions → General → Workflow permissions → allow GitHub Actions to create
and approve pull requests (without it `gh pr create` fails); branch protection on `master`
requiring `ci / unit` and `ci / test`; Security → private vulnerability reporting (see
`SECURITY.md`).

## Runtime

One HTML file, three JS files (`strings.js`, `version.js` written by the build, `app.js`),
one JSON file. No framework, no build step for the site, no network requests after the
page loads, no cookies, no analytics, no accounts. Selection lives in the URL hash as a
product index so a result is linkable in any language. Deploys to any static host.

The page carries a Content-Security-Policy meta: no inline style attributes or scripts except
two hashed blocks — the stylesheet and the theme script, which runs before first paint
(`node src/csp-check.mjs` prints the corrected meta when either block changes). `index.json`
is fetched once with `?v=<build version>`, so a new build is never read from an old cache; if
a cached `app.js` ever meets a data file of another schema, the page re-fetches its three
scripts past the cache and reloads once. The footer shows the data file's build time and
version. Dates in the UI are formatted per language from the data file, so a new year needs no
string edits for them; the one year-specific sentence left is the rebate note in
`footer2_html` (year and percentages), which `npm run smoke` flags until it is rewritten in all
seven languages.

Seven languages: English, 한국어, 中文, 日本語, Tiếng Việt, Español, Français. Picked from
`?lang=xx`, then the saved choice, then the browser language. The UI is translated;
product names, fund names and the eligibility wording a fund files stay in English as
filed, and the footer says so. `site/strings.js` holds English by hand and the other
six generated from `site/strings.<lang>.json` by `node src/i18n.mjs`. Every translation
was reviewed for meaning drift against the English — the hedges are load-bearing under
ACL s 18 and a translator's instinct to make a sentence firmer is exactly the failure
mode. `src/strings-check.mjs` verifies that key sets, placeholders, HTML tags and hrefs
match the English in every language, before `i18n.mjs` writes and before anything renders;
`src/smoke.mjs` renders every branch in every language.

Light and dark follow the OS unless the reader picks one; the choice is saved in
`localStorage` and applied before first paint.

## One thing the file records that nobody publishes

In the March 2026 file, some funds listed the same premium whether or not a policy
covered a non-student adult dependant. In the April file they do not. 499 hospital
products and 1,932 combined ones have a sibling row — same policy, same state, same
excess, same covered services — that was priced identically in March and is priced
lower in April. Where that happens the page shows the other row's price and says both
are in the file. It draws no conclusion about why.

## Standing rule

No revenue, no affiliate links, no sponsorship, no lead capture, no analytics. Not a
style preference. A free non-commercial page has an argument that it is not conduct
*in trade or commerce* under the Australian Consumer Law; any of those flips that for
everything the page has ever published.

## Attribution

Data: [PrivateHealth.gov.au](https://data.gov.au/data/dataset/8ab10b1f-6eac-423c-abc5-bbffc31b216c),
Private Health Insurance Ombudsman, [CC BY 3.0 AU](https://creativecommons.org/licenses/by/3.0/au/).

Not affiliated with or endorsed by the Ombudsman, the Commonwealth, or any health fund.

Code: MIT.
