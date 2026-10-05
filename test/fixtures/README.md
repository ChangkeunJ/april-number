# Fixtures

Synthetic PHIO snapshots so `npm run test:unit` can run the parse → join → build →
test path without the real ~350 MB download. Nothing here is real data; fund codes
and names are invented, except the nine restricted-fund codes, which must match
`rise.json` for the Funds cross-check in `src/build.mjs` to pass.

    node test/fixtures/gen.mjs      # rewrites data/, truncated.xml, snapshot.zip, dup.zip

Element and attribute names come only from the regexes in `src/parse.mjs`
(`Product` attributes `ProductCode/ProductID/ProductItemID/SchemaVersion`, the
`WhoIsCovered`/`Adults`/`DependantCover` structure, `Excesses`, `MedicalServices`,
`WaitingPeriod`, `Corporate`, `OnlyAvailableWith`, `HospitalCover`, `Products Count`).
The Funds file follows the shape `src/build.mjs` expects: `<FundCode>` immediately
followed by `<FundName>`, plus `<FundType>Restricted</FundType>` (README "Method").

## Layout

    data/march-2026/   Hospital Open 01-Mar-2026.xml, Combined Open 01-Mar-2026.xml, Funds 01-Mar-2026.xml
    data/april-2026/   same with 05-Apr-2026, plus Product Changes 05-Apr-2026.csv
    data/april-2025/   same with 02-Apr-2025 (history point)
    rise.json          mirrors the real rise.json with history ["April 2025","April 2026"]
                       and an "expected" block holding this fixture's true numbers
    truncated.xml      a product file with no </Product> at all (tail-cap test)
    snapshot.zip       the four april-2026 members plus an extra "evil.sh" that must be ignored
    dup.zip            Hospital Open 05-Apr-2026.xml at the root and again under sub/ (the
                       "exactly one per kind" rule must reject it)
    dashd.zip          the three XMLs under a "-dINJECTED/" prefix — an unzip option in
                       disguise; extractSnapshot refuses it before running unzip
    symlink.zip        Hospital and Combined as files, Funds as a symlink entry pointing at
                       /etc/hostname — unzip restores it as a symlink; the lstat check refuses it

## Cases covered (Hospital, April 2026: 33 products, 32 open)

- `&amp;`, decimal (`&#8217;`) and hex (`&#x2013;`) entities in `<Name>`
- an out-of-range numeric reference `&#99999999999;` (kept verbatim, must not throw)
- a `MedicalService Cover="constructor"` value (becomes `?` in the cover vector)
- a `WaitingPeriod Title="__proto__"` (stored as an own key on a null-prototype object)
- a Closed product, a corporate product with `CorporateText`, an `OnlyAvailableWith`
  product, products of restricted funds (ACA, NHB)
- a sibling pair (`BBB-015`) priced equally in March and differently in April → split = 1
- a product present only in April (`BBB-014`, pct null) and one present only in March
- an unchanged premium, a fall, rises in every band, three rises ≥ 20 % with two at one
  fund (topBand EEE 2/3)
- tiers Basic/Bronze/Silver/Gold, a `javascript:` URL and a non-URL (stored as null)
- a fund name with `&lt;` and one with `&amp;` in the Funds file

## Expected numbers

The `expected` block in `rise.json` was produced by running `build()` on these files
(`RISE_FILE=test/fixtures/rise.json DATA_DIR=test/fixtures/data`) and checked by hand
from the 31 hospital deltas: bands 2/15/7/3/1/3, median = 16th sorted value = 4.5,
retail population 31 − 4 (corporate, OnlyAvailableWith, two restricted funds) = 27,
three unchanged, combined 11 open − 1 new = 10 priced, 32 + 11 = 43 rows, 6 rows
excluded from the alternatives list. Change a premium in `gen.mjs` and these move.

## ZIPs

Created with the standard-library CLI (no dependency), from inside `data/april-2026`:

    python3 -m zipfile -c ../../snapshot.zip 'Hospital Open 05-Apr-2026.xml' \
        'Combined Open 05-Apr-2026.xml' 'Funds 05-Apr-2026.xml' \
        'Product Changes 05-Apr-2026.csv' /tmp/stage/evil.sh
    # dup.zip: from a staging dir holding the three XMLs and sub/Hospital Open 05-Apr-2026.xml
    python3 -m zipfile -c dup.zip 'Hospital Open 05-Apr-2026.xml' \
        'Combined Open 05-Apr-2026.xml' 'Funds 05-Apr-2026.xml' sub

    # dashd.zip and symlink.zip: python3 -c with the zipfile module (writestr with a "-dINJECTED/"
    # prefix; a ZipInfo whose external_attr is (S_IFLNK | 0o777) << 16 and whose data is the link target)

`gen.mjs` runs the same commands. Size caps are tested by lowering `LIMITS` through
options, not with oversized archives.
