// npm run test:unit — 네트워크 없이, test/fixtures 로 파이프라인 전체를 검사한다.
// 환경변수를 config.mjs 를 import 하기 전에 세워야 하므로 아래는 전부 동적 import 다.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, readdirSync, rmSync, statSync, cpSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FIX = join(ROOT, 'test', 'fixtures')
const TMP = mkdtempSync(join(tmpdir(), 'april-unit-'))
const ENV = {
  RISE_FILE: join(FIX, 'rise.json'),
  DATA_DIR: join(FIX, 'data'),
  MANIFEST_FILE: join(TMP, 'snapshots.json'),
  REPORTS_DIR: join(TMP, 'reports-cli'),
  LIMIT_TAIL_BYTES: '4096',
}
Object.assign(process.env, ENV)
delete process.env.CANDIDATE
process.argv = process.argv.filter(a => a !== '--candidate')

const config = await import('./config.mjs')
const { RISE, LIMITS, PKG, validateRise, loadRise, loadManifest, saveManifest, findMember, xmlPath, csvPath, stampOf, stampToIso, slug, wantedSnapshots, years, expectedFor } = config
const columns = await import('./columns.mjs')
const { parseFile, dec } = await import('./parse.mjs')
const { load, key, pct, median } = await import('./join.mjs')
const { build, restrictedInFunds } = await import('./build.mjs')
const { checkIndex } = await import('./test.mjs')
const { check } = await import('./check.mjs')
const ckan = await import('./ckan.mjs')
const { extractSnapshot, verifySnapshot, fetchAll, hashFile } = await import('./fetch.mjs')

const noop = () => {}
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const md5 = (buf) => createHash('md5').update(buf).digest('hex')
const APR = join(FIX, 'data', 'april-2026')
const ZIP = readFileSync(join(FIX, 'snapshot.zip'))
const EXPECTED = expectedFor(2026)

let failed = 0
async function group(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`) }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${(e.stack || e.message).split('\n').slice(0, 6).join('\n       ')}`) }
}
// 자식 프로세스로 strict/candidate 분기처럼 모듈 싱글턴에 묶인 동작을 검사한다
function run(script, { env = {}, cwd = TMP, args = [] } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [join(ROOT, 'src', script), ...args], { cwd, env: { ...process.env, ...ENV, ...env }, stdio: 'pipe', encoding: 'utf8' })
    return { code: 0, stdout, stderr: '' }
  } catch (e) { return { code: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' } }
}
const riseCopy = (mut, name) => {
  const r = JSON.parse(readFileSync(join(FIX, 'rise.json'), 'utf8')); mut(r)
  const f = join(TMP, name); writeFileSync(f, JSON.stringify(r)); return f
}

await group('config: fixture rise.json loaded and helpers', () => {
  assert.equal(RISE.riseYear, 2026)
  assert.deepEqual(RISE.history, ['April 2025', 'April 2026'])
  assert.deepEqual(wantedSnapshots(), ['April 2025', 'April 2026', 'March 2026'])
  assert.deepEqual(years(), [2025, 2026])
  assert.equal(slug('April 2026'), 'april-2026')
  assert.equal(stampToIso('05-Apr-2026'), '2026-04-05')
  assert.throws(() => stampToIso('2026-04-05'), /bad stamp/)
  assert.equal(stampOf('April 2026'), '05-Apr-2026')
  assert.equal(stampOf('March 2026'), '01-Mar-2026')
  assert.ok(xmlPath('April 2026', 'Hospital').endsWith('Hospital Open 05-Apr-2026.xml'))
  assert.ok(xmlPath('April 2025', 'Funds').endsWith('Funds 02-Apr-2025.xml'))
  assert.ok(csvPath('April 2026').endsWith('Product Changes 05-Apr-2026.csv'))
  assert.throws(() => csvPath('March 2026'), /Product Changes/)
  assert.ok(EXPECTED && EXPECTED.hospital.bands.length === 6)
  assert.equal(expectedFor(1999), null)
  assert.equal(LIMITS.tailBytes, 4096, 'LIMIT_TAIL_BYTES override')
  assert.equal(LIMITS.zipBytes, 512 * 1024 * 1024)
  assert.equal(PKG, '8ab10b1f-6eac-423c-abc5-bbffc31b216c')
})

await group('config: validation rejects a bad rise.json with a clear message', () => {
  const base = () => JSON.parse(readFileSync(join(FIX, 'rise.json'), 'utf8'))
  const bad = (mut, re) => { const r = base(); mut(r); assert.throws(() => validateRise(r, 'x.json'), re) }
  assert.doesNotThrow(() => validateRise(base()))
  bad(r => { r.after = 'April 2027' }, /x\.json: after must be "April 2026"/)
  bad(r => { r.history = ['April 2026', 'April 2025'] }, /history must end with after/)
  bad(r => { r.history = [] }, /history must be a non-empty/)
  bad(r => { r.before = 'Feb 2026' }, /before must look like/)
  bad(r => { r.riseDate = '2025-04-01' }, /not in riseYear/)
  bad(r => { r.restrictedFunds = ['ab1'] }, /three-letter fund code/)
  bad(r => { r.downloadHosts = [] }, /downloadHosts/)
  bad(r => { r.downloadHosts = ['not a host'] }, /not a hostname/)
  bad(r => { r.announcedAverage = '4.41' }, /announcedAverage/)
  bad(r => { r.links.circular = 'http://insecure.example/' }, /links\.circular must be an https URL/)
  bad(r => { r.expected['2026'].hospital.bands = [1, 2, 3] }, /bands must be six/)
  bad(r => { r.expected['2026'].hospital.topBand = { fund: 1 } }, /topBand/)
  bad(r => { delete r.expected['2026'].combined }, /combined\.priced/)
  bad(r => { r.expected.abc = r.expected['2026'] }, /must be a year/)
  assert.doesNotThrow(() => validateRise(Object.assign(base(), { announcedAverage: null, links: { circular: null, perInsurer: null }, expected: {} })))
  const f = riseCopy(r => { r.after = 'April 2027' }, 'bad-after.json')
  assert.throws(() => loadRise(f), new RegExp(`${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: after must be`))
  writeFileSync(join(TMP, 'bad.json'), '{ not json')
  assert.throws(() => loadRise(join(TMP, 'bad.json')), /invalid JSON/)
  assert.throws(() => loadRise(join(TMP, 'absent.json')), /cannot read/)
})

await group('config: xmlPath errors and manifest helpers', () => {
  assert.throws(() => findMember(join(TMP, 'nope'), 'Hospital'), /missing snapshot directory .*nope/)
  const two = join(TMP, 'two'); mkdirSync(two)
  writeFileSync(join(two, 'Hospital Open 01-Apr-2026.xml'), '')
  writeFileSync(join(two, 'Hospital Open 05-Apr-2026.xml'), '')
  assert.throws(() => findMember(two, 'Hospital'), /exactly one "Hospital Open DD-Mon-YYYY\.xml" in .*two, found 2/)
  assert.throws(() => findMember(two, 'Combined'), /found 0/)
  assert.throws(() => findMember(two, 'Nope'), /unknown member kind/)
  const f = join(TMP, 'm.json')
  saveManifest({ resources: { b: { z: 1, a: 2 } }, package: PKG }, f)
  const txt = readFileSync(f, 'utf8')
  assert.ok(txt.endsWith('}\n'))
  assert.ok(txt.indexOf('"package"') < txt.indexOf('"resources"') && txt.indexOf('"a": 2') < txt.indexOf('"z": 1'), 'sorted keys')
  assert.deepEqual(loadManifest(f), { package: PKG, resources: { b: { a: 2, z: 1 } } })
  assert.deepEqual(loadManifest(join(TMP, 'absent-manifest.json')), { package: PKG, resources: {} })
  writeFileSync(f, JSON.stringify({ package: 'nope', resources: {} }))
  assert.throws(() => loadManifest(f), /package must be a CKAN package UUID/)
})

await group('columns: F in site/app.js equals columns.mjs', () => {
  const src = readFileSync(join(ROOT, 'site', 'app.js'), 'utf8')
  const m = /\bconst F = (\{[^{}]*\})/.exec(src)
  assert.ok(m, 'F literal found in app.js')
  const appF = JSON.parse(JSON.stringify(vm.runInNewContext(`(${m[1]})`)))  // 다른 realm 의 프로토타입을 벗긴다
  assert.deepEqual(appF, columns.F)
  assert.equal(columns.WIDTH, 25)
  assert.deepEqual([...new Set(Object.values(columns.F))].sort((a, b) => a - b), [...Array(25).keys()])
})

let aprRows = []
await group('parse: fixture Hospital file', async () => {
  const { count, declared } = await parseFile(join(APR, 'Hospital Open 05-Apr-2026.xml'), r => aprRows.push(r))
  assert.equal(count, 33); assert.equal(declared, 33)
  const by = (code, who = '1|1|') => aprRows.find(r => r.code === code && r.who === who)
  assert.equal(by('BBB-010').name, 'Beta & Gamma Gold')
  assert.equal(by('BBB-011', '2|0|Child,Student').name, 'Beta Silver Plus ’26')
  assert.equal(by('BBB-012').name, 'Beta Bronze – Saver')
  assert.equal(by('BBB-013').name, 'Beta Basic &#99999999999; Edition', 'bad numeric reference kept verbatim')
  const weird = by('CCC-020')
  assert.ok(weird.cover.includes('Heart and vascular?'), 'unknown Cover value → ?')
  assert.ok(!weird.cover.includes('function'), 'no prototype leak in cover vector')
  const w = by('CCC-021').waits
  assert.equal(Object.getPrototypeOf(w), null)
  assert.ok(Object.hasOwn(w, '__proto__')); assert.equal(w['__proto__'], '12M'); assert.equal(w.Accident, '1D')
  assert.equal(by('CCC-022').status, 'Closed')
  const corp = by('DDD-030')
  assert.equal(corp.corporate, true); assert.equal(corp.corporateText, 'Available to employees of Delta Pty Ltd & their families.')
  const oaw = by('DDD-031', '2|0|')
  assert.equal(oaw.restricted, true); assert.equal(oaw.restrictedKind, 'GeneralHealthCover')
  assert.equal(by('AAA-001').restricted, false)
  assert.ok(by('AAA-001') && by('AAA-001', '2|0|') && by('AAA-001', '2|0|Child,Student'), 'who signatures')
  assert.ok(by('BBB-015', '1|0|Child'), 'single parent signature')
  const a = by('AAA-001')
  assert.equal(a.premium, 208.3); assert.equal(a.exPerson, 500); assert.equal(a.exAdmission, 0); assert.equal(a.exType, 'PerPerson')
  assert.deepEqual(a.waivers, ['Accident']); assert.deepEqual(by('AAA-006', '2|0|').waivers, [])
  assert.equal(a.copay, 'None'); assert.equal(a.accom, 'Private'); assert.equal(a.knownGap, true); assert.equal(a.ambulance, 'Full')
  assert.equal(a.tier, 'Gold'); assert.equal(a.schema, '3.1'); assert.equal(a.accident, true); assert.equal(a.fund, 'AAA'); assert.equal(a.state, 'NSW')
  assert.equal(a.url, 'https://example.com/aaa-001'); assert.equal(a.pid, 'c2026040-0000-4000-8000-000000000000'); assert.equal(a.iid, 'ffffffff-0000-4000-8000-000000000000')
  assert.equal(by('CCC-023').url, 'javascript:alert(1)', 'parser keeps the raw url; build filters it')
  const comb = []
  await parseFile(join(APR, 'Combined Open 05-Apr-2026.xml'), r => comb.push(r))
  assert.equal(comb.length, 11); assert.equal(comb[0].premiumHospital, 182)
  assert.equal(aprRows[0].premiumHospital, aprRows[0].premium, 'hospital file falls back to PremiumNoRebate')
})

await group('parse: dec(), truncated file, callback errors', async () => {
  assert.equal(dec('&#99999999999;'), '&#99999999999;')
  assert.equal(dec('&#x110000;'), '&#x110000;')
  assert.equal(dec('&amp;&lt;&gt;&quot;&apos;'), '&<>"\'')
  assert.equal(dec('&constructor;&__proto__;&nbsp;'), '&constructor;&__proto__;&nbsp;')
  assert.equal(dec('&#65;&#x42;'), 'AB')
  assert.equal(dec(null), null); assert.equal(dec('plain'), 'plain')
  assert.ok(statSync(join(FIX, 'truncated.xml')).size > 4096)
  await assert.rejects(parseFile(join(FIX, 'truncated.xml'), noop), /without <\/Product>.*limit 4096/)
  // 꼬리 상한 아래에서 끊긴 파일: EOF 에서 거부한다
  const apr = readFileSync(join(APR, 'Hospital Open 05-Apr-2026.xml'), 'utf8').split('\n')
  writeFileSync(join(TMP, 'cut.xml'), apr.slice(0, 3).join('\n') + '\n' + apr[3].slice(0, 400))
  await assert.rejects(parseFile(join(TMP, 'cut.xml'), noop), /ends inside a <Product> — truncated \(1 products read, header declared 33\)/)
  assert.deepEqual(await parseFile(join(APR, 'Funds 05-Apr-2026.xml'), noop), { count: 0, declared: null }, 'a non-product file reads as empty')
  await assert.rejects(parseFile(join(APR, 'Hospital Open 05-Apr-2026.xml'), () => { throw new Error('boom') }), /boom/)
  await assert.rejects(parseFile(join(TMP, 'absent.xml'), noop), /ENOENT/)
})

await group('join: key, pct, median, load', async () => {
  assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 2.5)
  assert.ok(Math.abs(pct(200, 208.3) - 4.15) < 1e-9)
  assert.equal(key({ code: 'A', state: 'NSW', who: '1|1|', exPerson: 500, exAdmission: 0 }), 'A|NSW|1|1||500|0')
  const m = await load(join(APR, 'Hospital Open 05-Apr-2026.xml'))
  assert.equal(m.size, 32, 'Open rows only')
  assert.equal(m.size, EXPECTED.hospital.open)
})

let D = null
await group('build: fixture stats equal the pinned expected block', async () => {
  const outDir = join(TMP, 'site')
  const out = await build({ outDir, log: noop })
  D = JSON.parse(readFileSync(join(outDir, 'index.json'), 'utf8'))
  const h = D.stats.hospital
  for (const k of ['open', 'priced', 'median', 'split', 'pricedRetail', 'medianRetail', 'zero']) assert.equal(h[k], EXPECTED.hospital[k], `hospital.${k}`)
  assert.deepEqual(h.bands, EXPECTED.hospital.bands); assert.deepEqual(h.topBand, EXPECTED.hospital.topBand)
  assert.equal(D.stats.combined.priced, EXPECTED.combined.priced)
  assert.equal(D.products.length, EXPECTED.products)
  assert.deepEqual(D.meta.years, [2025, 2026])
  assert.deepEqual(D.meta.snapshots, { before: '2026-03-01', after: '2026-04-05', beforeName: 'March 2026', afterName: 'April 2026' })
  assert.equal(D.meta.riseYear, 2026); assert.equal(D.meta.riseDate, '2026-04-01'); assert.equal(D.meta.rateRise, '2026-04-01')
  assert.equal(D.meta.announcedAverage, 4.41)
  assert.deepEqual(D.meta.links, RISE.links); assert.deepEqual(D.meta.restrictedFunds, RISE.restrictedFunds)
  assert.equal(Object.getPrototypeOf(out.funds), null)
  assert.equal(D.funds.BBB, 'Beta & Gamma Health'); assert.equal(D.funds.CCC, 'Coastal Care <Mutual>')
  assert.equal(Object.keys(D.funds).length, 14)
  const F = columns.F
  const row = (code, who) => D.products.find(p => D.s.names[p[F.name]].startsWith(code) ? false : (p[F.fund] === code.slice(0, 3) && D.s.names[p[F.name]] === who))
  const named = (name, whoSig = '1|1|', type = 0) => D.products.find(p => D.s.names[p[F.name]] === name && D.s.whos[p[F.who]] === whoSig && p[F.type] === type)
  assert.equal(named('Coastal Basic')[F.url], -1, 'javascript: url dropped')
  assert.equal(named('Coastal Gold Family', '2|0|Child,Student')[F.url], -1, 'non-url dropped')
  assert.match(D.s.urls[named('Alpha Gold Plus')[F.url]], /^https:\/\//)
  const sib = named('Beta Sibling Silver')
  assert.ok(sib[F.sibWho] >= 0); assert.equal(D.s.whos[sib[F.sibWho]], '1|0|Child'); assert.equal(sib[F.sibPrem], 155)
  assert.equal(named('Beta Sibling Silver', '1|0|Child')[F.sibWho], -1)
  const csib = named('Coastal Combined Sibling', '1|1|', 1)
  assert.ok(csib[F.sibWho] >= 0); assert.equal(csib[F.sibPrem], 185)
  const fresh = named('Beta New Gold')
  assert.equal(fresh[F.pct], null); assert.equal(fresh[F.before], null); assert.deepEqual(fresh[F.hist], [null, 230])
  assert.deepEqual(named('Alpha Gold Plus')[F.hist], [190, 208.3])
  assert.deepEqual(named('Alpha Silver')[F.hist], [null, 156])
  assert.equal(named('Alpha Gold Plus')[F.pct], 4.15); assert.equal(named('Alpha Gold Plus')[F.before], 200)
  assert.equal(named('Alpha Bronze')[F.pct], 0); assert.equal(named('Alpha Basic')[F.pct], -2.5)
  const corp = named('Delta Corporate Gold')
  assert.equal(corp[F.corp], 1); assert.equal(D.s.corpText[corp[F.corpTxt]], 'Available to employees of Delta Pty Ltd & their families.')
  assert.equal(named('Delta Staff Silver', '2|0|')[F.restr], 1)
  assert.ok(D.s.waits.some(w => JSON.parse(w).__proto__ === '12M'), 'waits table keeps __proto__ title')
  assert.ok(D.s.covers.some(c => c.includes('?')))
  assert.ok(D.s.names.includes('Beta Basic &#99999999999; Edition'))
  assert.ok(!D.products.some(p => D.s.names[p[F.name]] === 'Coastal Closed Gold'), 'closed product excluded')
  assert.ok(!D.products.some(p => D.s.names[p[F.name]] === 'Alpha Retired Gold'), 'march-only product excluded')
  void row
})

await group('build: restrictedInFunds() and strict-mode gates (child processes)', () => {
  assert.equal(restrictedInFunds('<Funds><Fund><FundCode>AAA</FundCode><FundName>x</FundName></Fund></Funds>'), null)
  assert.deepEqual([...restrictedInFunds('<Fund><FundCode>AAA</FundCode><FundName>a</FundName><FundType>Open</FundType></Fund><Fund><FundCode>ACA</FundCode><FundName>b</FundName><FundType>Restricted</FundType></Fund>')], ['ACA'])
  assert.deepEqual([...restrictedInFunds('<FundCode>AAA</FundCode><FundName>a</FundName><FundType>Open</FundType><FundCode>NHB</FundCode><FundName>b</FundName><FundType>Restricted</FundType>')], ['NHB'])
  assert.deepEqual([...restrictedInFunds(readFileSync(join(APR, 'Funds 05-Apr-2026.xml'), 'utf8'))].sort(), [...RISE.restrictedFunds].sort())
  const cwd = join(TMP, 'cli-bad'); mkdirSync(cwd)   // 이 빌드들의 site/index.json 은 여기만 더럽힌다
  const nullAvg = riseCopy(r => { r.announcedAverage = null }, 'rise-null-avg.json')
  let r = run('build.mjs', { cwd, env: { RISE_FILE: nullAvg } })
  assert.equal(r.code, 1); assert.match(r.stderr, /announcedAverage is null/)
  assert.ok(!existsSync(join(cwd, 'site', 'index.json')))
  r = run('build.mjs', { cwd, env: { RISE_FILE: nullAvg, CANDIDATE: '1' } })
  assert.equal(r.code, 0, r.stderr); assert.ok(existsSync(join(cwd, 'site', 'index.json')))
  const fewer = riseCopy(r => { r.restrictedFunds = r.restrictedFunds.slice(1) }, 'rise-fewer.json')
  r = run('build.mjs', { cwd, env: { RISE_FILE: fewer } })
  assert.equal(r.code, 1); assert.match(r.stderr, /restricted funds differ/)
  r = run('build.mjs', { cwd, env: { RISE_FILE: fewer }, args: ['--candidate'] })
  assert.equal(r.code, 0, r.stderr); assert.match(r.stdout, /warning: restricted funds differ/)
  r = run('build.mjs', { cwd, env: { DATA_DIR: join(TMP, 'no-data') } })
  assert.equal(r.code, 1); assert.match(r.stderr, /^missing snapshot directory/)
})

await group('test.mjs: checkIndex structural + count assertions', () => {
  const r = checkIndex(D, { expected: EXPECTED, log: noop })
  assert.equal(r.skipped, 0); assert.equal(r.checked, 41); assert.equal(r.excluded, 6)
  assert.ok(checkIndex(D, { expected: null, log: noop }).skipped >= 12)
  const clone = () => JSON.parse(JSON.stringify(D))
  let X = clone(); X.products[0] = X.products[0].slice(0, -1)
  assert.throws(() => checkIndex(X, { expected: EXPECTED, log: noop }), /row width/)
  X = clone(); X.stats.hospital.priced++
  assert.throws(() => checkIndex(X, { expected: EXPECTED, log: noop }), /hospital priced/)
  X = clone(); X.stats.hospital.priced++
  assert.throws(() => checkIndex(X, { expected: null, log: noop }), /priced rows vs stats/, 'structural check catches it without expected')
  X = clone(); const p = X.products.find(q => q[columns.F.pct] != null); p[columns.F.pct] += 0.1
  assert.throws(() => checkIndex(X, { expected: EXPECTED, log: noop }), /pct mismatch/)
  X = clone(); X.stats.hospital.pricedRetail--
  assert.throws(() => checkIndex(X, { expected: null, log: noop }), /pricedRetail vs rows/)
  X = clone(); X.meta.restrictedFunds = []
  assert.throws(() => checkIndex(X, { expected: null, log: noop }), /meta\.restrictedFunds/)
  X = clone(); X.products[0][columns.F.hist] = [1]
  assert.throws(() => checkIndex(X, { expected: null, log: noop }), /hist length/)
  // 직접 실행: build → test 를 같은 cwd 에서 (npm run build && npm test 와 같은 모양)
  const cwd = join(TMP, 'cli'); mkdirSync(cwd)
  let r2 = run('build.mjs', { cwd })
  assert.equal(r2.code, 0, r2.stderr); assert.match(r2.stdout, /Hospital: 32 open, 31 priced both months, median 4.5%/); assert.match(r2.stdout, /index\.json .* MB gzip/)
  r2 = run('test.mjs', { cwd })
  assert.equal(r2.code, 0, r2.stderr); assert.match(r2.stdout, /OK — 43 rows, 41 price changes verified/)
  const noExp = riseCopy(r => { r.expected = {} }, 'rise-noexp-test.json')
  r2 = run('test.mjs', { cwd, env: { RISE_FILE: noExp } })
  assert.equal(r2.code, 2); assert.match(r2.stderr, /no "expected" block/)
  r2 = run('test.mjs', { cwd, env: { RISE_FILE: noExp, CANDIDATE: '1' } })
  assert.equal(r2.code, 0, r2.stderr); assert.match(r2.stdout, /count assertions skipped/)
})

await group('check.mjs: strict, candidate and unverified modes', async () => {
  const reportsDir = join(TMP, 'reports')
  const r = await check({ log: noop, reportsDir })
  assert.equal(r.mode, 'strict'); assert.equal(r.hospital.priced, EXPECTED.hospital.priced); assert.deepEqual(r.hospital.bands, EXPECTED.hospital.bands)
  assert.equal(r.schemaDrift, 0); assert.deepEqual(r.schemaVersions, { '3.1': 66 })
  assert.deepEqual(r.stamps, { before: '01-Mar-2026', after: '05-Apr-2026' })
  const c = await check({ expected: null, candidate: true, reportsDir, log: noop })
  assert.equal(c.mode, 'candidate'); assert.equal(c.file, join(reportsDir, 'candidate-2026.json'))
  const j = JSON.parse(readFileSync(c.file, 'utf8'))
  assert.deepEqual(j.expected['2026'].hospital, { open: 32, priced: 31, median: 4.5, bands: EXPECTED.hospital.bands })
  assert.equal((await check({ expected: null, candidate: false, log: noop })).mode, 'unverified')
  await assert.rejects(check({ expected: { hospital: { priced: 1, median: 9, bands: [] } }, log: noop }), /common product count/)
  // 직접 실행: expected 없음 → exit 2, --candidate → 0, SchemaVersion 드리프트 → 1
  const noExp = riseCopy(r => { r.expected = {} }, 'rise-noexp.json')
  let x = run('check.mjs', { env: { RISE_FILE: noExp } })
  assert.equal(x.code, 2); assert.match(x.stderr, /no "expected" block for 2026/)
  x = run('check.mjs', { env: { RISE_FILE: noExp }, args: ['--candidate'] })
  assert.equal(x.code, 0, x.stderr); assert.match(x.stdout, /candidate \(not verified\)/)
  assert.ok(existsSync(join(TMP, 'reports-cli', 'candidate-2026.json')), 'REPORTS_DIR honoured')
  assert.ok(!existsSync(join(ROOT, 'reports', 'candidate-2026.json')), 'fixture run must not write into the repo')
  const drift = join(TMP, 'drift')
  cpSync(join(FIX, 'data'), drift, { recursive: true })
  const f = join(drift, 'april-2026', 'Hospital Open 05-Apr-2026.xml')
  writeFileSync(f, readFileSync(f, 'utf8').replace('SchemaVersion="3.1"', 'SchemaVersion="3.0"'))
  x = run('check.mjs', { env: { DATA_DIR: drift } })
  assert.equal(x.code, 1); assert.match(x.stderr, /SchemaVersion drift: 1 rows not 3\.1/)
  x = run('check.mjs', { env: { DATA_DIR: join(TMP, 'absent') } })
  assert.equal(x.code, 1); assert.match(x.stderr, /^missing snapshot directory/)
})

await group('fetch: extractSnapshot allowlist, duplicates and limits', async () => {
  const dir = join(TMP, 'x1')
  const { members, stamp } = await extractSnapshot(join(FIX, 'snapshot.zip'), dir)
  assert.equal(stamp, '05-Apr-2026')
  const names = ['Combined Open 05-Apr-2026.xml', 'Funds 05-Apr-2026.xml', 'Hospital Open 05-Apr-2026.xml', 'Product Changes 05-Apr-2026.csv']
  assert.deepEqual(Object.keys(members).sort(), names)
  assert.deepEqual(readdirSync(dir).sort(), names, 'evil.sh not extracted')
  for (const n of names) {
    const want = readFileSync(join(APR, n))
    assert.equal(members[n].size, want.length); assert.equal(members[n].sha256, sha256(want))
    assert.equal(sha256(readFileSync(join(dir, n))), sha256(want))
  }
  await assert.rejects(extractSnapshot(join(FIX, 'dup.zip'), join(TMP, 'x-dup')), /exactly one "Hospital Open DD-Mon-YYYY\.xml", found 2/)
  assert.ok(!existsSync(join(TMP, 'x-dup')), 'nothing extracted on refusal')
  await assert.rejects(extractSnapshot(join(FIX, 'snapshot.zip'), join(TMP, 'x2'), { limits: { ...LIMITS, memberBytes: 10 } }), /declares \d+ bytes, limit 10/)
  await assert.rejects(extractSnapshot(join(FIX, 'snapshot.zip'), join(TMP, 'x2'), { limits: { ...LIMITS, entries: 2 } }), /5 entries, limit 2/)
  await assert.rejects(extractSnapshot(join(FIX, 'snapshot.zip'), join(TMP, 'x2'), { limits: { ...LIMITS, totalBytes: 1000 } }), /in total, limit 1000/)
  assert.ok(!existsSync(join(TMP, 'x2')), 'limits refuse before extracting')
  await assert.rejects(extractSnapshot(join(TMP, 'absent.zip'), join(TMP, 'x3')), /no such file/)
  writeFileSync(join(TMP, 'junk.zip'), 'not a zip')
  await assert.rejects(extractSnapshot(join(TMP, 'junk.zip'), join(TMP, 'x3')), /unzip -Z1 failed/)
})

await group('fetch: verifySnapshot against a manifest', async () => {
  const dataDir = join(TMP, 'vdata'); const dir = join(dataDir, 'april-2026'); mkdirSync(dir, { recursive: true })
  const members = {}
  for (const n of readdirSync(APR)) { copyFileSync(join(APR, n), join(dir, n)); const b = readFileSync(join(APR, n)); members[n] = { size: b.length, sha256: sha256(b) } }
  const manifest = { package: PKG, resources: { 'April 2026': { members } } }
  assert.equal(await verifySnapshot('April 2026', { manifest, dataDir }), true)
  assert.equal(await verifySnapshot('March 2026', { manifest, dataDir }), false, 'no entry')
  assert.equal(await verifySnapshot('April 2026', { manifest: { resources: { 'April 2026': { sha256: 'x' } } }, dataDir }), false, 'no members')
  const f = join(dir, 'Funds 05-Apr-2026.xml'); const buf = readFileSync(f)
  buf[buf.length - 3] ^= 0x01; writeFileSync(f, buf)
  assert.equal(await verifySnapshot('April 2026', { manifest, dataDir }), false, 'one flipped bit')
  copyFileSync(join(APR, 'Funds 05-Apr-2026.xml'), f)
  assert.equal(await verifySnapshot('April 2026', { manifest, dataDir }), true)
  writeFileSync(join(dir, 'Hospital Open 01-Apr-2026.xml'), 'stale')
  assert.equal(await verifySnapshot('April 2026', { manifest, dataDir }), false, 'stray member-shaped file forces re-extraction')
  rmSync(join(dir, 'Hospital Open 01-Apr-2026.xml'))
  writeFileSync(join(dir, 'notes.txt'), 'ignored')
  assert.equal(await verifySnapshot('April 2026', { manifest, dataDir }), true, 'unrelated files are tolerated')
  rmSync(join(dir, 'Combined Open 05-Apr-2026.xml'))
  assert.equal(await verifySnapshot('April 2026', { manifest, dataDir }), false, 'missing member')
  const partial = { package: PKG, resources: { 'April 2026': { members: { 'Funds 05-Apr-2026.xml': members['Funds 05-Apr-2026.xml'] } } } }
  assert.equal(await verifySnapshot('April 2026', { manifest: partial, dataDir }), false, 'members must cover all three kinds')
})

await group('ckan: validatePackage, resourcesByName, allowedUrl', async () => {
  const good = () => ({ success: true, result: { id: PKG, license_id: 'cc-by', resources: [{ name: 'PrivateHealth.gov.au April 2026.zip', url: 'https://data.gov.au/a.zip' }] } })
  assert.equal(ckan.validatePackage(good()).id, PKG)
  const bad = (mut, re) => { const j = good(); mut(j); assert.throws(() => ckan.validatePackage(j), re) }
  bad(j => { j.success = false }, /success=false/)
  bad(j => { j.result.id = 'other' }, /result\.id/)
  bad(j => { j.result.license_id = 'other-open' }, /licence changed: other-open — stop and re-read the terms/)
  bad(j => { j.result.resources = {} }, /resources is not an array/)
  bad(j => { j.result.resources.push({ name: 'x' }) }, /lacks a string name or url/)
  bad(j => { delete j.result }, /no result/)
  const by = ckan.resourcesByName({ resources: [
    { name: 'PrivateHealth.gov.au April 2026.zip', url: 'u1' }, { name: 'PrivateHealth.gov.au March 2026.zip', url: 'u2' },
    { name: 'privatehealth-05-apr-2026.zip', url: 'u3' }, { name: 'PrivateHealth.gov.au Foo 2026.zip', url: 'u4' }, { name: 'PrivateHealth.gov.au April 2026.zip.bak', url: 'u5' },
  ] })
  assert.deepEqual([...by.keys()], ['April 2026', 'March 2026']); assert.equal(by.get('April 2026').url, 'u1')
  const ok = (u, hosts, o) => ckan.allowedUrl(u, hosts, o)
  assert.equal(ok('https://data.gov.au/x.zip'), true)
  assert.equal(ok('https://files.data.gov.au/x.zip'), true)
  assert.equal(ok('HTTPS://DATA.GOV.AU/x.zip'), true)
  assert.equal(ok('http://data.gov.au/x.zip'), false)
  assert.equal(ok('https://data.gov.au.evil.example/x.zip'), false)
  assert.equal(ok('https://evildata.gov.au/x.zip'), false)
  assert.equal(ok('https://user:pw@data.gov.au/x.zip'), false)
  assert.equal(ok('ftp://data.gov.au/x.zip'), false)
  assert.equal(ok('not a url'), false); assert.equal(ok(null), false)
  assert.equal(ok('http://127.0.0.1:1/x', ['127.0.0.1'], { allowInsecure: true }), true)
  assert.equal(ok('http://127.0.0.1:1/x', ['127.0.0.1']), false)
  const pkg = await ckan.packageShow({ fetchImpl: async (u) => { assert.ok(u.startsWith(ckan.API + '?id=')); return new Response(JSON.stringify(good())) } })
  assert.equal(pkg.id, PKG)
  await assert.rejects(ckan.packageShow({ fetchImpl: async () => new Response('x', { status: 500 }) }), /CKAN 500/)
  assert.ok(ckan.RESOURCE_RE.test('PrivateHealth.gov.au December 2026.zip') && !ckan.RESOURCE_RE.test('PrivateHealth.gov.au Dec 2026.zip'))
})

await group('ckan: download over a local http server (redirects, limits, idle, .part cleanup)', async () => {
  const server = createServer((req, res) => {
    const u = req.url
    if (u === '/start') { res.writeHead(302, { location: '/hop1' }); res.end(); return }
    if (u === '/hop1') { res.writeHead(307, { location: '/file' }); res.end(); return }
    if (u === '/file') { res.writeHead(200, { 'content-type': 'application/zip' }); res.end(ZIP); return }
    if (u === '/loop') { res.writeHead(302, { location: '/loop' }); res.end(); return }
    if (u === '/evil') { res.writeHead(302, { location: 'https://evil.example/x.zip' }); res.end(); return }
    if (u === '/noloc') { res.writeHead(302); res.end(); return }
    if (u === '/big') { res.writeHead(200); res.end(Buffer.alloc(100000)); return }
    if (u === '/slow') { res.writeHead(200); res.write('abc'); return }
    res.writeHead(404); res.end()
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const opts = (extra = {}) => ({ hosts: ['127.0.0.1'], allowInsecure: true, ...extra })
  try {
    const dest = join(TMP, 'dl.zip')
    const got = await ckan.download(`${base}/start`, dest, opts())
    assert.equal(got.bytes, ZIP.length); assert.equal(got.sha256, sha256(ZIP)); assert.equal(got.md5, md5(ZIP)); assert.equal(got.url, `${base}/file`)
    assert.equal(sha256(readFileSync(dest)), sha256(ZIP)); assert.ok(!existsSync(dest + '.part'))
    await assert.rejects(ckan.download(`${base}/file`, join(TMP, 'd1.zip'), { hosts: ['127.0.0.1'] }), /refusing http:/, 'http needs allowInsecure')
    await assert.rejects(ckan.download(`${base}/file`, join(TMP, 'd2.zip'), opts({ hosts: ['data.gov.au'] })), /refusing/)
    await assert.rejects(ckan.download(`${base}/evil`, join(TMP, 'd3.zip'), opts()), /refusing https:\/\/evil\.example/)
    await assert.rejects(ckan.download(`${base}/loop`, join(TMP, 'd4.zip'), opts({ limits: { ...LIMITS, redirects: 3 } })), /more than 3 redirects/)
    await assert.rejects(ckan.download(`${base}/noloc`, join(TMP, 'd5.zip'), opts()), /without a Location/)
    await assert.rejects(ckan.download(`${base}/missing`, join(TMP, 'd6.zip'), opts()), /HTTP 404/)
    await assert.rejects(ckan.download(`${base}/big`, join(TMP, 'd7.zip'), opts({ limits: { ...LIMITS, zipBytes: 1000 } })), /exceeds 1000 bytes/)
    assert.ok(!existsSync(join(TMP, 'd7.zip')) && !existsSync(join(TMP, 'd7.zip.part')), '.part removed after size abort')
    await assert.rejects(ckan.download(`${base}/slow`, join(TMP, 'd8.zip'), opts({ limits: { ...LIMITS, idleMs: 200 } })), /no data for 200 ms/)
    assert.ok(!existsSync(join(TMP, 'd8.zip.part')))
    await assert.rejects(ckan.download(`${base}/slow`, join(TMP, 'd9.zip'), opts({ limits: { ...LIMITS, zipTimeoutMs: 50, idleMs: 5000 } })), /exceeded 50 ms/)
  } finally { server.closeAllConnections?.(); await new Promise(r => server.close(r)) }
})

await group('fetch: fetchAll end to end with a mocked CKAN (manifest, verified skip, corruption, republish, hash)', async () => {
  const dataDir = join(TMP, 'fdata'); const manifestFile = join(dataDir, 'snapshots.json')
  const pkgJson = (hash = 'md5:' + md5(ZIP)) => ({ success: true, result: { id: PKG, license_id: 'cc-by', resources: [
    { id: 'res-apr', name: 'PrivateHealth.gov.au April 2026.zip', url: 'https://data.gov.au/r/apr', size: ZIP.length + 7, hash, last_modified: '2026-04-05T01:02:03' },
    { id: 'res-mar', name: 'PrivateHealth.gov.au March 2026.zip', url: 'https://data.gov.au/r/mar', size: null, hash: '' },
  ] } })
  const calls = []
  const mock = (hash) => async (u, o) => {
    calls.push(u)
    if (u.startsWith(ckan.API)) return new Response(JSON.stringify(pkgJson(hash)))
    if (u === 'https://data.gov.au/r/apr') { assert.equal(o.redirect, 'manual'); return new Response(null, { status: 302, headers: { location: 'https://files.data.gov.au/apr.zip' } }) }
    if (u === 'https://files.data.gov.au/apr.zip') return new Response(ZIP)
    if (u === 'https://data.gov.au/r/mar') return new Response(ZIP)
    throw new Error(`unexpected fetch ${u}`)
  }
  const manifest = { package: PKG, resources: {} }
  const logs = []
  await fetchAll({ names: ['April 2026'], fetchImpl: mock(), log: m => logs.push(m), manifest, manifestFile, dataDir })
  const dir = join(dataDir, 'april-2026')
  assert.deepEqual(readdirSync(dir).sort(), ['Combined Open 05-Apr-2026.xml', 'Funds 05-Apr-2026.xml', 'Hospital Open 05-Apr-2026.xml', 'Product Changes 05-Apr-2026.csv'])
  assert.ok(!existsSync(join(dataDir, 'april-2026.zip')), 'zip deleted after extraction')
  assert.ok(calls.some(u => u.startsWith(ckan.API)) && calls.includes('https://files.data.gov.au/apr.zip'))
  assert.ok(logs.some(l => /warning — CKAN size/.test(l)), 'size mismatch is a warning only')
  const saved = JSON.parse(readFileSync(manifestFile, 'utf8'))
  const e = saved.resources['April 2026']
  assert.equal(e.sha256, sha256(ZIP)); assert.equal(e.id, 'res-apr'); assert.equal(e.url, 'https://data.gov.au/r/apr'); assert.equal(e.stamp, '05-Apr-2026')
  assert.equal(e.ckanHash, 'md5:' + md5(ZIP)); assert.equal(e.last_modified, '2026-04-05T01:02:03'); assert.equal(e.size, ZIP.length + 7)
  assert.deepEqual(Object.keys(e), ['ckanHash', 'id', 'last_modified', 'members', 'sha256', 'size', 'stamp', 'url'], 'sorted keys')
  assert.equal(e.members['Hospital Open 05-Apr-2026.xml'].sha256, sha256(readFileSync(join(APR, 'Hospital Open 05-Apr-2026.xml'))))
  // 두 번째 실행: 네트워크 0
  logs.length = 0
  await fetchAll({ names: ['April 2026'], fetchImpl: async (u) => { throw new Error(`network used: ${u}`) }, log: m => logs.push(m), manifest: loadManifest(manifestFile), manifestFile, dataDir })
  assert.deepEqual(logs, ['April 2026: verified'])
  // 멤버 1바이트 손상 → 재다운로드로 복구
  const f = join(dir, 'Funds 05-Apr-2026.xml'); const buf = readFileSync(f); buf[10] ^= 0x01; writeFileSync(f, buf)
  calls.length = 0
  await fetchAll({ names: ['April 2026'], fetchImpl: mock(), log: noop, manifest: loadManifest(manifestFile), manifestFile, dataDir })
  assert.ok(calls.includes('https://files.data.gov.au/apr.zip'), 're-downloaded')
  assert.equal(sha256(readFileSync(f)), sha256(readFileSync(join(APR, 'Funds 05-Apr-2026.xml'))))
  // 재발행: 매니페스트의 zip sha256 과 다르면 멈춘다
  const m2 = loadManifest(manifestFile); m2.resources['April 2026'].sha256 = 'f'.repeat(64); rmSync(f)
  await assert.rejects(fetchAll({ names: ['April 2026'], fetchImpl: mock(), log: noop, manifest: m2, manifestFile, dataDir }), /publisher republished or download corrupted/)
  assert.ok(!existsSync(join(dataDir, 'april-2026.zip')), 'zip removed')
  assert.equal(JSON.parse(readFileSync(manifestFile, 'utf8')).resources['April 2026'].sha256, sha256(ZIP), 'manifest not rewritten on failure')
  // CKAN 해시 불일치
  const d3 = join(TMP, 'fdata3')
  await assert.rejects(fetchAll({ names: ['April 2026'], fetchImpl: mock('md5:' + 'a'.repeat(32)), log: noop, manifest: { package: PKG, resources: {} }, manifestFile: join(d3, 's.json'), dataDir: d3 }), /CKAN md5 a{32} ≠ downloaded/)
  assert.ok(!existsSync(join(d3, 'april-2026.zip')))
  await fetchAll({ names: ['April 2026'], fetchImpl: mock('sha256:' + sha256(ZIP)), log: noop, manifest: { package: PKG, resources: {} }, manifestFile: join(d3, 's.json'), dataDir: d3 })
  assert.ok(existsSync(join(d3, 'april-2026', 'Funds 05-Apr-2026.xml')))
  // 모르는 이름, 라이선스 변경
  await assert.rejects(fetchAll({ names: ['April 2024'], fetchImpl: mock(), log: noop, manifest: { package: PKG, resources: {} }, manifestFile: join(TMP, 'f4.json'), dataDir: join(TMP, 'fdata4') }), /no resource named "PrivateHealth\.gov\.au April 2024\.zip"/)
  await assert.rejects(fetchAll({ names: ['April 2026'], fetchImpl: async () => new Response(JSON.stringify({ success: true, result: { id: PKG, license_id: 'cc0', resources: [] } })), log: noop, manifest: { package: PKG, resources: {} }, manifestFile: join(TMP, 'f5.json'), dataDir: join(TMP, 'fdata5') }), /licence changed: cc0/)
  // 이전 실행이 남긴 ZIP 은 다시 받지 않고 해시만 잰다
  const d6 = join(TMP, 'fdata6'); mkdirSync(d6, { recursive: true }); writeFileSync(join(d6, 'april-2026.zip'), ZIP)
  calls.length = 0
  await fetchAll({ names: ['April 2026'], fetchImpl: mock(), log: noop, manifest: { package: PKG, resources: {} }, manifestFile: join(d6, 's.json'), dataDir: d6 })
  assert.ok(!calls.includes('https://files.data.gov.au/apr.zip'), 'no download when the zip is already there')
  assert.equal((await hashFile(join(APR, 'Funds 05-Apr-2026.xml'))).sha256, sha256(readFileSync(join(APR, 'Funds 05-Apr-2026.xml'))))
})

rmSync(TMP, { recursive: true, force: true })
if (failed) { console.log(`\n${failed} group(s) failed`); process.exit(1) }
console.log('\nOK — unit tests passed on fixtures (no network)')
