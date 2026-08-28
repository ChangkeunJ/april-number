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
does (`<FundType>Restricted</FundType>`, the same nine codes), and the build carries
them as a hardcoded set of nine fund codes matching
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

    npm run fetch    # ~350 MB, six snapshots, extracts three XML members from each
    npm run check    # the join test: 29,702 common, median 4.15%, bands 524/17538/9515/1352/177/596
    npm run build    # emits site/index.json, ~1.2 MB gzipped
    npm run test     # verifies the index against what app.js assumes
    node src/smoke.mjs   # runs render() over every branch without a browser
    npm run serve

`npm run check` is the one that matters. Those six numbers were measured from the raw
ZIPs. If they ever stop reproducing, the scale signature or the excess extraction has
silently drifted and every percentage on the page is wrong.

Refresh twice a year: early March for the pre-rise baseline, early April when the new
file lands (the 2026 one was extracted on 5 April).

Resources are matched on `resource.name`, never the URL. Eight of the 73 filenames
break any date pattern you would write — `privatehealth-05-apr-2026.zip`,
`privatehealth.gov.au-april-2022.zip`. The CKAN `created` timestamps are junk too; the
October 2021 resource claims 2019.

## Runtime

One HTML file, one JS file, one JSON file. No framework, no build step for the site, no
network requests after the page loads, no cookies, no analytics, no accounts. Selection
lives in the URL hash so a result is linkable. Deploys to any static host.

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
