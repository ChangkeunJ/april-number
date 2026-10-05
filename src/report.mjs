// 연도별 검증 보고서. rise.json·snapshots.json·reports/candidate-<year>.json(check --candidate 가 씀)·
// site/index.json(candidate 모드 build 가 씀) 을 읽어 reports/rise-<year>.md 를 만든다. update.yml 이
// PR 본문으로 쓰고, 커밋해 두면 그 해의 검증 감사 흔적이 된다 (check.mjs 의 2026 주석이 하던 역할).
//
//   node src/report.mjs [--year Y] [--out reports/rise-Y.md] [--site site] [--reports reports]
//
// 없는 입력은 없다고 적고 만들 수 있는 부분만 만든다. 숫자는 전부 '게시된 보험료(리베이트 전)' 의
// 집계이고, 순위어·추천어는 쓰지 않는다 (README "Standing rule"). buildReport() 는 순수 함수다.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROOT, RISE_FILE, MANIFEST_FILE, loadRise, loadManifest } from './config.mjs'
import { F } from './columns.mjs'
import { median } from './join.mjs'

export const TEMPLATE_FILE = join(ROOT, '.github', 'PULL_REQUEST_TEMPLATE', 'update.md')
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const BANDS = ['fell (<0%)', '0–5%', '5–10%', '10–15%', '15–20%', '20%+']

// 표 셀에 데이터 값(기금명 등)을 넣을 때. PR 본문은 마크다운으로 렌더되므로 HTML 과 파이프를 죽인다.
export const md = (s) => String(s ?? '').replace(/[|<>`\\]/g, c => ({ '|': '\\|', '<': '&lt;', '>': '&gt;', '`': '’', '\\': '\\\\' }[c])).replace(/\s*\n\s*/g, ' ')
const num = (n) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US') : '—')
const pctf = (n) => (typeof n === 'number' && Number.isFinite(n) ? `${n.toFixed(2)}%` : '—')
const code = (s) => (s == null || s === '' ? '—' : '`' + String(s).replace(/`/g, '’') + '`')
const nameYear = (n) => Number(String(n).split(' ')[1]) || 0
const nameMonth = (n) => MONTHS.indexOf(String(n).split(' ')[0])
const byDate = (a, b) => (nameYear(a) - nameYear(b)) || (nameMonth(a) - nameMonth(b))
const round2 = (x) => Math.round(x * 100) / 100
const own = (o, k) => (o && typeof o === 'object' && Object.hasOwn(o, k) ? o[k] : undefined)

// excludedMin 제안: 현재 제외 행 수의 70% 를 유효숫자 한 자리로 내림. "제한 모집단이 크다" 는 하한일 뿐이다.
export function suggestMin(excluded) {
  const v = Math.floor(excluded * 0.7)
  if (v < 10) return v
  const p = 10 ** Math.floor(Math.log10(v))
  return Math.floor(v / p) * p
}

// 기금별 중앙값 (병원 상품, 두 달 모두 가격이 있는 행). 가입자 수 가중 없음.
export function fundMedians(index, { type = 0 } = {}) {
  const by = new Map()
  for (const p of index.products) {
    if (p[F.type] !== type || p[F.pct] == null) continue
    let a = by.get(p[F.fund]); if (!a) by.set(p[F.fund], a = [])
    a.push(p[F.pct])
  }
  return [...by].map(([fund, v]) => ({ fund, name: own(index.funds, fund) ?? '', median: round2(median(v)), n: v.length }))
    .sort((a, b) => (b.median - a.median) || a.fund.localeCompare(b.fund))
}

export function excludedCount(index, restricted) {
  const RS = new Set(restricted)
  return index.products.filter(p => p[F.corp] || p[F.restr] || RS.has(p[F.fund])).length
}

// rise.json 에 붙여 넣을 expected 블록. check 의 candidate(open/priced/median/bands)와 build 의 stats 를 합친다.
// 둘 다 있으면 서로 맞는지 본다 — 어긋나면 파서나 조인이 두 스크립트에서 다르게 움직인 것이다.
export function expectedBlock({ year, candidate, index, restricted }) {
  const notes = []
  const c = candidate?.hospital ?? null
  const s = index?.stats ?? null
  if (!c && !s) return { block: null, notes: ['no candidate json and no index.json — nothing to build the block from'], excluded: null }
  const pick = (k) => (c && k in c ? c[k] : s?.hospital?.[k] ?? null)
  if (c && s) {
    for (const k of ['open', 'priced', 'median']) if (c[k] !== s.hospital[k]) notes.push(`check and build disagree on hospital.${k}: ${c[k]} vs ${s.hospital[k]}`)
    if (JSON.stringify(c.bands) !== JSON.stringify(s.hospital.bands)) notes.push(`check and build disagree on hospital.bands: ${JSON.stringify(c.bands)} vs ${JSON.stringify(s.hospital.bands)}`)
  }
  const excluded = index ? excludedCount(index, restricted ?? index.meta?.restrictedFunds ?? []) : null
  const hospital = {
    open: pick('open'), priced: pick('priced'), median: pick('median'), bands: pick('bands'),
    split: s?.hospital?.split ?? null, pricedRetail: s?.hospital?.pricedRetail ?? null, medianRetail: s?.hospital?.medianRetail ?? null,
    zero: s?.hospital?.zero ?? null, topBand: s ? (s.hospital?.topBand ?? null) : null,
  }
  if (!s) notes.push('index.json missing: split, pricedRetail, medianRetail, zero, topBand, combined.priced, products and excludedMin are null — build in candidate mode and run again')
  if (!c) notes.push('candidate json missing: open/priced/median/bands come from index.json stats (build), not from check')
  const block = {
    [String(year)]: {
      hospital,
      combined: { priced: s?.combined?.priced ?? null },
      products: index ? index.products.length : null,
      excludedMin: excluded == null ? null : suggestMin(excluded),
    },
  }
  return { block, notes, excluded }
}

const METRICS = [
  ['hospital open', e => e.hospital.open, num],
  ['hospital priced (both months)', e => e.hospital.priced, num],
  ['hospital median', e => e.hospital.median, pctf],
  ...BANDS.map((b, i) => [`band ${b}`, e => e.hospital.bands?.[i], num]),
  ['sibling split', e => e.hospital.split, num],
  ['priced, retail population', e => e.hospital.pricedRetail, num],
  ['median, retail population', e => e.hospital.medianRetail, pctf],
  ['unchanged premium', e => e.hospital.zero, num],
  ['top band concentration', e => e.hospital.topBand, t => (t ? `${md(t.fund)} ${num(t.n)} of ${num(t.total)}` : '—')],
  ['combined priced', e => e.combined?.priced, num],
  ['products (rows)', e => e.products, num],
]
const delta = (a, b, fmt) => {
  if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) return '—'
  const d = round2(b - a)
  return (d > 0 ? '+' : '') + (fmt === pctf ? `${d.toFixed(2)} pts` : d.toLocaleString('en-US'))
}

export function buildReport({ year, rise, manifest, candidate = null, index = null, template = null }) {
  const L = []
  const H = (s) => L.push('', s, '')
  const y = Number(year)
  const prevY = y - 1
  const restricted = index?.meta?.restrictedFunds ?? rise.restrictedFunds
  const { block, notes, excluded } = expectedBlock({ year: y, candidate, index, restricted })
  const cur = block?.[String(y)] ?? null
  const pinned = own(rise.expected, String(y)) ?? null

  L.push(`# Rise ${y}: PHIO snapshot report`)
  L.push('')
  L.push(`Generated by \`node src/report.mjs\` from \`rise.json\`, \`snapshots.json\`, \`reports/candidate-${y}.json\` and \`site/index.json\`. Every number is an aggregate of listed premiums before rebate, as published in the PHIO files; nothing here is verified until a person checks it against the raw XML and pins it in \`rise.json\`.`)
  if (y !== rise.riseYear) L.push('', `Note: \`rise.json\` is at riseYear ${rise.riseYear}; this report was asked for ${y}. The build and candidate sections describe whatever was last built.`)
  L.push('')
  L.push(`| | |`, `|---|---|`)
  L.push(`| rise.json | riseYear ${rise.riseYear}, riseDate ${rise.riseDate}, before "${rise.before}", after "${rise.after}" |`)
  L.push(`| history | ${rise.history.join(', ')} |`)
  L.push(`| announcedAverage | ${rise.announcedAverage == null ? 'null — fill from the PHI circular' : pctf(rise.announcedAverage)} |`)
  L.push(`| links.circular | ${rise.links?.circular ? md(rise.links.circular) : 'null — fill from the PHI circular'} |`)
  L.push(`| expected[${y}] in rise.json | ${pinned ? 'pinned' : 'absent — candidate mode; nothing deploys until it is pinned'} |`)
  if (index?.meta) {
    const m = index.meta
    L.push(`| index.json | built ${md(m.built ?? '?')}, version ${code(m.version ?? '?')}, schema ${md(m.schema ?? '?')}, snapshots ${md(m.snapshots?.before ?? '?')} → ${md(m.snapshots?.after ?? '?')} |`)
  } else L.push(`| index.json | missing — run \`CANDIDATE=1 npm run build\` |`)
  if (candidate) L.push(`| candidate json | generated ${md(candidate.generated ?? '?')}, mode ${md(candidate.mode ?? '?')}, stamps ${md(candidate.stamps?.before ?? '?')} / ${md(candidate.stamps?.after ?? '?')} |`)
  else L.push(`| candidate json | missing — \`npm run check -- --candidate\` writes it when no expected block exists for ${y} |`)

  // ---- 스냅샷 메타데이터 ----
  H('## Snapshots')
  const used = new Map()
  for (const n of rise.history) used.set(n, n === rise.after ? 'after (this rise)' : 'history point')
  used.set(rise.before, 'before (baseline)')
  const entries = Object.entries(manifest.resources ?? {}).sort((a, b) => byDate(a[0], b[0]))
  const inManifest = new Set(entries.map(([n]) => n))
  L.push(`| snapshot | role | stamp | CKAN last_modified | CKAN size | zip sha256 |`, `|---|---|---|---|---|---|`)
  for (const [n, e] of entries) {
    L.push(`| ${md(n)} | ${used.get(n) ?? 'recorded, not used by rise.json yet'} | ${md(e.stamp ?? (e.members ? '?' : 'stub — not fetched yet'))} | ${md(e.last_modified ?? '—')} | ${num(e.size)} | ${code(e.sha256)} |`)
  }
  for (const n of [...used.keys()].filter(n => !inManifest.has(n))) L.push(`| ${md(n)} | ${used.get(n)} | — | — | — | not in snapshots.json — \`npm run fetch\` has not recorded it |`)
  const withMembers = entries.filter(([, e]) => e.members && typeof e.members === 'object')
  if (withMembers.length) {
    L.push('', 'Members (name — sha256), as recorded by `npm run fetch`; reproduce with `curl -L <url> | sha256sum` on the zip and `sha256sum` on each extracted file:', '')
    for (const [n, e] of withMembers) {
      L.push(`- ${md(n)}${e.url ? ` — ${md(e.url)}` : ''}`)
      for (const [f, m] of Object.entries(e.members).sort()) L.push(`  - ${md(f)} (${num(m.size)} bytes) ${code(m.sha256)}`)
    }
  }
  const lic = typeof manifest.licence === 'string' ? manifest.licence : typeof manifest.license_id === 'string' ? manifest.license_id : null
  L.push('', `Licence: ${lic ? `${md(lic)} (recorded in snapshots.json)` : '`cc-by` — verified by fetch (`validatePackage` stops the pipeline if `license_id` changes)'}${index?.meta?.licence ? `; index.json carries "${md(index.meta.licence)}"` : ''}.`)

  // ---- 후보 expected 블록 ----
  H(`## Candidate \`expected\` block for ${y}`)
  if (pinned) L.push(`\`rise.json\` already pins ${y}. The block below is what the current build produces; if it differs from the pinned block, the data or the parser changed.`, '')
  else L.push('Paste into `rise.json` under `"expected"` only after checking the numbers against the raw XML by hand (three products minimum, see the checklist). `null` means the input that produces that figure was missing.', '')
  if (block) {
    L.push('```json', JSON.stringify(block, null, 2), '```')
    if (excluded != null) L.push('', `Rows excluded from every alternatives list (corporate, OnlyAvailableWith, restricted funds): ${num(excluded)} of ${num(index.products.length)}; \`excludedMin\` above is 70% of that, rounded down — a floor, not a target.`)
    if (pinned && cur) {
      const diffs = []
      const flat = (o, pre = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? flat(v, `${pre}${k}.`) : [[`${pre}${k}`, JSON.stringify(v)]]))
      const a = new Map(flat(pinned)), b = new Map(flat(cur))
      for (const [k, v] of a) if (k !== 'excludedMin' && b.has(k) && b.get(k) !== v) diffs.push(`${k}: pinned ${v}, built ${b.get(k)}`)
      L.push('', diffs.length ? `Differences from the pinned block: ${diffs.join('; ')}` : 'Matches the pinned block (excludedMin not compared).')
    }
  } else L.push('No block: neither candidate json nor index.json was available.')
  for (const n of notes) L.push('', `Note: ${n}`)

  // ---- 전년 대비 ----
  H(`## ${prevY} (pinned) vs ${y} (this build)`)
  const prev = own(rise.expected, String(prevY)) ?? null
  if (!prev) L.push(`No \`expected\` block for ${prevY} in \`rise.json\` — no comparison. (The ${y} block above is still the one to verify.)`)
  else if (!cur) L.push(`${y} figures are missing (see above), so there is nothing to compare against ${prevY}.`)
  else {
    L.push(`| measure | ${prevY} | ${y} | change |`, `|---|---|---|---|`)
    for (const [label, get, fmt] of METRICS) {
      const a = get(prev), b = get(cur)
      L.push(`| ${label} | ${fmt(a)} | ${fmt(b)} | ${delta(a, b, fmt)} |`)
    }
    L.push('', 'Medians move with the product mix as well as with prices; a change in `hospital open` of more than a few percent deserves a look at the Product Changes CSV before anything else.')
  }

  // ---- 티어별 ----
  if (index?.stats?.hospital?.byTier) {
    H('## Hospital median by tier (this build)')
    L.push('| tier | median | n |', '|---|---|---|')
    for (const [t, [m, n]] of Object.entries(index.stats.hospital.byTier).sort()) L.push(`| ${md(t)} | ${pctf(m)} | ${num(n)} |`)
  }

  // ---- 제한 보험사 ----
  H('## Restricted funds')
  const a = [...rise.restrictedFunds].sort(), b = index?.meta?.restrictedFunds ? [...index.meta.restrictedFunds].sort() : null
  L.push(`rise.json: ${a.map(code).join(', ')} (${a.length}).`)
  if (b) {
    L.push('', JSON.stringify(a) === JSON.stringify(b) ? 'index.json `meta.restrictedFunds` is the same set.' : `index.json \`meta.restrictedFunds\` differs: ${b.map(code).join(', ')}.`)
    L.push('', a.map(c => `- ${code(c)} ${md(own(index.funds, c) ?? '(code not in this build’s Funds file)')}`).join('\n'))
  }
  const inFile = index?.meta?.restrictedInFile
  if (Array.isArray(inFile)) {
    const f = [...inFile].sort()
    L.push('', JSON.stringify(f) === JSON.stringify(a) ? `Funds file \`<FundType>Restricted</FundType>\`: same ${f.length} codes.` : `Funds file \`<FundType>Restricted</FundType>\` differs: ${f.map(code).join(', ')} — a strict build fails until rise.json matches.`)
  } else {
    L.push('', 'Funds-file cross-check: see the build log line `restricted funds: N codes match the Funds file` or `warning: restricted funds differ` (a strict build fails on a difference; candidate mode only warns). Confirm against privatehealth.gov.au/dynamic/insurer/restricted.')
  }

  // ---- 기금 ----
  H('## Funds')
  if (index?.funds) {
    const fm = fundMedians(index)
    L.push(`${num(Object.keys(index.funds).length)} funds in the Funds file; ${num(fm.length)} with hospital products priced in both snapshots. The previous build’s count is not recorded — compare with last year’s report in \`reports/\`.`)
    H(`### Ten funds with the highest median listed-premium change (hospital, ${y})`)
    L.push('Median of the percentage change in listed premium before rebate across that fund’s hospital products priced in both snapshots; n is the number of such products. Not weighted by membership, not comparable with the announced average, and not a statement about value or about what anyone pays.', '')
    L.push('| fund | name | median | n |', '|---|---|---|---|')
    for (const r of fm.slice(0, 10)) L.push(`| ${code(r.fund)} | ${md(r.name)} | ${pctf(r.median)} | ${num(r.n)} |`)
  } else L.push('index.json missing — no fund table.')

  // ---- SchemaVersion ----
  H('## SchemaVersion')
  if (candidate?.schemaVersions) {
    const sv = Object.entries(candidate.schemaVersions).map(([v, n]) => `${md(v)} × ${num(n)}`).join(', ')
    L.push(`Rows by SchemaVersion (both hospital files): ${sv}. Drift from 3.1: ${num(candidate.schemaDrift ?? 0)} rows${candidate.schemaDrift ? ' — the parser assumes 3.1; read the dataset ReadMe before pinning' : ''}.`)
  } else L.push('Not available — `npm run check -- --candidate` records it (strict runs assert zero drift and write no file).')

  // ---- 체크리스트 ----
  H('## Maintainer checklist')
  if (template) L.push(template.replace(/^<!--[\s\S]*?-->\s*/, '').replaceAll('YYYY', String(y)).trim())
  else L.push('`.github/PULL_REQUEST_TEMPLATE/update.md` not found — the checklist lives there.')
  L.push('')
  return L.join('\n')
}

// ---- CLI ----
function parseArgs(argv) {
  const o = { year: null, out: null, site: 'site', reports: process.env.REPORTS_DIR ? resolve(process.env.REPORTS_DIR) : join(ROOT, 'reports') }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1]
    const need = () => { if (typeof v !== 'string' || v === '' || v.startsWith('--')) throw new Error(`${a} needs a value`); i++; return v }
    if (a === '--year') { o.year = Number(need()); if (!Number.isInteger(o.year)) throw new Error('--year must be an integer') }
    else if (a === '--out') o.out = resolve(need())
    else if (a === '--site') o.site = need()
    else if (a === '--reports') o.reports = resolve(need())
    else if (a === '--help' || a === '-h') { o.help = true }
    else throw new Error(`unknown argument ${JSON.stringify(a)}`)
  }
  return o
}
const readJson = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null)

export function main(argv = process.argv.slice(2), { log = console.log, error = console.error } = {}) {
  let o
  try { o = parseArgs(argv) } catch (e) { error(`report: ${e.message}`); return 1 }
  if (o.help) { log('usage: node src/report.mjs [--year Y] [--out reports/rise-Y.md] [--site site] [--reports reports]'); return 0 }
  try {
    const rise = loadRise(RISE_FILE)
    const manifest = loadManifest(MANIFEST_FILE)
    const year = o.year ?? rise.riseYear
    const candidateFile = join(o.reports, `candidate-${year}.json`)
    const indexFile = join(o.site, 'index.json')
    const candidate = readJson(candidateFile)
    const index = readJson(indexFile)
    const template = existsSync(TEMPLATE_FILE) ? readFileSync(TEMPLATE_FILE, 'utf8') : null
    if (!candidate) error(`report: ${candidateFile} not found — the candidate section is built from index.json only`)
    if (!index) error(`report: ${indexFile} not found — stats, funds and the expected block are incomplete`)
    if (!template) error(`report: ${TEMPLATE_FILE} not found — checklist omitted`)
    const out = o.out ?? join(o.reports, `rise-${year}.md`)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, buildReport({ year, rise, manifest, candidate, index, template }))
    log(out)
    return 0
  } catch (e) { error(`report: ${e.message}`); return 1 }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main())
}
