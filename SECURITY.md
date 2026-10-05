# Security

## Reporting

Use GitHub's private vulnerability reporting on this repository
(Security tab → "Report a vulnerability"). No email is required. Please include
the affected file, steps to reproduce, and what an attacker gains. Reports are
acknowledged on a best-effort basis; there is no bounty.

## Scope

- The static site in `site/` (`index.html`, `app.js`, `strings*.js`, `index.json`).
- The build pipeline in `src/` (download, ZIP extraction, XML parsing, `index.json` output).
- The CI workflows in `.github/workflows/`.

Only the `master` branch is supported. Fixes land there and deploy from there.

## Not a vulnerability

- "The number looks wrong." That is a data or method question, not a security
  issue: open a public issue with the product code and the two snapshot dates.
- Availability or content of the upstream data.gov.au resources. The site reads
  what the Private Health Insurance Ombudsman publishes and cannot fix it.
- Anything that requires a compromised GitHub account or runner to begin with.

## What the site does not do

No accounts, no cookies, no analytics, no server-side code, no third-party
scripts. The only runtime network request is for `index.json` from the same
origin. Language and theme choices are kept in `localStorage` only. Every figure
shown is a listed premium copied from the published file; nothing is submitted
anywhere.

## Repository settings (manual)

These are not in version control and must be set by the maintainer:

- Branch protection on `master`: require the `ci / test` and `ci / unit` status
  checks to pass, and disallow force-push.
- Settings → Security: enable "Private vulnerability reporting".
- Settings → Pages: Source = GitHub Actions (the `deploy` job in `ci.yml`).
