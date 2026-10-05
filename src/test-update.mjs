// npm run test:unit 의 두 번째 러너 — discover.mjs 와 report.mjs 를 네트워크 없이 검사한다.
// rise.json/snapshots.json 은 임시 복사본(RISE_FILE/MANIFEST_FILE)이고 CKAN 은 주입한 fetchImpl 이다.
// 환경변수를 config.mjs 보다 먼저 세워야 하므로 import 는 전부 동적이다 (test-unit.mjs 와 같은 틀).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, copyFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FIX = join(ROOT, 'test', 'fixtures')
const TMP = mkdtempSync(join(tmpdir(), 'april-update-'))
// 임시 디렉터리는 어떻게 끝나든 지운다: 아래 동적 import 가 죽어도, 그룹 밖에서 예외가 나도, Ctrl-C 로 끊어도.
process.on('exit', () => rmSync(TMP, { recursive: true, force: true }))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(1))
// 저장소의 snapshots.json 과 reports/ 는 (내용이 무엇이든, reports/ 가 있든 없든) 손대지 않아야 한다 — 전후를 비교한다.
const treeStamp = (d) => (existsSync(d) ? readdirSync(d).sort().map(f => { const s = statSync(join(d, f)); return `${f}:${s.size}:${s.mtimeMs}` }).join('\n') : null)
const REPO_REPORTS = join(ROOT, 'reports')
const repoReportsBefore = treeStamp(REPO_REPORTS)
const committedManifest = readFileSync(join(ROOT, 'snapshots.json'), 'utf8')
const RISE = join(TMP, 'rise.json'), MANIFEST = join(TMP, 'snapshots.json'), REPORTS = join(TMP, 'reports')
copyFileSync(join(FIX, 'rise.json'), RISE)   // riseYear 2026, history [April 2025, April 2026], expected 2026 pinned
const ENV = { RISE_FILE: RISE, DATA_DIR: join(FIX, 'data'), MANIFEST_FILE: MANIFEST, REPORTS_DIR: REPORTS }
Object.assign(process.env, ENV)
delete process.env.CANDIDATE
delete process.env.GITHUB_OUTPUT
process.argv = process.argv.filter(a => a !== '--candidate')

const { PKG, loadRise, loadManifest, saveManifest, validateRise, LIMITS } = await import('./config.mjs')
const { API } = await import('./ckan.mjs')
const discover = await import('./discover.mjs')
const report = await import('./report.mjs')
const { build } = await import('./build.mjs')

let failed = 0
async function group(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`) }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${(e.stack || e.message).split('\n').slice(0, 6).join('\n       ')}`) }
}
const noop = () => {}
// spawnSync: 성공한 자식의 stderr 도 본다 (report 는 빠진 입력을 stderr 로 말하고 0 으로 끝난다).
function runCli(script, { env = {}, cwd = TMP, args = [] } = {}) {
  const r = spawnSync(process.execPath, [join(ROOT, 'src', script), ...args], { cwd, env: { ...process.env, ...ENV, ...env }, encoding: 'utf8' })
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

// ---- 합성 CKAN ----
const slug = (n) => n.toLowerCase().replace(/\s+/g, '-')
const LM = { 'April 2025': '2025-04-02T03:04:05.000000', 'March 2026': '2026-03-01T01:02:03.000000', 'April 2026': '2026-04-05T06:07:08.000000' }
const res = (name, o = {}) => ({
  id: o.id ?? `id-${slug(name)}`, name: `PrivateHealth.gov.au ${name}.zip`,
  url: o.url ?? `https://data.gov.au/data/dataset/${PKG}/resource/id-${slug(name)}/download/privatehealth-${slug(name)}.zip`,
  size: o.size ?? 100000000, hash: o.hash ?? '', last_modified: 'last_modified' in o ? o.last_modified : LM[name] ?? `${name.split(' ')[1]}-04-05T00:00:00.000000`,
  metadata_modified: '2026-04-05T06:07:08.000000',
})
const BASE = ['April 2022', 'April 2023', 'April 2024', 'April 2025', 'March 2026', 'April 2026']
const pkgJson = (extra = [], mut = noop) => {
  const j = { success: true, result: { id: PKG, license_id: 'cc-by', resources: [
    ...BASE.map(n => res(n)), ...extra,
    { id: 'junk', name: 'privatehealth-05-apr-2026.zip', url: 'https://data.gov.au/junk.zip' },
    { id: 'readme', name: 'ReadMe.docx', url: 'https://data.gov.au/readme.docx' },
  ] } }
  mut(j)
  return j
}
const ckan = (json) => async (u) => { assert.ok(u.startsWith(API + '?id='), `unexpected fetch ${u}`); return new Response(JSON.stringify(json)) }
const ENTRY = (name, stamp) => ({
  id: `id-${slug(name)}`, url: res(name).url, size: 100000000, ckanHash: '', last_modified: LM[name], stamp,
  sha256: 'a'.repeat(64), members: { [`Hospital Open ${stamp}.xml`]: { size: 10, sha256: 'b'.repeat(64) }, [`Combined Open ${stamp}.xml`]: { size: 10, sha256: 'c'.repeat(64) }, [`Funds ${stamp}.xml`]: { size: 10, sha256: 'd'.repeat(64) } },
})
const freshManifest = () => ({ package: PKG, resources: { 'April 2025': ENTRY('April 2025', '02-Apr-2025'), 'March 2026': ENTRY('March 2026', '01-Mar-2026'), 'April 2026': ENTRY('April 2026', '05-Apr-2026') } })
const resetFiles = () => { copyFileSync(join(FIX, 'rise.json'), RISE); saveManifest(freshManifest(), MANIFEST) }
const manifest = () => loadManifest(MANIFEST)

// main() 을 프로세스 안에서 돌린다: 반환 코드와 stdout/stderr 줄.
async function run(args, { json = pkgJson(), fetchImpl = ckan(json), env = {}, limits = LIMITS } = {}) {
  const out = [], err = []
  const code = await discover.main(args, { fetchImpl, env, limits, riseFile: RISE, manifestFile: MANIFEST, log: (s) => out.push(String(s)), error: (s) => err.push(String(s)) })
  return { code, out: out.join('\n'), err: err.join('\n') }
}

await group('discover: resourceTable is filtered, normalised and date-sorted; compare is pure', () => {
  const j = pkgJson([res('March 2027', { size: '123', hash: ' md5:abc ', last_modified: null, id: 7 })])
  const t = discover.resourceTable(j.result)
  assert.deepEqual(t.map(r => r.name), ['April 2022', 'April 2023', 'April 2024', 'April 2025', 'March 2026', 'April 2026', 'March 2027'])
  const m27 = t.at(-1)
  assert.equal(m27.size, null, 'non-number size → null'); assert.equal(m27.hash, 'md5:abc', 'hash trimmed'); assert.equal(m27.last_modified, null); assert.equal(m27.id, null, 'non-string id → null')
  assert.equal(t[5].size, 100000000); assert.equal(t[5].last_modified, LM['April 2026'])
  const rise = loadRise(join(FIX, 'rise.json'))
  const r = discover.compare(t, { rise, manifest: freshManifest() })
  assert.equal(r.kind, 'before'); assert.equal(r.found, true); assert.equal(r.year, 2027); assert.equal(r.riseYear, 2026)
  assert.deepEqual(r.lookingFor, ['March 2027', 'April 2027']); assert.deepEqual(r.new.map(x => x.name), ['March 2027'])
  assert.deepEqual(r.republished, []); assert.deepEqual(r.missing, [])
  const none = discover.compare(discover.resourceTable(pkgJson().result), { rise, manifest: freshManifest() })
  assert.deepEqual([none.kind, none.found, none.year], ['none', false, 2026])
  // 매니페스트에 있는데 CKAN 에서 사라진 이름은 warning 으로만
  const gone = discover.compare(discover.resourceTable(pkgJson([], j2 => { j2.result.resources = j2.result.resources.filter(x => !x.name.includes('April 2025')) }).result), { rise, manifest: freshManifest() })
  assert.deepEqual(gone.missing, ['April 2025']); assert.equal(gone.kind, 'none')
})

await group('discover: nothing new → exit 0; --json is one parseable object', async () => {
  resetFiles()
  let r = await run([])
  assert.equal(r.code, 0, r.err); assert.match(r.out, /nothing new/); assert.match(r.out, /new: {9}none/); assert.match(r.out, /republished: none/)
  assert.match(r.out, /CKAN: 6 monthly snapshot resources; rise\.json riseYear 2026 \(before "March 2026", after "April 2026"\)/)
  r = await run(['--json'])
  assert.equal(r.code, 0)
  const j = JSON.parse(r.out)
  assert.deepEqual([j.found, j.kind, j.year, j.riseYear, j.before, j.after], [false, 'none', 2026, 2026, 'March 2026', 'April 2026'])
  assert.equal(j.resources.length, 6); assert.deepEqual(j.new, [])
  r = await run(['--apply'])
  assert.equal(r.code, 0); assert.match(r.out, /nothing to apply/)
  assert.equal(readFileSync(RISE, 'utf8'), readFileSync(join(FIX, 'rise.json'), 'utf8'), 'rise.json untouched')
})

await group('discover: March 2027 only → kind before, exit 10; --apply stubs the manifest and leaves rise.json byte-identical', async () => {
  resetFiles()
  const json = pkgJson([res('March 2027', { hash: 'md5:' + '1'.repeat(32), size: 123456789, last_modified: '2027-03-02T00:00:00.000000' })])
  let r = await run([], { json })
  assert.equal(r.code, 10); assert.match(r.out, /new: {9}"March 2027" id id-march-2027 123 MB last_modified 2027-03-02T00:00:00\.000000 hash md5:1+/); assert.match(r.out, /NEW — kind before, year 2027/)
  r = await run(['--json'], { json })
  assert.equal(r.code, 10); const j = JSON.parse(r.out); assert.deepEqual([j.kind, j.year], ['before', 2027])
  const before = readFileSync(RISE, 'utf8')
  r = await run(['--apply'], { json })
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /rise\.json: unchanged \(only "March 2027" is new/); assert.match(r.out, /\+ "March 2027" stub/)
  assert.equal(readFileSync(RISE, 'utf8'), before, 'rise.json byte-identical')
  const m = manifest()
  assert.deepEqual(m.resources['March 2027'], { ckanHash: 'md5:' + '1'.repeat(32), id: 'id-march-2027', last_modified: '2027-03-02T00:00:00.000000', size: 123456789, url: res('March 2027').url })
  assert.deepEqual(Object.keys(m.resources['March 2027']), ['ckanHash', 'id', 'last_modified', 'size', 'url'], 'sorted keys, no sha256/members')
  assert.deepEqual(m.resources['April 2026'], freshManifest().resources['April 2026'], 'existing entries untouched')
  assert.ok(readFileSync(MANIFEST, 'utf8').endsWith('}\n'))
  // 두 번째 --apply: March 2027 는 이제 매니페스트에 있으니 새 것이 없다
  r = await run(['--apply'], { json })
  assert.equal(r.code, 0); assert.match(r.out, /nothing to apply/)
  r = await run([], { json })
  assert.equal(r.code, 0); assert.match(r.out, /nothing new/)
})

await group('discover: April 2027 → kind after/both; --apply rewrites rise.json exactly and keeps unrelated keys', async () => {
  // March 2027 stub already present from the previous group → April only is "after"
  const both = pkgJson([res('March 2027'), res('April 2027', { hash: 'sha256:' + '2'.repeat(64), last_modified: '2027-04-06T07:08:09.000000', size: 234567890 })])
  let r = await run(['--json'], { json: both })
  assert.equal(r.code, 10); assert.equal(JSON.parse(r.out).kind, 'after')
  resetFiles()
  r = await run(['--json'], { json: both })
  assert.equal(r.code, 10); const j = JSON.parse(r.out); assert.equal(j.kind, 'both'); assert.deepEqual(j.new.map(x => x.name), ['March 2027', 'April 2027'])

  const origText = readFileSync(RISE, 'utf8'); const orig = JSON.parse(origText)
  r = await run(['--apply'], { json: both })
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /riseYear 2026 → 2027, riseDate 2027-04-01, before "March 2027", after "April 2027", history ends with "April 2027", announcedAverage null, links\.circular null/)
  assert.match(r.out, /\+ "March 2027" stub/); assert.match(r.out, /\+ "April 2027" stub/)
  const text = readFileSync(RISE, 'utf8'); const now = JSON.parse(text)
  assert.equal(text, JSON.stringify(now, null, 2) + '\n', 'JSON.stringify(obj, null, 2) + newline')
  assert.deepEqual(Object.keys(now), Object.keys(orig), 'same key order as the file')
  assert.deepEqual(Object.keys(now.links), Object.keys(orig.links))
  assert.equal(now.riseYear, 2027); assert.equal(now.riseDate, '2027-04-01'); assert.equal(now.before, 'March 2027'); assert.equal(now.after, 'April 2027')
  assert.deepEqual(now.history, [...orig.history, 'April 2027'])
  assert.equal(now.announcedAverage, null); assert.equal(now.links.circular, null); assert.equal(now.links.perInsurer, orig.links.perInsurer)
  assert.deepEqual(now.restrictedFunds, orig.restrictedFunds); assert.deepEqual(now.downloadHosts, orig.downloadHosts); assert.deepEqual(now.expected, orig.expected)
  assert.doesNotThrow(() => validateRise(structuredClone(now)))
  assert.equal(loadRise(RISE).riseYear, 2027)
  const m = manifest()
  assert.deepEqual(m.resources['April 2027'], { ckanHash: 'sha256:' + '2'.repeat(64), id: 'id-april-2027', last_modified: '2027-04-06T07:08:09.000000', size: 234567890, url: res('April 2027').url })
  assert.ok(!('sha256' in m.resources['April 2027']) && !('members' in m.resources['April 2027']))
  assert.deepEqual(Object.keys(m.resources).sort(), ['April 2025', 'April 2026', 'April 2027', 'March 2026', 'March 2027'])
  // 다음 실행: riseYear 2027 → 2028 을 찾고, 없으니 조용하다
  r = await run(['--json'], { json: both })
  assert.equal(r.code, 0); const k = JSON.parse(r.out); assert.deepEqual([k.kind, k.year, k.riseYear, k.lookingFor], ['none', 2027, 2027, ['March 2028', 'April 2028']])
  // 이미 history 에 있으면 두 번 넣지 않는다 (사람이 미리 적어 둔 경우)
  resetFiles()
  const pre = JSON.parse(readFileSync(RISE, 'utf8')); pre.history.push('April 2027'); pre.after = 'April 2027'; pre.riseYear = 2027; pre.riseDate = '2027-04-01'
  writeFileSync(RISE, JSON.stringify(pre, null, 2) + '\n')
  const fake = { ...discover.compare(discover.resourceTable(both.result), { rise: loadRise(join(FIX, 'rise.json')), manifest: freshManifest() }) }
  discover.applyResult(fake, { riseFile: RISE, manifestFile: MANIFEST })
  assert.deepEqual(JSON.parse(readFileSync(RISE, 'utf8')).history, [...orig.history, 'April 2027'])
})

await group('discover: republished detection (last_modified / size / hash) and --apply refusing to decide', async () => {
  resetFiles()
  const lm = pkgJson([], j => { j.result.resources.find(x => x.name.includes('April 2026')).last_modified = '2026-04-20T00:00:00.000000' })
  let r = await run(['--json'], { json: lm })
  assert.equal(r.code, 10); let j = JSON.parse(r.out)
  assert.deepEqual([j.found, j.kind, j.year], [true, 'republished', 2026])
  assert.deepEqual(j.republished, [{ name: 'April 2026', diffs: [{ field: 'last_modified', was: LM['April 2026'], now: '2026-04-20T00:00:00.000000' }] }])
  r = await run([], { json: lm })
  assert.equal(r.code, 10); assert.match(r.out, /republished: "April 2026" — last_modified "2026-04-05T06:07:08\.000000" → "2026-04-20T00:00:00\.000000"/); assert.match(r.out, /republished only: --refresh/)
  const sz = pkgJson([], j2 => { j2.result.resources.find(x => x.name.includes('March 2026')).size = 5 })
  j = JSON.parse((await run(['--json'], { json: sz })).out)
  assert.deepEqual(j.republished[0], { name: 'March 2026', diffs: [{ field: 'size', was: 100000000, now: 5 }] })
  const hs = pkgJson([], j3 => { j3.result.resources.find(x => x.name.includes('April 2025')).hash = 'md5:' + 'e'.repeat(32) })
  j = JSON.parse((await run(['--json'], { json: hs })).out)
  assert.deepEqual(j.republished[0], { name: 'April 2025', diffs: [{ field: 'hash', was: '', now: 'md5:' + 'e'.repeat(32) }] })
  // CKAN 해시가 빈 문자열이면 (보통 그렇다) 기록된 해시와 비교하지 않는다
  const m = freshManifest(); m.resources['April 2025'].ckanHash = 'md5:' + 'f'.repeat(32); saveManifest(m, MANIFEST)
  j = JSON.parse((await run(['--json'])).out)
  assert.equal(j.kind, 'none', 'empty CKAN hash is not a difference')
  // 재발행만 있을 때 --apply 는 손대지 않고 exit 10 으로 사람을 부른다
  resetFiles()
  const riseBefore = readFileSync(RISE, 'utf8'), manBefore = readFileSync(MANIFEST, 'utf8')
  r = await run(['--apply'], { json: lm })
  assert.equal(r.code, 10); assert.match(r.err, /nothing new to apply, but 1 recorded resource\(s\) changed on CKAN.*--refresh "<name>"/)
  assert.equal(readFileSync(RISE, 'utf8'), riseBefore); assert.equal(readFileSync(MANIFEST, 'utf8'), manBefore)
  // 새 것 + 재발행: 새 것은 적용하고 재발행은 note 로
  const mix = pkgJson([res('March 2027')], j4 => { j4.result.resources.find(x => x.name.includes('April 2026')).last_modified = '2026-04-20T00:00:00.000000' })
  r = await run(['--apply'], { json: mix })
  assert.equal(r.code, 0, r.err); assert.match(r.out, /\+ "March 2027" stub/); assert.match(r.out, /note: 1 recorded resource\(s\) also changed on CKAN/)
  assert.ok(manifest().resources['March 2027'])
})

await group('discover: --refresh drops sha256 and members only; unknown name is an error; offline', async () => {
  resetFiles()
  const r = await run(['--refresh', 'April 2026'], { fetchImpl: async () => { throw new Error('network used') } })
  assert.equal(r.code, 0, r.err); assert.match(r.out, /"April 2026" — dropped sha256 and members; the next npm run fetch re-downloads it/)
  const e = manifest().resources['April 2026']
  assert.ok(!('sha256' in e) && !('members' in e))
  assert.deepEqual(Object.keys(e), ['ckanHash', 'id', 'last_modified', 'size', 'stamp', 'url'])
  assert.equal(e.stamp, '05-Apr-2026')
  assert.deepEqual(manifest().resources['March 2026'], freshManifest().resources['March 2026'], 'other entries untouched')
  const again = await run(['--refresh', 'April 2026'], { fetchImpl: async () => { throw new Error('network used') } })
  assert.equal(again.code, 0); assert.match(again.out, /dropped nothing/)
  const bad = await run(['--refresh', 'April 1999'], { fetchImpl: async () => { throw new Error('network used') } })
  assert.equal(bad.code, 1); assert.match(bad.err, /has no entry named "April 1999" \(known: April 2025, April 2026, March 2026\)/)
  assert.equal((await run(['--refresh'])).code, 1)
  assert.equal((await run(['--refresh', '--json'])).code, 1)
})

await group('discover: --github-output appends found=/kind=/year= and exits 0 either way', async () => {
  resetFiles()
  const f = join(TMP, 'gh-output.txt'); writeFileSync(f, 'earlier=1\n')
  let r = await run(['--github-output'], { env: { GITHUB_OUTPUT: f } })
  assert.equal(r.code, 0, r.err); assert.equal(readFileSync(f, 'utf8'), 'earlier=1\nfound=false\nkind=none\nyear=2026\n')
  assert.match(r.out, /wrote found=false kind=none year=2026 to GITHUB_OUTPUT/)
  const json = pkgJson([res('March 2027'), res('April 2027')])
  r = await run(['--github-output'], { json, env: { GITHUB_OUTPUT: f } })
  assert.equal(r.code, 0, 'found=true still exits 0 — the output file carries the signal')
  assert.equal(readFileSync(f, 'utf8'), 'earlier=1\nfound=false\nkind=none\nyear=2026\nfound=true\nkind=both\nyear=2027\n')
  let used = false
  r = await run(['--github-output'], { env: {}, fetchImpl: async () => { used = true; throw new Error('x') } })
  assert.equal(r.code, 1); assert.match(r.err, /--github-output needs \$GITHUB_OUTPUT/); assert.equal(used, false, 'checked before touching the network')
})

await group('discover: errors exit 1 with one clear line (package validation, licence, HTTP, network, timeout, usage)', async () => {
  resetFiles()
  let r = await run([], { json: pkgJson([], j => { j.result.license_id = 'cc0' }) })
  assert.equal(r.code, 1); assert.match(r.err, /^discover: licence changed: cc0 — stop and re-read the terms$/)
  r = await run([], { json: pkgJson([], j => { j.success = false }) })
  assert.equal(r.code, 1); assert.match(r.err, /CKAN package_show: success=false/)
  r = await run([], { json: pkgJson([], j => { j.result.id = 'other' }) })
  assert.equal(r.code, 1); assert.match(r.err, /result\.id "other"/)
  r = await run([], { fetchImpl: async () => new Response('down', { status: 503 }) })
  assert.equal(r.code, 1); assert.match(r.err, /^discover: CKAN 503$/)
  r = await run([], { fetchImpl: async () => { throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }) } })
  assert.equal(r.code, 1); assert.match(r.err, /^discover: cannot reach CKAN package_show: fetch failed \(ENOTFOUND\)$/)
  // AbortSignal.timeout 의 타이머는 unref 라 루프를 붙들지 않는다; 실제 fetch 는 소켓이 붙든다. 여기선 타이머로 대신한다.
  r = await run([], { limits: { ...LIMITS, apiTimeoutMs: 50 }, fetchImpl: (u, o) => new Promise((_, rej) => { const keep = setTimeout(noop, 10000); o.signal.addEventListener('abort', () => { clearTimeout(keep); rej(o.signal.reason) }) }) })
  assert.equal(r.code, 1); assert.match(r.err, /^discover: cannot reach CKAN package_show: timed out after 50 ms$/)
  r = await run(['--bogus'])
  assert.equal(r.code, 1); assert.match(r.err, /unknown argument "--bogus"/); assert.match(r.err, /usage: node src\/discover\.mjs/)
  r = await run(['--help'])
  assert.equal(r.code, 0); assert.match(r.out, /^usage: node src\/discover\.mjs/)
  r = await run(['--probe', 'April 1999'])
  assert.equal(r.code, 1); assert.match(r.err, /no resource named "PrivateHealth\.gov\.au April 1999\.zip"/)
  // 깨진 rise.json 도 한 줄로
  writeFileSync(RISE, '{ "riseYear": 2026 }')
  r = await run([])
  assert.equal(r.code, 1); assert.match(r.err, /riseDate must be an ISO date/)
  resetFiles()
})

await group('discover: --probe follows the redirect chain by hand and flags hosts outside downloadHosts', async () => {
  resetFiles()
  const server = createServer((req, res2) => {
    const u = req.url
    if (u === '/start') { res2.writeHead(302, { location: `http://127.0.0.1:${server.address().port}/hop` }); res2.end(); return }
    if (u === '/hop') {
      if (req.method === 'HEAD') { res2.writeHead(405); res2.end(); return }   // GET 으로 넘어가야 한다
      res2.writeHead(200, { 'content-type': 'application/zip', 'content-length': '5000000' }); res2.write(Buffer.alloc(1000)); return   // 본문을 다 보내지 않는다
    }
    if (u === '/loop') { res2.writeHead(302, { location: '/loop' }); res2.end(); return }
    res2.writeHead(404); res2.end()
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  // API → 합성 패키지; https://data.gov.au/r → 가짜 302 (네트워크 없음); https://cdn.example/… → 가짜 200; 나머지는 로컬 서버로 진짜 fetch
  const mix = (url) => async (u, o) => {
    if (u.startsWith(API)) return new Response(JSON.stringify(pkgJson([res('April 2027', { url })])))
    if (u === 'https://data.gov.au/r') { assert.equal(o.redirect, 'manual'); return new Response(null, { status: 302, headers: { location: 'https://cdn.example/x.zip' } }) }
    if (u === 'https://cdn.example/x.zip') return new Response(null, { status: 200, headers: { 'content-length': '350000000', 'content-type': 'application/zip' } })
    return fetch(u, o)
  }
  try {
    // 로컬 http 서버: 체인을 따라가고 HEAD 405 는 GET 으로 넘어가며, http 는 호스트와 무관하게 거부 사유로 표시된다
    let r = await run(['--probe', 'April 2027'], { fetchImpl: mix(`${base}/start`) })
    assert.equal(r.code, 0, r.err)
    assert.match(r.out, new RegExp(`hop 0: HEAD ${base}/start → 302 → ${base}/hop   <- not https \\(fetch refuses it whatever downloadHosts says\\)`))
    assert.match(r.out, new RegExp(`hop 1: GET ${base}/hop → 200 \\(5 MB, application/zip\\)   <- not https`))
    assert.match(r.out, /2 hop\(s\) are plain http — fetch refuses those regardless of downloadHosts/)
    assert.doesNotMatch(r.out, /Add to rise\.json downloadHosts/)
    // https 체인: allowlist 안의 hop 은 표시가 없고, 밖의 호스트는 추가 제안에 오른다
    r = await run(['--probe', 'April 2027'], { fetchImpl: mix('https://data.gov.au/r') })
    assert.equal(r.code, 0, r.err)
    assert.match(r.out, /hop 0: HEAD https:\/\/data\.gov\.au\/r → 302 → https:\/\/cdn\.example\/x\.zip\n/)
    assert.match(r.out, /hop 1: HEAD https:\/\/cdn\.example\/x\.zip → 200 \(350 MB, application\/zip\)   <- host NOT in rise\.json downloadHosts/)
    assert.match(r.out, /fetch would refuse this chain\. Add to rise\.json downloadHosts: \["cdn\.example"\]/)
    const hops = await discover.probe('April 2027', { fetchImpl: mix('https://data.gov.au/r'), riseFile: RISE, manifestFile: MANIFEST, hosts: ['data.gov.au', 'cdn.example'] })
    assert.deepEqual(hops.map(h => [h.hop, h.method, h.status, h.allowed, h.why]), [[0, 'HEAD', 302, true, ''], [1, 'HEAD', 200, true, '']])
    r = await run(['--probe', 'April 2027'], { fetchImpl: mix(`${base}/loop`), limits: { ...LIMITS, redirects: 2 } })
    assert.equal(r.code, 1); assert.match(r.err, /more than 2 redirects/)
    r = await run(['--probe', 'April 2027'], { fetchImpl: mix('ftp://data.gov.au/x.zip') })
    assert.equal(r.code, 1); assert.match(r.err, /refusing to follow ftp:/)
    resetFiles()
  } finally { server.closeAllConnections?.(); await new Promise(r => server.close(r)) }
})

await group('discover: CLI child process — --help, --refresh and bad usage need no network', () => {
  resetFiles()
  let r = runCli('discover.mjs', { args: ['--help'] })
  assert.equal(r.code, 0, r.stderr); assert.match(r.stdout, /^usage: node src\/discover\.mjs/)
  r = runCli('discover.mjs', { args: ['--refresh', 'March 2026'] })
  assert.equal(r.code, 0, r.stderr); assert.match(r.stdout, /"March 2026" — dropped sha256 and members/)
  assert.ok(!('sha256' in manifest().resources['March 2026']))
  r = runCli('discover.mjs', { args: ['--nope'] })
  assert.equal(r.code, 1); assert.match(r.stderr, /unknown argument/)
  r = runCli('discover.mjs', { args: ['--github-output'], env: { GITHUB_OUTPUT: '' } })
  assert.equal(r.code, 1); assert.match(r.stderr, /needs \$GITHUB_OUTPUT/)
  assert.equal(readFileSync(join(ROOT, 'snapshots.json'), 'utf8'), committedManifest, 'the committed manifest is never touched (whatever it holds)')
  resetFiles()
})

// ---- report ----
let INDEX = null
await group('report: buildReport renders every section from synthetic inputs; the expected block parses', async () => {
  resetFiles()
  INDEX = JSON.parse(JSON.stringify(await build({ outDir: join(TMP, 'site'), log: noop })))
  const fixtureRise = loadRise(join(FIX, 'rise.json'))
  const rise = structuredClone(fixtureRise)
  Object.assign(rise, { riseYear: 2027, riseDate: '2027-04-01', before: 'March 2027', after: 'April 2027', history: [...rise.history, 'April 2027'], announcedAverage: null })
  rise.links.circular = null
  const man = freshManifest()
  man.resources['March 2027'] = { id: 'id-march-2027', url: res('March 2027').url, size: 1, ckanHash: '', last_modified: '2027-03-02T00:00:00.000000' }
  man.resources['April 2027'] = ENTRY('April 2027', '06-Apr-2027')
  const candidate = { generated: '2027-04-07T00:00:00.000Z', mode: 'candidate', stamps: { before: '01-Mar-2027', after: '06-Apr-2027' }, hospital: { open: 32, priced: 31, median: 4.5, bands: [2, 15, 7, 3, 1, 3] }, schemaVersions: { '3.1': 66 }, schemaDrift: 0 }
  const template = readFileSync(report.TEMPLATE_FILE, 'utf8')
  const md = report.buildReport({ year: 2027, rise, manifest: man, candidate, index: INDEX, template })

  for (const h of ['# Rise 2027: PHIO snapshot report', '## Snapshots', '## Candidate `expected` block for 2027', '## 2026 (pinned) vs 2027 (this build)',
    '## Hospital median by tier (this build)', '## Restricted funds', '## Funds', '### Ten funds with the highest median listed-premium change (hospital, 2027)', '## SchemaVersion', '## Maintainer checklist']) {
    assert.ok(('\n' + md).includes(`\n${h}\n`), `heading ${h}`)
  }
  const block = /```json\n([\s\S]*?)\n```/.exec(md)
  assert.ok(block, 'json block present')
  const j = JSON.parse(block[1])
  const e = fixtureRise.expected['2026']
  assert.deepEqual(j['2027'].hospital, e.hospital, 'candidate + build stats = the fixture’s pinned numbers')
  assert.deepEqual(j['2027'].combined, e.combined); assert.equal(j['2027'].products, 43); assert.equal(j['2027'].excludedMin, 4, '6 excluded × 0.7 rounded down')
  assert.doesNotThrow(() => validateRise(Object.assign(structuredClone(rise), { expected: j })), 'the block is a valid expected entry')
  assert.ok(md.includes('| hospital priced (both months) | 31 | 31 | 0 |'), 'comparison row')
  assert.ok(md.includes('| hospital median | 4.50% | 4.50% | 0.00 pts |'), 'zero delta has no sign')
  assert.ok(md.includes('| top band concentration | `EEE` 2 of 3 | `EEE` 2 of 3 | — |'))
  assert.ok(md.includes('| `March 2027` | before (baseline) | stub — not fetched yet | `2027-03-02T00:00:00.000000` | 1 | — |'), 'stub row')
  assert.ok(md.includes('| `April 2027` | after (this rise) | `06-Apr-2027` |') && md.includes('| `April 2025` | history point | `02-Apr-2025` |') && md.includes('| `March 2026` | recorded, not used by rise.json yet |'))
  assert.ok(md.includes('- `Hospital Open 06-Apr-2027.xml` (10 bytes) `' + 'b'.repeat(64) + '`'), 'member hashes')
  assert.ok(md.includes('| announcedAverage | null — fill from the PHI circular |') && md.includes('| links.circular | null — fill from the PHI circular |'))
  assert.ok(md.includes('| expected[2027] in rise.json | absent — candidate mode'))
  assert.ok(md.includes('Licence: `cc-by` — verified by fetch'))
  assert.ok(md.includes('Rows by SchemaVersion (both hospital files): `3.1` × 66. Drift from 3.1: 0 rows.'))
  assert.ok(md.includes('14 funds in the Funds file'), 'fund count')
  const top = md.split('### Ten funds')[1].split('\n').filter(l => /^\| `[A-Z]{3}` \|/.test(l))
  assert.ok(top.length >= 3 && top.length <= 10, `top table rows ${top.length}`); assert.ok(top[0].includes('`EEE`'), 'EEE has the two ≥20% rises')
  assert.ok(md.includes('`Coastal Care <Mutual>`') && !md.replace(/`[^`\n]*`/g, '').includes('<Mutual>'), 'fund names are code spans: literal, never HTML or markdown')
  assert.ok(md.includes('- `ACA` `Restricted Fund ACA`'), 'restricted codes with names')
  assert.ok(md.includes('index.json `meta.restrictedFunds` is the same set.'))
  assert.ok(md.includes('- [ ]') && md.includes('reports/rise-2027.md') && !md.includes('YYYY'), 'checklist embedded with the year filled in')
  assert.ok(!md.includes('<!--'), 'template comment stripped')
  assert.doesNotMatch(md, /\b(cheaper|cheapest|better|best|worst|switch to|you should|we recommend)\b/i, 'no ranking or advice words')
  assert.ok(!/undefined|NaN|\[object Object\]/.test(md))
  // 중앙값 helper 와 excluded helper 가 index 와 맞는다
  const fm = report.fundMedians(INDEX)
  assert.ok(fm.every((x, i) => i === 0 || fm[i - 1].median >= x.median)); assert.equal(fm.find(x => x.fund === 'AAA').n, INDEX.products.filter(p => p[0] === 'AAA' && p[8] === 0 && p[10] != null).length)
  assert.equal(report.excludedCount(INDEX, INDEX.meta.restrictedFunds), 6)
  assert.deepEqual([0, 6, 14, 150, 14009].map(report.suggestMin), [0, 4, 9, 100, 9000])
})

await group('report: missing inputs are stated, pinned years are compared, check/build disagreement is flagged', async () => {
  const fixtureRise = loadRise(join(FIX, 'rise.json'))
  let md = report.buildReport({ year: 2027, rise: Object.assign(structuredClone(fixtureRise), { riseYear: 2027, riseDate: '2027-04-01', after: 'April 2027', history: ['April 2025', 'April 2026', 'April 2027'], before: 'March 2027' }), manifest: freshManifest(), candidate: null, index: null, template: null })
  assert.ok(md.includes('| index.json | missing — run `CANDIDATE=1 npm run build` |') && md.includes('| candidate json | missing —'))
  assert.ok(md.includes('No block: neither candidate json nor index.json was available.'))
  assert.ok(md.includes('2027 figures are missing (see above), so there is nothing to compare against 2026.'))
  assert.ok(md.includes('| `March 2027` | before (baseline) | — | — | — | not in snapshots.json'))
  assert.ok(md.includes('index.json missing — no fund table.') && md.includes('Not available — `npm run check -- --candidate` records it'))
  assert.ok(md.includes('`.github/PULL_REQUEST_TEMPLATE/update.md` not found'))
  // 전년 블록이 없으면 그렇다고 말한다; 이미 pin 된 해는 빌드 결과와 대조한다
  md = report.buildReport({ year: 2026, rise: fixtureRise, manifest: freshManifest(), candidate: null, index: INDEX, template: '' })
  assert.ok(md.includes('No `expected` block for 2025 in `rise.json` — no comparison.'))
  assert.ok(md.includes('`rise.json` already pins 2026.') && md.includes('Matches the pinned block (excludedMin not compared).'))
  assert.ok(md.includes('Note: candidate json missing: open/priced/median/bands come from index.json stats'))
  const bumped = structuredClone(INDEX); bumped.stats.hospital.zero = 99
  md = report.buildReport({ year: 2026, rise: fixtureRise, manifest: freshManifest(), candidate: null, index: bumped, template: '' })
  assert.ok(md.includes('Differences from the pinned block: hospital.zero: pinned 3, built 99'))
  md = report.buildReport({ year: 2026, rise: fixtureRise, manifest: freshManifest(), candidate: { hospital: { open: 33, priced: 31, median: 4.5, bands: [2, 15, 7, 3, 1, 3] } }, index: INDEX, template: '' })
  assert.ok(md.includes('Note: check and build disagree on hospital.open: 33 vs 32'))
  const r = /```json\n([\s\S]*?)\n```/.exec(md); assert.equal(JSON.parse(r[1])['2026'].hospital.open, 33, 'check’s figure wins in the block, the note says so')
  // index 만 있고 candidate 가 없을 때도 블록은 완전하다
  md = report.buildReport({ year: 2026, rise: fixtureRise, manifest: freshManifest(), candidate: null, index: INDEX, template: '' })
  assert.deepEqual(JSON.parse(/```json\n([\s\S]*?)\n```/.exec(md)[1])['2026'].hospital, fixtureRise.expected['2026'].hospital)
  // candidate 만 있고 index 가 없으면 나머지는 null 이고 그렇다고 적는다
  md = report.buildReport({ year: 2026, rise: fixtureRise, manifest: freshManifest(), candidate: { hospital: { open: 1, priced: 1, median: 1, bands: [0, 1, 0, 0, 0, 0] } }, index: null, template: '' })
  const b = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(md)[1])['2026']
  assert.equal(b.hospital.split, null); assert.equal(b.products, null); assert.equal(b.excludedMin, null); assert.ok(md.includes('Note: index.json missing: split, pricedRetail'))
  // 메타에 restrictedInFile 이 있으면 (build 가 내게 되면) 그걸 쓴다
  const withFile = structuredClone(INDEX); withFile.meta.restrictedInFile = [...INDEX.meta.restrictedFunds].reverse()
  assert.ok(report.buildReport({ year: 2026, rise: fixtureRise, manifest: freshManifest(), index: withFile, template: '' }).includes('Funds file `<FundType>Restricted</FundType>`: same 9 codes.'))
  withFile.meta.restrictedInFile = ['ZZZ']
  assert.ok(report.buildReport({ year: 2026, rise: fixtureRise, manifest: freshManifest(), index: withFile, template: '' }).includes('differs: `ZZZ` — a strict build fails'))
  // md(): 코드 스팬. 파이프만 \| 로, 백틱은 ’ 로, 줄바꿈은 공백으로; 꺾쇠·역슬래시는 코드 스팬 안에서 글자 그대로라 손대지 않는다.
  assert.equal(report.md('a|b<c>`d\\e\nf'), '`a\\|b<c>’d\\e f`')
  assert.equal(report.md(''), '—'); assert.equal(report.md(null), '—')
  // 마크다운 링크·이미지·강조·@멘션·"fixes #N" 이 든 데이터 값(CKAN 문자열, 기금명)은 코드 스팬 밖으로 나오지 않는다 —
  // GitHub 는 코드 스팬 안에서 링크를 만들지도, 멘션 알림을 보내지도, 이슈를 닫지도 않는다. 역슬래시 이스케이프는 뒤의 둘을 못 막는다.
  const hostileName = 'Fund ![pixel](https://evil.example/f.png) @octocat fixes #2 [site](https://evil.example) **bold**'
  const hostileLm = '2026-04-20 **bold** ![i](https://evil.example/q.png) @octocat closes #3 <script>x</script>'
  const hostile = structuredClone(INDEX); hostile.funds.AAA = hostileName
  const hostileMan = freshManifest(); hostileMan.resources['April 2026'].last_modified = hostileLm; hostileMan.resources['April 2026'].url = 'https://evil.example/[x](y) @octocat'
  md = report.buildReport({ year: 2026, rise: fixtureRise, manifest: hostileMan, candidate: { mode: 'candidate **x** @octocat', stamps: { before: '![a](b)', after: '05-Apr-2026' }, hospital: { open: 32, priced: 31, median: 4.5, bands: [2, 15, 7, 3, 1, 3] } }, index: hostile, template: '' })
  assert.ok(md.includes('`' + hostileName + '`') && md.includes('`' + hostileLm + '`'), 'hostile values kept whole inside code spans')
  const outside = md.replace(/`[^`\n]*`/g, '')
  assert.ok(!/@octocat|#[23]\b|!\[|\]\(|\*\*bold\*\*|<script>|evil\.example/.test(outside), `hostile text outside a code span: ${outside.match(/.{0,40}(@octocat|#[23]\b|!\[|\]\(|\*\*bold\*\*|<script>|evil\.example).{0,40}/)?.[0]}`)
})

await group('report: CLI end to end on a fixture build (check --candidate → build → report), child processes', () => {
  resetFiles()
  const cwd = join(TMP, 'cli'); mkdirSync(cwd, { recursive: true })
  const noExp = JSON.parse(readFileSync(join(FIX, 'rise.json'), 'utf8')); noExp.expected = {}
  const noExpFile = join(TMP, 'rise-noexp.json'); writeFileSync(noExpFile, JSON.stringify(noExp))
  let r = runCli('check.mjs', { cwd, env: { RISE_FILE: noExpFile }, args: ['--candidate'] })
  assert.equal(r.code, 0, r.stderr); assert.ok(existsSync(join(REPORTS, 'candidate-2026.json')))
  r = runCli('build.mjs', { cwd, env: { RISE_FILE: noExpFile, CANDIDATE: '1' } })
  assert.equal(r.code, 0, r.stderr); assert.ok(existsSync(join(cwd, 'site', 'index.json')))
  r = runCli('report.mjs', { cwd, env: { RISE_FILE: noExpFile } })
  assert.equal(r.code, 0, r.stderr); assert.equal(r.stdout.trim(), join(REPORTS, 'rise-2026.md')); assert.equal(r.stderr, '', 'every input present → nothing on stderr')
  const md = readFileSync(join(REPORTS, 'rise-2026.md'), 'utf8')
  assert.ok(md.startsWith('# Rise 2026: PHIO snapshot report\n'))
  const j = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(md)[1])
  assert.deepEqual(j['2026'].hospital, loadRise(join(FIX, 'rise.json')).expected['2026'].hospital); assert.equal(j['2026'].products, 43)
  assert.ok(md.includes('| candidate json | mode `candidate`, stamps `01-Mar-2026` / `05-Apr-2026` |'))
  assert.ok(md.includes('Rows by SchemaVersion (both hospital files): `3.1` × 66. Drift from 3.1: 0 rows.'))
  assert.ok(md.includes('- [ ]') && md.includes('reports/rise-2026.md'), 'checklist from .github/PULL_REQUEST_TEMPLATE/update.md')
  assert.ok(/\| index\.json \| version `[0-9a-f]{12}`, schema `2`, snapshots `2026-03-01` → `2026-04-05` \|/.test(md), 'meta line')
  // 같은 입력이면 같은 보고서·같은 candidate json (시각 없음) — update.yml 의 "변경 없음 → 커밋 없음" 판정이 이것에 기댄다
  const cand1 = readFileSync(join(REPORTS, 'candidate-2026.json'), 'utf8')
  assert.ok(!/generated|built/.test(md.split('\n## Snapshots')[0]) && !/"generated"/.test(cand1), 'no timestamps in the committed files')
  r = runCli('check.mjs', { cwd, env: { RISE_FILE: noExpFile }, args: ['--candidate'] }); assert.equal(r.code, 0, r.stderr)
  r = runCli('build.mjs', { cwd, env: { RISE_FILE: noExpFile, CANDIDATE: '1' } }); assert.equal(r.code, 0, r.stderr)
  r = runCli('report.mjs', { cwd, env: { RISE_FILE: noExpFile } }); assert.equal(r.code, 0, r.stderr)
  assert.equal(readFileSync(join(REPORTS, 'candidate-2026.json'), 'utf8'), cand1, 'candidate json byte-identical on a second run')
  assert.equal(readFileSync(join(REPORTS, 'rise-2026.md'), 'utf8'), md, 'report byte-identical on a second run')
  // --out 과 --year: 없는 해의 candidate 는 stderr 로 말하고 그래도 쓴다
  const out = join(TMP, 'custom', 'r.md')
  r = runCli('report.mjs', { cwd, env: { RISE_FILE: noExpFile }, args: ['--year', '2027', '--out', out] })
  assert.equal(r.code, 0, r.stderr); assert.equal(r.stdout.trim(), out); assert.match(r.stderr, /candidate-2027\.json not found/)
  assert.ok(readFileSync(out, 'utf8').includes('Note: `rise.json` is at riseYear 2026; this report was asked for 2027.'))
  r = runCli('report.mjs', { cwd: TMP, env: { RISE_FILE: noExpFile }, args: ['--site', join(TMP, 'nowhere')] })
  assert.equal(r.code, 0, r.stderr); assert.match(r.stderr, /index\.json not found/)
  assert.equal(runCli('report.mjs', { cwd, args: ['--help'] }).code, 0)
  r = runCli('report.mjs', { cwd, args: ['--year', 'abc'] }); assert.equal(r.code, 1); assert.match(r.stderr, /--year must be an integer/)
  r = runCli('report.mjs', { cwd, args: ['--what'] }); assert.equal(r.code, 1); assert.match(r.stderr, /unknown argument/)
  assert.equal(treeStamp(REPO_REPORTS), repoReportsBefore, 'fixture runs must not write into the repo (reports/ unchanged, whether or not it exists)')
  assert.ok(statSync(join(REPORTS, 'rise-2026.md')).size > 2000)
})

// TMP 는 process.on('exit') 가 지운다 (위).
if (failed) { console.log(`\n${failed} group(s) failed`); process.exit(1) }
console.log('\nOK — discover/report tests passed (no network)')
