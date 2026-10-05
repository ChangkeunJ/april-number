// 새 PHIO 스냅샷을 찾는다. CKAN package_show 의 자원 표를 rise.json·snapshots.json 과 대조해
// (a) 다음 인상 연도(riseYear+1)의 March/April 이 새로 올라왔는지, (b) 이미 기록한 자원이
// 재발행됐는지(last_modified·size·hash 변화) 본다. 네트워크는 package_show 한 번뿐이다.
//
//   node src/discover.mjs                  사람이 읽는 요약. exit 0 새 것 없음 / 10 새 것 있음 / 1 오류
//   node src/discover.mjs --json           같은 내용을 JSON 객체 하나로 (exit 코드 동일)
//   node src/discover.mjs --github-output  $GITHUB_OUTPUT 에 found=/kind=/year= 를 덧붙인다.
//                                          결과는 출력 파일로 전하므로 오류가 아니면 exit 0 이다.
//   node src/discover.mjs --apply          April y 가 있으면 rise.json 을 y 로 옮기고(announcedAverage·
//                                          links.circular 은 null), 새 이름을 snapshots.json 에 stub 으로
//                                          적는다(sha256/members 는 fetch 가 채운다). March y 만 있으면
//                                          rise.json 은 그대로 두고 stub 만 적는다. 재발행만 있으면
//                                          고치지 않고 exit 10 — 사람이 --refresh 로 결정한다.
//   node src/discover.mjs --refresh NAME   재발행을 받아들이는 유일한 경로: 매니페스트 항목의 sha256 과
//                                          members 를 지운다. 다음 fetch 가 다시 받아 기록한다. 네트워크 없음.
//   node src/discover.mjs --probe NAME     자원 URL 의 리다이렉트 체인을 hop 마다 보여 준다. allowlist 를
//                                          적용하지 않되 밖에 있는 hop 을 표시한다 — rise.json downloadHosts 용.
//
// rise.json/snapshots.json 경로는 config.mjs 가 정한다(RISE_FILE/MANIFEST_FILE). main() 은 매번 디스크에서
// 다시 읽고 fetchImpl 을 주입받으므로 테스트가 임시 복사본과 로컬 서버로 돌린다.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RISE_FILE, MANIFEST_FILE, LIMITS, loadRise, loadManifest, saveManifest, validateRise } from './config.mjs'
import { packageShow, resourcesByName, allowedUrl, USER_AGENT } from './ckan.mjs'

export const EXIT = Object.freeze({ none: 0, found: 10, error: 1 })
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const REDIRECT = new Set([301, 302, 303, 307, 308])

const USAGE = `usage: node src/discover.mjs [--json | --github-output | --apply | --refresh NAME | --probe NAME] [--help]
  (no flag)        summary of new / republished PHIO snapshots; exit 0 nothing new, 10 something new, 1 error
  --json           the same as one JSON object on stdout
  --github-output  append found=, kind=, year= to $GITHUB_OUTPUT (exit 0 unless an error)
  --apply          move rise.json to the new year when "April <y>" exists; add manifest stubs for new names
  --refresh NAME   accept a republished resource: drop sha256/members from its snapshots.json entry (offline)
  --probe NAME     print the redirect chain of a resource URL and flag hosts outside rise.json downloadHosts
NAME is a snapshot name such as "April 2026". Paths come from RISE_FILE / MANIFEST_FILE (default rise.json / snapshots.json).`

const monthIndex = (name) => MONTHS.indexOf(name.split(' ')[0])
const yearOf = (name) => Number(name.split(' ')[1])
const byDate = (a, b) => (yearOf(a.name) - yearOf(b.name)) || (monthIndex(a.name) - monthIndex(b.name))
const mb = (n) => (Number.isFinite(n) ? `${(n / 1e6).toFixed(0)} MB` : 'size unknown')

// package_show 의 자원 중 "PrivateHealth.gov.au <Month> <Year>.zip" 만 평평한 표로. 날짜순.
export function resourceTable(pkg) {
  const rows = []
  for (const [name, r] of resourcesByName(pkg)) {
    rows.push({
      name,
      id: typeof r.id === 'string' ? r.id : null,
      url: r.url,
      size: Number.isFinite(r.size) ? r.size : null,
      hash: typeof r.hash === 'string' ? r.hash.trim() : '',
      last_modified: typeof r.last_modified === 'string' ? r.last_modified : null,
      metadata_modified: typeof r.metadata_modified === 'string' ? r.metadata_modified : null,
    })
  }
  return rows.sort(byDate)
}

// 표를 rise.json/snapshots.json 과 대조한다. 순수 함수.
// kind: before(March y 만 새로) | after(April y 만) | both | republished(새 것 없고 재발행만) | none
export function compare(table, { rise, manifest }) {
  const y = rise.riseYear + 1
  const byName = new Map(table.map(r => [r.name, r]))
  const have = manifest.resources ?? {}
  const lookingFor = [`March ${y}`, `April ${y}`]
  const fresh = lookingFor.filter(n => byName.has(n) && !Object.hasOwn(have, n)).map(n => byName.get(n))

  const norm = (v) => (v == null ? null : String(v))
  const republished = [], missing = []
  for (const [name, e] of Object.entries(have)) {
    const r = byName.get(name)
    if (!r) { missing.push(name); continue }
    const diffs = []
    if (norm(e.last_modified) !== norm(r.last_modified)) diffs.push({ field: 'last_modified', was: e.last_modified ?? null, now: r.last_modified })
    if (norm(e.size) !== norm(r.size)) diffs.push({ field: 'size', was: e.size ?? null, now: r.size })
    const h0 = typeof e.ckanHash === 'string' ? e.ckanHash.trim() : ''
    if (r.hash !== '' && r.hash !== h0) diffs.push({ field: 'hash', was: h0, now: r.hash })
    if (diffs.length) republished.push({ name, diffs })
  }
  const names = new Set(fresh.map(r => r.name))
  const kind = names.has(`April ${y}`) ? (names.has(`March ${y}`) ? 'both' : 'after')
    : names.has(`March ${y}`) ? 'before'
    : republished.length ? 'republished' : 'none'
  return {
    found: kind !== 'none', kind, year: fresh.length ? y : rise.riseYear,
    riseYear: rise.riseYear, before: rise.before, after: rise.after,
    lookingFor, new: fresh, republished, missing, resources: table,
  }
}

export async function discover({ fetchImpl = fetch, limits = LIMITS, riseFile = RISE_FILE, manifestFile = MANIFEST_FILE } = {}) {
  const rise = loadRise(riseFile)
  const manifest = loadManifest(manifestFile)
  let pkg
  try {
    pkg = await packageShow({ fetchImpl, limits, pkgId: manifest.package })
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new Error(`cannot reach CKAN package_show: timed out after ${limits.apiTimeoutMs} ms`)
    if (e?.message === 'fetch failed') throw new Error(`cannot reach CKAN package_show: fetch failed${e.cause?.code ? ` (${e.cause.code})` : ''}`)
    throw e
  }
  return compare(resourceTable(pkg), { rise, manifest })
}

// --apply. 반환: 바뀐 것의 설명 줄들 (없으면 빈 배열).
export function applyResult(result, { riseFile = RISE_FILE, manifestFile = MANIFEST_FILE } = {}) {
  const changed = []
  if (!result.new.length) return changed
  const y = result.year
  if (result.new.some(r => r.name === `April ${y}`)) {
    // 검증 전 원본 객체를 고쳐야 파일의 키 순서가 그대로 남는다.
    const raw = JSON.parse(readFileSync(riseFile, 'utf8'))
    const from = raw.riseYear
    raw.riseYear = y
    raw.riseDate = `${y}-04-01`
    raw.before = `March ${y}`
    raw.after = `April ${y}`
    if (!Array.isArray(raw.history)) raw.history = []
    if (!raw.history.includes(`April ${y}`)) raw.history.push(`April ${y}`)
    raw.announcedAverage = null
    if (!raw.links || typeof raw.links !== 'object' || Array.isArray(raw.links)) raw.links = {}
    raw.links.circular = null
    validateRise(structuredClone(raw), riseFile)   // 쓰기 전에 모양을 확인한다 (validateRise 는 expected 를 채울 수 있어 복사본으로)
    writeFileSync(riseFile, JSON.stringify(raw, null, 2) + '\n')
    changed.push(`${riseFile}: riseYear ${from} → ${y}, riseDate ${raw.riseDate}, before "${raw.before}", after "${raw.after}", history ends with "${raw.after}", announcedAverage null, links.circular null (fill both from the PHI circular)`)
  } else {
    changed.push(`${riseFile}: unchanged (only "March ${y}" is new; rise.json moves when "April ${y}" appears)`)
  }
  const manifest = loadManifest(manifestFile)
  for (const r of result.new) {
    if (Object.hasOwn(manifest.resources, r.name)) continue
    manifest.resources[r.name] = { id: r.id, url: r.url, size: r.size, ckanHash: r.hash || '', last_modified: r.last_modified }
    changed.push(`${manifestFile}: + "${r.name}" stub (id, url, size, ckanHash, last_modified; sha256/members are filled by npm run fetch)`)
  }
  saveManifest(manifest, manifestFile)
  return changed
}

// --refresh NAME. 반환: 지운 키들.
export function refresh(name, { manifestFile = MANIFEST_FILE } = {}) {
  const manifest = loadManifest(manifestFile)
  if (!Object.hasOwn(manifest.resources, name)) {
    throw new Error(`${manifestFile} has no entry named ${JSON.stringify(name)} (known: ${Object.keys(manifest.resources).join(', ') || 'none'})`)
  }
  const e = manifest.resources[name]
  const dropped = ['sha256', 'members'].filter(k => Object.hasOwn(e, k))
  delete e.sha256
  delete e.members
  saveManifest(manifest, manifestFile)
  return dropped
}

// --probe NAME. HEAD 로, 안 되면 GET 으로 헤더만 받고 본문은 바로 끊는다. 반환: hop 배열.
export async function probe(name, { fetchImpl = fetch, limits = LIMITS, hosts, manifestFile = MANIFEST_FILE, riseFile = RISE_FILE, log = () => {} } = {}) {
  const manifest = loadManifest(manifestFile)
  hosts ??= loadRise(riseFile).downloadHosts
  const pkg = await packageShow({ fetchImpl, limits, pkgId: manifest.package })
  const res = resourcesByName(pkg).get(name)
  if (!res) throw new Error(`no resource named "PrivateHealth.gov.au ${name}.zip" in package_show`)
  const hops = []
  let u = res.url
  for (let hop = 0; ; hop++) {
    let url
    try { url = new URL(u) } catch { throw new Error(`hop ${hop}: not a URL: ${u}`) }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`hop ${hop}: refusing to follow ${url.protocol} URL ${u}`)
    const allowed = allowedUrl(u, hosts)
    let r, method = 'HEAD'
    const opts = () => ({ method, redirect: 'manual', signal: AbortSignal.timeout(limits.apiTimeoutMs), headers: { 'user-agent': USER_AGENT } })
    try {
      r = await fetchImpl(u, opts())
      if (r.status >= 400) { try { await r.body?.cancel() } catch {} ; r = null }
    } catch { r = null }
    if (!r) { method = 'GET'; r = await fetchImpl(u, opts()) }
    const h = {
      hop, method, url: u, status: r.status, allowed,
      // fetch 가 거부하는 이유: 스킴이 https 가 아니거나(호스트와 무관), 호스트가 allowlist 밖이거나.
      why: allowed ? '' : url.protocol !== 'https:' ? 'not https (fetch refuses it whatever downloadHosts says)' : 'host NOT in rise.json downloadHosts',
      location: r.headers.get('location'), type: r.headers.get('content-type'), length: r.headers.get('content-length'),
    }
    try { await r.body?.cancel() } catch {}   // 본문은 받지 않는다
    hops.push(h)
    log(`  hop ${hop}: ${method} ${u} → ${r.status}${h.location ? ` → ${h.location}` : ''}${h.length ? ` (${mb(Number(h.length))}${h.type ? `, ${h.type}` : ''})` : ''}${allowed ? '' : `   <- ${h.why}`}`)
    if (REDIRECT.has(r.status) && h.location) {
      if (hop + 1 > limits.redirects) throw new Error(`more than ${limits.redirects} redirects starting at ${res.url}`)
      u = new URL(h.location, u).href
      continue
    }
    break
  }
  return hops
}

function summary(result, log) {
  const r = result
  log(`CKAN: ${r.resources.length} monthly snapshot resources; rise.json riseYear ${r.riseYear} (before "${r.before}", after "${r.after}")`)
  log(`looking for: ${r.lookingFor.map(n => `"${n}"`).join(', ')}`)
  if (r.new.length) for (const n of r.new) log(`  new:         "${n.name}" id ${n.id ?? '?'} ${mb(n.size)} last_modified ${n.last_modified ?? '?'}${n.hash ? ` hash ${n.hash}` : ''}`)
  else log('  new:         none')
  if (r.republished.length) for (const p of r.republished) log(`  republished: "${p.name}" — ${p.diffs.map(d => `${d.field} ${JSON.stringify(d.was)} → ${JSON.stringify(d.now)}`).join('; ')}`)
  else log('  republished: none')
  for (const n of r.missing) log(`  warning:     "${n}" is in snapshots.json but no longer in package_show`)
}

function parseArgs(argv) {
  const o = { mode: 'summary', name: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') { o.mode = 'help'; return o }
    else if (a === '--json' || a === '--github-output' || a === '--apply') o.mode = a.slice(2)
    else if (a === '--refresh' || a === '--probe') {
      o.mode = a.slice(2); o.name = argv[++i]
      if (typeof o.name !== 'string' || o.name === '' || o.name.startsWith('--')) throw new Error(`${a} needs a snapshot name such as "April 2026"`)
    } else throw new Error(`unknown argument ${JSON.stringify(a)}\n${USAGE}`)
  }
  return o
}

// CLI 본체. exit 코드를 돌려준다 (process.exit 은 아래 가드에서만).
export async function main(argv = process.argv.slice(2), {
  fetchImpl = fetch, limits = LIMITS, env = process.env, riseFile = RISE_FILE, manifestFile = MANIFEST_FILE,
  log = console.log, error = console.error,
} = {}) {
  let o
  try { o = parseArgs(argv) } catch (e) { error(`discover: ${e.message}`); return EXIT.error }
  if (o.mode === 'help') { log(USAGE); return EXIT.none }
  try {
    if (o.mode === 'refresh') {
      const dropped = refresh(o.name, { manifestFile })
      log(`${manifestFile}: "${o.name}" — dropped ${dropped.length ? dropped.join(' and ') : 'nothing (entry had no sha256/members)'}; the next npm run fetch re-downloads it and records the new hashes`)
      return EXIT.none
    }
    if (o.mode === 'probe') {
      log(`probe "${o.name}":`)
      const hops = await probe(o.name, { fetchImpl, limits, manifestFile, riseFile, log })
      const outside = [...new Set(hops.filter(h => !h.allowed && new URL(h.url).protocol === 'https:').map(h => new URL(h.url).hostname))]
      const insecure = hops.filter(h => new URL(h.url).protocol !== 'https:').length
      if (outside.length) log(`fetch would refuse this chain. Add to rise.json downloadHosts: ${JSON.stringify(outside)}`)
      if (insecure) log(`${insecure} hop(s) are plain http — fetch refuses those regardless of downloadHosts`)
      if (!outside.length && !insecure) log('every hop is https on an allowlisted host')
      return EXIT.none
    }
    if (o.mode === 'github-output' && !env.GITHUB_OUTPUT) throw new Error('--github-output needs $GITHUB_OUTPUT (set by GitHub Actions for each step)')
    const result = await discover({ fetchImpl, limits, riseFile, manifestFile })
    if (o.mode === 'json') {
      log(JSON.stringify(result))
      return result.found ? EXIT.found : EXIT.none
    }
    if (o.mode === 'github-output') {
      appendFileSync(env.GITHUB_OUTPUT, `found=${result.found}\nkind=${result.kind}\nyear=${result.year}\n`)
      summary(result, log)
      log(`wrote found=${result.found} kind=${result.kind} year=${result.year} to GITHUB_OUTPUT`)
      return EXIT.none
    }
    summary(result, log)
    if (o.mode === 'apply') {
      if (!result.new.length) {
        if (result.republished.length) {
          error(`discover: nothing new to apply, but ${result.republished.length} recorded resource(s) changed on CKAN. Decide by hand: node src/discover.mjs --refresh "<name>" then npm run fetch.`)
          return EXIT.found
        }
        log('nothing to apply')
        return EXIT.none
      }
      for (const line of applyResult(result, { riseFile, manifestFile })) log(line)
      if (result.republished.length) log(`note: ${result.republished.length} recorded resource(s) also changed on CKAN (see above); fetch stops if a stored zip sha256 no longer matches`)
      return EXIT.none
    }
    if (result.found) {
      log(`NEW — kind ${result.kind}, year ${result.year}. Next: node src/discover.mjs --apply${result.kind === 'republished' ? ' (republished only: --refresh "<name>" after checking why)' : ''}`)
      return EXIT.found
    }
    log('nothing new')
    return EXIT.none
  } catch (e) {
    error(`discover: ${e.message}`)
    return EXIT.error
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => process.exit(code), e => { console.error(`discover: ${e.message}`); process.exit(EXIT.error) })
}
