// 설정 로더. 사람이 고치는 rise.json 과 기계가 쓰는 snapshots.json 을 읽어
// 모든 스크립트가 쓰는 경로·연도·검증 상수를 한 곳에서 내준다.
//
// snapshots.json 은 trust-on-first-use 다: 깨끗한 클론에서 첫 `npm run fetch` 가
// 받은 ZIP 과 멤버의 sha256 을 기록하고, 이후 fetch 는 그 값과 대조한다. 검토자는
// `curl -L <url> | sha256sum` 으로 같은 값을 재현할 수 있다.
//
// 환경변수(픽스처·테스트용): RISE_FILE, DATA_DIR, MANIFEST_FILE, LIMIT_* (아래 LIMITS).
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
export const DATA = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(ROOT, 'data')
export const RISE_FILE = process.env.RISE_FILE ? resolve(process.env.RISE_FILE) : join(ROOT, 'rise.json')
export const MANIFEST_FILE = process.env.MANIFEST_FILE ? resolve(process.env.MANIFEST_FILE) : join(ROOT, 'snapshots.json')

const DEFAULT_PKG = '8ab10b1f-6eac-423c-abc5-bbffc31b216c'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const NAME_RE = /^(March|April) \d{4}$/
export const STAMP_RE = /^\d{2}-[A-Z][a-z]{2}-\d{4}$/
// 스냅샷 디렉터리 안의 멤버 파일명. fetch 의 추출 allowlist 와 같은 패턴이다.
export const XML_RE = /^(Hospital Open|Combined Open|Funds) (\d{2}-[A-Z][a-z]{2}-\d{4})\.xml$/
export const CSV_RE = /^Product Changes (\d{2}-[A-Z][a-z]{2}-\d{4})\.csv$/
const HOST_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i

const isInt = (v) => Number.isInteger(v)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

// ---- rise.json ----
export function validateRise(r, file = 'rise.json') {
  const bad = (msg) => { throw new Error(`${file}: ${msg}`) }
  if (!r || typeof r !== 'object' || Array.isArray(r)) bad('must be a JSON object')
  if (!isInt(r.riseYear) || r.riseYear < 2000 || r.riseYear > 2100) bad('riseYear must be an integer year')
  if (typeof r.riseDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.riseDate) || Number.isNaN(Date.parse(r.riseDate))) bad('riseDate must be an ISO date (YYYY-MM-DD)')
  if (!r.riseDate.startsWith(`${r.riseYear}-`)) bad(`riseDate ${r.riseDate} is not in riseYear ${r.riseYear}`)
  if (r.after !== `April ${r.riseYear}`) bad(`after must be "April ${r.riseYear}", got ${JSON.stringify(r.after)}`)
  if (typeof r.before !== 'string' || !NAME_RE.test(r.before)) bad('before must look like "March 2026"')
  if (!Array.isArray(r.history) || r.history.length === 0) bad('history must be a non-empty array')
  for (const n of r.history) if (typeof n !== 'string' || !NAME_RE.test(n)) bad(`history entry ${JSON.stringify(n)} must look like "April 2026"`)
  if (r.history.at(-1) !== r.after) bad(`history must end with after (${r.after})`)
  if (new Set(r.history).size !== r.history.length) bad('history has duplicates')
  if (!(r.announcedAverage === null || isNum(r.announcedAverage))) bad('announcedAverage must be a finite number or null')
  if (!r.links || typeof r.links !== 'object' || Array.isArray(r.links)) bad('links must be an object')
  for (const [k, v] of Object.entries(r.links)) {
    if (v === null) continue
    let u = null
    try { u = new URL(v) } catch {}
    if (typeof v !== 'string' || !u || u.protocol !== 'https:') bad(`links.${k} must be an https URL or null`)
  }
  if (!Array.isArray(r.restrictedFunds)) bad('restrictedFunds must be an array')
  for (const c of r.restrictedFunds) if (typeof c !== 'string' || !/^[A-Z]{3}$/.test(c)) bad(`restrictedFunds entry ${JSON.stringify(c)} must be a three-letter fund code`)
  if (new Set(r.restrictedFunds).size !== r.restrictedFunds.length) bad('restrictedFunds has duplicates')
  if (!Array.isArray(r.downloadHosts) || r.downloadHosts.length === 0) bad('downloadHosts must be a non-empty array')
  for (const h of r.downloadHosts) if (typeof h !== 'string' || !HOST_RE.test(h)) bad(`downloadHosts entry ${JSON.stringify(h)} is not a hostname`)
  if (r.expected === undefined) r.expected = {}
  if (!r.expected || typeof r.expected !== 'object' || Array.isArray(r.expected)) bad('expected must be an object keyed by year')
  for (const [y, e] of Object.entries(r.expected)) {
    const b = (msg) => bad(`expected.${y}.${msg}`)
    if (!/^\d{4}$/.test(y)) bad(`expected key ${JSON.stringify(y)} must be a year`)
    if (!e || typeof e !== 'object') b('must be an object')
    const h = e.hospital
    if (!h || typeof h !== 'object') b('hospital must be an object')
    for (const k of ['open', 'priced', 'split', 'pricedRetail', 'zero']) if (!isInt(h[k]) || h[k] < 0) b(`hospital.${k} must be a non-negative integer`)
    for (const k of ['median', 'medianRetail']) if (!isNum(h[k])) b(`hospital.${k} must be a number`)
    if (!Array.isArray(h.bands) || h.bands.length !== 6 || !h.bands.every(n => isInt(n) && n >= 0)) b('hospital.bands must be six non-negative integers')
    if (h.topBand !== null) {
      const t = h.topBand
      if (!t || typeof t !== 'object' || typeof t.fund !== 'string' || !isInt(t.n) || !isInt(t.total)) b('hospital.topBand must be null or { fund, n, total }')
    }
    if (!e.combined || !isInt(e.combined.priced) || e.combined.priced < 0) b('combined.priced must be a non-negative integer')
    if (!isInt(e.products) || e.products < 0) b('products must be a non-negative integer')
    if (e.excludedMin !== undefined && (!isInt(e.excludedMin) || e.excludedMin < 0)) b('excludedMin must be a non-negative integer when present')
  }
  return r
}
export function loadRise(file = RISE_FILE) {
  let txt
  try { txt = readFileSync(file, 'utf8') } catch (e) { throw new Error(`cannot read ${file}: ${e.message}`) }
  let obj
  try { obj = JSON.parse(txt) } catch (e) { throw new Error(`${file}: invalid JSON — ${e.message}`) }
  return validateRise(obj, file)
}
export const RISE = loadRise()

// ---- snapshots.json ----
export function loadManifest(file = MANIFEST_FILE) {
  if (!existsSync(file)) return { package: DEFAULT_PKG, resources: {} }
  let m
  try { m = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { throw new Error(`${file}: invalid JSON — ${e.message}`) }
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error(`${file}: must be a JSON object`)
  if (m.package === undefined) m.package = DEFAULT_PKG
  if (typeof m.package !== 'string' || !UUID_RE.test(m.package)) throw new Error(`${file}: package must be a CKAN package UUID`)
  if (m.resources === undefined) m.resources = {}
  if (!m.resources || typeof m.resources !== 'object' || Array.isArray(m.resources)) throw new Error(`${file}: resources must be an object keyed by snapshot name`)
  return m
}
export const MANIFEST = loadManifest()
export const PKG = MANIFEST.package

// 키를 정렬해 쓴다. 업데이트 PR 의 diff 가 읽히려면 순서가 흔들리지 않아야 한다.
const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys)
  : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])]))
  : v
export function saveManifest(obj, file = MANIFEST_FILE) {
  writeFileSync(file, JSON.stringify(sortKeys(obj), null, 2) + '\n')
}

// ---- 상한 ----
// 각각 LIMIT_<NAME> 환경변수로 덮어쓸 수 있다(테스트에서 낮춰 쓴다).
const MiB = 1 << 20
function lim(env, dflt) {
  const v = process.env[env]
  if (v === undefined || v === '') return dflt
  if (!/^\d+$/.test(v) || Number(v) <= 0) throw new Error(`${env} must be a positive integer, got ${JSON.stringify(v)}`)
  return Number(v)
}
export const LIMITS = Object.freeze({
  zipBytes: lim('LIMIT_ZIP_BYTES', 512 * MiB),        // ZIP 하나의 최대 크기
  memberBytes: lim('LIMIT_MEMBER_BYTES', 1024 * MiB), // 추출 멤버 하나의 최대 크기
  totalBytes: lim('LIMIT_TOTAL_BYTES', 3 * 1024 * MiB), // 추출 멤버 합계
  entries: lim('LIMIT_ENTRIES', 50),                  // ZIP 안의 항목 수
  redirects: lim('LIMIT_REDIRECTS', 5),
  zipTimeoutMs: lim('LIMIT_ZIP_TIMEOUT_MS', 15 * 60 * 1000),
  apiTimeoutMs: lim('LIMIT_API_TIMEOUT_MS', 30 * 1000),
  idleMs: lim('LIMIT_IDLE_MS', 60 * 1000),            // 청크가 이만큼 안 오면 중단
  tailBytes: lim('LIMIT_TAIL_BYTES', 64 * MiB),       // </Product> 없이 쌓이는 꼬리의 상한
  headBytes: lim('LIMIT_HEAD_BYTES', 16 * MiB),       // <Products Count= 를 찾는 범위
})

// ---- 스냅샷 이름 → 경로 ----
export const slug = (name) => name.toLowerCase().replace(/\s+/g, '-')
export const snapshotDir = (name, base = DATA) => join(base, slug(name))
export const yearOf = (name) => Number(/(\d{4})$/.exec(name)[1])
export const years = () => RISE.history.map(yearOf)
export const wantedSnapshots = () => [...new Set([...RISE.history, RISE.before])]
export const expectedFor = (year) => RISE.expected[String(year)] ?? null
export const isCandidate = () => process.argv.includes('--candidate') || process.env.CANDIDATE === '1'

const KIND_PREFIX = { Hospital: 'Hospital Open', Combined: 'Combined Open', Funds: 'Funds' }

function listDir(dir) {
  if (!existsSync(dir)) throw new Error(`missing snapshot directory ${dir} — run \`npm run fetch\``)
  return readdirSync(dir)
}
// 디렉터리 안에서 종류당 정확히 하나의 멤버를 찾는다. 스탬프를 하드코딩하지 않는다.
export function findMember(dir, kind) {
  const prefix = KIND_PREFIX[kind]
  if (!prefix) throw new Error(`unknown member kind ${JSON.stringify(kind)} (Hospital | Combined | Funds)`)
  const hits = listDir(dir).filter(f => XML_RE.exec(f)?.[1] === prefix)
  if (hits.length !== 1) {
    throw new Error(`expected exactly one "${prefix} DD-Mon-YYYY.xml" in ${dir}, found ${hits.length}${hits.length ? ': ' + hits.join(', ') : ''}`)
  }
  return join(dir, hits[0])
}
export const xmlPath = (name, kind) => findMember(snapshotDir(name), kind)

export function stampOf(name) {
  const dir = snapshotDir(name)
  const stamps = new Set(listDir(dir).map(f => XML_RE.exec(f)?.[2]).filter(Boolean))
  if (stamps.size !== 1) throw new Error(`expected one shared DD-Mon-YYYY stamp in ${dir}, found ${stamps.size ? [...stamps].join(', ') : 'none'}`)
  return [...stamps][0]
}
const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' }
export function stampToIso(stamp) {
  const m = /^(\d{2})-([A-Z][a-z]{2})-(\d{4})$/.exec(stamp)
  if (!m || !Object.hasOwn(MONTHS, m[2])) throw new Error(`bad stamp ${JSON.stringify(stamp)}, expected DD-Mon-YYYY`)
  return `${m[3]}-${MONTHS[m[2]]}-${m[1]}`
}
export function csvPath(name) {
  const dir = snapshotDir(name)
  const hits = listDir(dir).filter(f => CSV_RE.test(f))
  if (hits.length !== 1) throw new Error(`expected exactly one "Product Changes DD-Mon-YYYY.csv" in ${dir}, found ${hits.length}`)
  return join(dir, hits[0])
}
