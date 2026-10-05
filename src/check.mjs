// 관문 테스트. 이 숫자들이 깨지면 스케일 서명이나 초과금 추출이 조용히 어긋난 것이다.
// 기대값은 rise.json 의 expected[riseYear] 다 (2026 값은 2026-08-27 에 원본 ZIP 에서 실측).
// 기대값이 없는 해는 --candidate 로 후보 블록을 뽑아 손으로 검증한 뒤 rise.json 에 pin 한다.
// probe.mjs 의 SchemaVersion 3.1 검사도 여기서 한다.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseFile } from './parse.mjs'
import { key, pct, median } from './join.mjs'
import { RISE, ROOT, xmlPath, stampOf, expectedFor, isCandidate } from './config.mjs'

export const SCHEMA = '3.1'

// Open 상품을 키로 모으면서 모든 행의 SchemaVersion 을 센다.
async function loadCounting(path) {
  const m = new Map()
  const versions = Object.create(null)
  await parseFile(path, r => {
    const v = r.schema ?? 'null'
    versions[v] = (versions[v] || 0) + 1
    if (r.status === 'Open') m.set(key(r), r)
  })
  return { m, versions }
}

export async function check({
  before = RISE.before, after = RISE.after, expected = expectedFor(RISE.riseYear),
  candidate = isCandidate(), reportsDir = process.env.REPORTS_DIR ? resolve(process.env.REPORTS_DIR) : join(ROOT, 'reports'), log = console.log,
} = {}) {
  const marPath = xmlPath(before, 'Hospital'), aprPath = xmlPath(after, 'Hospital')
  const { m: mar, versions: vMar } = await loadCounting(marPath)
  const { m: apr, versions: vApr } = await loadCounting(aprPath)
  log(`march ${mar.size} / april ${apr.size} open products`)

  const changes = []
  for (const [k, a] of apr) {
    const b = mar.get(k)
    if (b && Number.isFinite(b.premium) && Number.isFinite(a.premium) && b.premium > 0) {
      changes.push({ k, tier: a.tier, d: pct(b.premium, a.premium) })
    }
  }
  const band = (lo, hi) => changes.filter(c => c.d >= lo && c.d < hi).length
  const bands = [changes.filter(c => c.d < 0).length, band(0, 5), band(5, 10), band(10, 15), band(15, 20), changes.filter(c => c.d >= 20).length]
  const med = median(changes.map(c => c.d))

  log(`common       ${changes.length}`)
  log(`median       ${med.toFixed(2)}%`)
  log(`bands        fell ${bands[0]} / <5% ${bands[1]} / 5-10% ${bands[2]} / 10-15% ${bands[3]} / 15-20% ${bands[4]} / 20%+ ${bands[5]}`)
  const byTier = Object.create(null)
  for (const c of changes) (byTier[c.tier] ??= []).push(c.d)
  const tiers = {}
  for (const t of Object.keys(byTier).sort()) {
    tiers[t] = [Math.round(median(byTier[t]) * 100) / 100, byTier[t].length]
    log(`  ${t.padEnd(12)} ${median(byTier[t]).toFixed(2)}%  (n=${byTier[t].length})`)
  }

  // SchemaVersion. 3.1 이 아닌 행이 하나라도 있으면 파서 가정이 깨졌을 수 있다.
  const versions = Object.create(null)
  for (const v of [vMar, vApr]) for (const [s, n] of Object.entries(v)) versions[s] = (versions[s] || 0) + n
  const drift = Object.entries(versions).filter(([s]) => s !== SCHEMA).reduce((a, [, n]) => a + n, 0)
  log(`schema       ${Object.entries(versions).map(([s, n]) => `${s}×${n}`).join(', ')}`)

  const result = {
    year: RISE.riseYear, before, after, stamps: { before: stampOf(before), after: stampOf(after) },
    hospital: { open: apr.size, priced: changes.length, median: Math.round(med * 100) / 100, bands },
    byTier: tiers, schemaVersions: { ...versions }, schemaDrift: drift,
  }

  if (expected) {
    result.mode = 'strict'
    assert.equal(drift, 0, `SchemaVersion drift: ${drift} rows not ${SCHEMA}`)
    assert.equal(changes.length, expected.hospital.priced, 'common product count')
    assert.equal(med.toFixed(2), expected.hospital.median.toFixed(2), 'median increase')
    assert.deepEqual(bands, expected.hospital.bands, 'distribution bands')
    log('\nOK — 관문 숫자 3종 일치')
  } else if (candidate) {
    result.mode = 'candidate'
    if (drift) log(`\nwarning: SchemaVersion drift — ${drift} rows are not ${SCHEMA}`)
    // 붙여 넣을 후보. open/priced/median/bands 는 여기서, 나머지는 build 의 stats 에서 채운다.
    const block = { [String(RISE.riseYear)]: { hospital: result.hospital } }
    mkdirSync(reportsDir, { recursive: true })
    const file = join(reportsDir, `candidate-${RISE.riseYear}.json`)
    // 생성 시각은 싣지 않는다: 같은 입력이면 같은 파일이 나와야 update.yml 이 "변경 없음" 을 알아본다 (시각은 커밋이 안다).
    writeFileSync(file, JSON.stringify({ ...result, expected: block }, null, 2) + '\n')
    log(`\ncandidate (not verified) — paste into rise.json "expected" after checking against the raw XML:\n${JSON.stringify(block, null, 2)}\nwritten ${file}`)
    result.file = file
  } else {
    result.mode = 'unverified'
  }
  return result
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  check().then(r => {
    if (r.mode === 'unverified') {
      console.error(`\nrise.json has no "expected" block for ${RISE.riseYear}. Run \`npm run check -- --candidate\` to print one,`)
      console.error('verify it against the raw XML by hand, then pin it in rise.json. Nothing is published until then.')
      process.exit(2)
    }
  }).catch(e => { console.error(e.message); process.exit(1) })
}
