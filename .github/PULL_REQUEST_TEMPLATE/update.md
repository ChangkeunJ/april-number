<!--
Yearly data update. .github/workflows/update.yml opens this PR with reports/rise-YYYY.md as the
body (that report embeds the checklist below, so keep the two in step by editing only this file).
GitHub applies a template from this directory only through ?template=update.md on the new-PR page
or when the file is the repository default, so for a manual update open the PR with that query.
-->
## Verify and pin — Rise YYYY

Nothing is published until every box is ticked, `rise.json` is pinned and this PR is merged into
`master`. Until `expected[YYYY]` exists, `npm run check` exits 2 and `ci.yml` does not deploy.

- [ ] `announcedAverage` and `links.circular` in `rise.json` filled from the PHI circular (health.gov.au → PHI circulars → premium round announcement); the figure is the Minister's industry average, copied as published
- [ ] Three products spot-checked against the raw XML in `data/<snapshot>/Hospital Open *.xml`: March premium, April premium and the percentage the page shows, for one product in each of two funds and one with a sibling split
- [ ] `expected` block from `reports/rise-YYYY.md` pasted into `rise.json` after the hand check — including `excludedMin`
- [ ] Restricted-fund set confirmed: `rise.json` `restrictedFunds` equals the Funds file's `<FundType>Restricted</FundType>` codes (the build log says `restricted funds: N codes match the Funds file`) and privatehealth.gov.au/dynamic/insurer/restricted
- [ ] Dates read correctly in all seven languages on a local preview (`npm run build && npm run serve`, then `?lang=en`, `ko`, `zh`, `ja`, `vi`, `es`, `fr`): rise date, both snapshot dates, footer build line
- [ ] The rebate sentence in `footer2_html` rewritten for YYYY in `site/strings.js` and all six `site/strings.<lang>.json` (the date, the two rebate percentages and the derived gap — or, if the rebate did not change, the sentence rewritten to say so), then `node src/i18n.mjs`; `npm run smoke` without `CANDIDATE` fails while any string still names an earlier year
- [ ] README prose numbers updated (headline paragraph, Method, What it will not tell you) with the same hedged wording — never firmer, never a recommendation
- [ ] `npm run check && npm run build && npm test && npm run smoke` pass locally without `--candidate` / `CANDIDATE=1`
- [ ] `reports/rise-YYYY.md` and `reports/candidate-YYYY.json` committed as the audit trail for YYYY

After merge, `ci.yml` runs strict (`npm run check` without `--candidate`) on `master` and deploys
`site/` to GitHub Pages. A PR opened by `update.yml` with `GITHUB_TOKEN` does not trigger `ci.yml`
on its own; the pinning commit pushed to this branch does.
