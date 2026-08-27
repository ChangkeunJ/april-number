# Your April Number

Australian health funds raise premiums on 1 April and announce an industry average.
Almost nobody pays the average. In 2026 the announced figure was 4.41%, the measured
median across 29,702 hospital products was 4.15%, and the spread by tier ran from
Basic at 2.37% to Gold at 5.67%. 596 products rose more than 20%.

The percentage your own policy rose is not published anywhere — not by your fund, not
by privatehealth.gov.au, not by any comparison site. It is a join of two files the
government already publishes. This does the join.

## Method

The Private Health Insurance Ombudsman publishes a monthly snapshot of every open
health insurance product to data.gov.au under CC BY 3.0 AU. Take the March snapshot
and the April snapshot, match products, and the difference is the rise.

Matching is on `(ProductCode, State, whoIsCoveredSignature, ExcessPerPerson,
ExcessPerAdmission)`. `ProductCode` is the stable identifier; the `ProductID` GUID
rotates whenever a fund edits a product, so anything keyed on it gets no history at
all. The who-is-covered signature is derived from the adult count, the `OnlyOnePerson`
flag and the sorted list of dependant types marked covered — a fund can publish the
same product code as single, couple and family rows with different premiums.

Premiums do not move between April rate rises. Comparing August 2026 against April
2026 gives 29,268 common products and exactly zero price changes. So the history line
uses April snapshots only, five of them, back to 2022 — which is as far as the
dataset's own ReadMe says the data is comparable. 49.0% of currently open products
have all five points; 87.6% have at least 2025 and 2026. Where a point is missing the
chart says so per product rather than drawing a shorter line.

## What it will not tell you

**It never shows what anyone pays.** Every figure is the listed premium before rebate,
straight out of the file. That excludes the Australian Government Rebate tier, payment
frequency, direct-debit discounts, age-based discounts and Lifetime Health Cover
loading. None of those are in the data.

**It never says one product is better than another.** The same-cover panel lists
products whose medical-services vector, state, scale and excess are byte-identical to
yours, and puts the six fields where they still differ in the same table — excess
waivers, co-payments, known-gap cover, accommodation, ambulance and waiting periods.
Identical clinical cover is not an identical policy: agreement hospital networks differ
between funds and are not in the product file at all.

**It excludes products you cannot buy.** 11,629 of 30,563 open hospital products carry
`Corporate IsCorporate="true"` and a further 2,380 carry a non-`NotApplicable`
`OnlyAvailableWith`. Those are filtered out of every alternatives list. Leaving them in
makes the cheapest same-cover option an employer-only product the reader cannot
purchase.

**It says nothing about tax.** No Medicare Levy Surcharge page, no Lifetime Health
Cover calculator. Those exist on government sites that keep them current.

## Rebuild

    npm run fetch    # ~350 MB, six snapshots, extracts three XML members from each
    npm run check    # the join test: 29,702 common, median 4.15%, bands 524/17538/9515/1352/177/596
    npm run build    # emits site/index.json, ~1.3 MB gzipped
    npm run test     # verifies the index against what app.js assumes
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

## Attribution

Data: [PrivateHealth.gov.au](https://data.gov.au/dataset/8ab10b1f-6eac-423c-abc5-bbffc31b216c),
Private Health Insurance Ombudsman, [CC BY 3.0 AU](https://creativecommons.org/licenses/by/3.0/au/).

Not affiliated with or endorsed by the Ombudsman, the Commonwealth, or any health fund.

Code: MIT.
