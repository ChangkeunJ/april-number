// site/app.js 가 인덱스에 대해 세우는 가정을 브라우저 없이 검사한다.
// 열 번호가 어긋나거나 데이터 모양이 바뀌면 여기서 먼저 터진다.
// 구조 검사는 항상 돌고, 개수 검사는 rise.json 의 expected[riseYear] 가 있을 때만 돈다.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { F, WIDTH } from './columns.mjs'
import { RISE, expectedFor, isCandidate, yearOf } from './config.mjs'
import { SCHEMA } from './build.mjs'

export function checkIndex(D, { expected = null, restrictedFunds = RISE.restrictedFunds, history = RISE.history, log = console.log } = {}) {
  let skipped = 0
  const count = (fn) => { if (expected) fn(expected); else skipped++ }
  const RS = new Set(restrictedFunds)

  // 0. 빌드 식별: app.js 가 대조하는 schema, version.js 의 ?v= 가 되는 version, 푸터에 찍히는 built
  assert.equal(D.meta.schema, SCHEMA, 'meta.schema')
  assert.match(String(D.meta.version), /^[0-9a-f]{12}$/, 'meta.version')
  assert.ok(typeof D.meta.built === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(D.meta.built) && !Number.isNaN(Date.parse(D.meta.built)), 'meta.built is a full ISO timestamp')

  // 1. 열 개수가 F 와 맞는다
  for (const p of D.products) assert.equal(p.length, WIDTH, 'row width')

  // 2. 관문 숫자. 이게 깨지면 파서나 조인 키가 조용히 어긋난 것이다.
  count(e => assert.equal(D.stats.hospital.open, e.hospital.open, 'hospital open'))
  count(e => assert.equal(D.stats.hospital.priced, e.hospital.priced, 'hospital priced'))
  count(e => assert.equal(D.stats.hospital.median, e.hospital.median, 'hospital median'))
  count(e => assert.deepEqual(D.stats.hospital.bands, e.hospital.bands, 'hospital bands'))
  // 형제 갈라짐: 3월엔 동가였는데 4월엔 더 싼 스케일이 같은 상품 안에 있다
  count(e => assert.equal(D.stats.hospital.split, e.hospital.split, 'hospital split'))
  // 소매 모집단과 변동 없음 집계 — 화면 문장이 그대로 쓰는 숫자들
  count(e => assert.equal(D.stats.hospital.pricedRetail, e.hospital.pricedRetail, 'hospital pricedRetail'))
  count(e => assert.equal(D.stats.hospital.medianRetail, e.hospital.medianRetail, 'hospital medianRetail'))
  count(e => assert.equal(D.stats.hospital.zero, e.hospital.zero, 'hospital zero'))
  count(e => assert.deepEqual(D.stats.hospital.topBand, e.hospital.topBand, 'hospital topBand'))
  count(e => assert.equal(D.stats.combined.priced, e.combined.priced, 'combined priced'))
  count(e => assert.equal(D.products.length, e.products, 'products total'))
  // 변동 없음 분기는 반올림이 아니라 실제 값으로 갈린다
  assert.equal(D.products.filter(p => p[F.pct] != null && p[F.before] === p[F.prem]).length,
    D.stats.hospital.zero + D.stats.combined.zero, '값 동일 행 수')
  // 가입 제한 보험사는 전부 데이터에 있고, meta 로도 프론트에 전달된다
  for (const c of RS) assert.ok(D.funds[c], `제한 보험사 코드 ${c} 가 데이터에 없다`)
  assert.deepEqual(D.meta.restrictedFunds, [...restrictedFunds], 'meta.restrictedFunds')
  {
    const flagged = D.products.filter(p => p[F.sibWho] >= 0)
    assert.equal(flagged.length, D.stats.hospital.split + D.stats.combined.split, '플래그된 행 수')
    for (const p of flagged) {
      assert.ok(p[F.pct] != null, '갈라짐 표시는 상승률이 있는 행에만')
      assert.ok(p[F.sibPrem] < p[F.prem], '형제가 더 싸야 한다')
      assert.ok(D.s.whos[p[F.sibWho]] !== D.s.whos[p[F.who]], '형제는 다른 스케일이어야 한다')
    }
  }

  // 3. before → prem 이 pct 와 일치한다 (역산이 아니라 실제 값이어야 한다)
  let checked = 0
  for (const p of D.products) {
    if (p[F.pct] == null) { assert.equal(p[F.before], null); continue }
    const d = (p[F.prem] - p[F.before]) / p[F.before] * 100
    assert.ok(Math.abs(d - p[F.pct]) < 0.005, `pct mismatch ${d} vs ${p[F.pct]}`)
    checked++
  }
  assert.equal(checked, D.stats.hospital.priced + D.stats.combined.priced, 'priced rows vs stats')
  count(e => assert.equal(checked, e.hospital.priced + e.combined.priced, 'priced rows'))

  // 4. 이력의 마지막 점은 4월 보험료와 같아야 하고, 길이는 history 와 같다
  const last = history.length - 1
  for (const p of D.products) {
    assert.equal(p[F.hist].length, history.length, 'hist length')
    assert.equal(p[F.hist][last], p[F.prem], 'hist last = prem')
  }
  assert.equal(D.meta.years.length, history.length, 'meta.years length')
  assert.deepEqual(D.meta.years, history.map(yearOf), 'meta.years')

  // 5. 문자열 테이블 참조가 전부 유효하다
  for (const p of D.products) {
    assert.ok(D.s.names[p[F.name]], 'name')
    assert.ok(D.s.whos[p[F.who]] !== undefined, 'who')
    assert.ok(D.s.covers[p[F.cover]], 'cover')
    assert.ok(p[F.corpTxt] === -1 || D.s.corpText[p[F.corpTxt]] !== undefined, 'corpText')
    assert.ok(p[F.url] === -1 || /^https?:/.test(D.s.urls[p[F.url]]), 'url is http(s) or absent')
    assert.ok(p[F.waiv] === -1 || D.s.waivers[p[F.waiv]] !== undefined, 'waivers')
    assert.ok(p[F.waits] === -1 || D.s.waits[p[F.waits]] !== undefined, 'waits')
  }

  // 6. 대안 목록은 절대로 못 사는 상품을 담지 않는다 (Trivago 형태의 오표시 방지).
  // app.js 와 같은 세 조건(법인·가입조건부·제한 보험사)으로 소매 모집단을 다시 세어 stats 와 맞춘다.
  const retail = (p) => !p[F.corp] && !p[F.restr] && !RS.has(p[F.fund])
  for (const [type, k] of [[0, 'hospital'], [1, 'combined']]) {
    assert.equal(D.products.filter(p => p[F.type] === type && p[F.pct] != null && retail(p)).length,
      D.stats[k].pricedRetail, `${k} pricedRetail vs rows`)
  }
  for (const p of D.products) {
    assert.ok(p[F.corp] === 0 || p[F.corp] === 1, 'corp flag')
    assert.ok(p[F.restr] === 0 || p[F.restr] === 1, 'restr flag')
    // 법인 상품은 안내문 인덱스가 있거나(-1 이면 app.js 가 기본 문장을 쓴다) 테이블을 가리켜야 한다
    if (p[F.corp]) assert.ok(p[F.corpTxt] === -1 || typeof D.s.corpText[p[F.corpTxt]] === 'string', 'corporate row corpText')
  }
  const excluded = D.products.filter(p => !retail(p)).length
  assert.ok(excluded > 0, 'expected some corporate/restricted rows')
  count(e => { if (e.excludedMin !== undefined) assert.ok(excluded >= e.excludedMin, `expected the restricted universe to be large, got ${excluded}`) })

  // 7. 실제 상품 하나로 끝까지 걸어본다
  const p = D.products.find(x => x[F.type] === 0 && x[F.pct] != null && x[F.hist].every(v => v != null))
  assert.ok(p, 'a hospital product with a full history')
  const peers = D.products.filter(q => q !== p && q[F.state] === p[F.state] && q[F.cover] === p[F.cover] &&
    q[F.who] === p[F.who] && q[F.exP] === p[F.exP] && q[F.exA] === p[F.exA] && q[F.type] === p[F.type] && retail(q))
  for (const q of peers) assert.ok(retail(q) && !RS.has(q[F.fund]), 'peer must be buyable')
  log(`sample: ${D.funds[p[F.fund]]} — ${D.s.names[p[F.name]]} (${p[F.state]})`)
  log(`  ${p[F.before]} → ${p[F.prem]} = ${p[F.pct]}%   history ${p[F.hist].join(' ')}`)
  log(`  buyable same-cover peers: ${peers.length}`)
  log(`  corporate+restricted excluded from alternatives: ${excluded.toLocaleString()} of ${D.products.length.toLocaleString()}`)
  log(`\nOK — ${D.products.length.toLocaleString()} rows, ${checked.toLocaleString()} price changes verified${skipped ? ` (${skipped} count assertions skipped: no expected block)` : ''}`)
  return { checked, skipped, excluded }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const D = JSON.parse(readFileSync('site/index.json', 'utf8'))
    const expected = expectedFor(RISE.riseYear)
    if (!expected && !isCandidate()) {
      console.error(`rise.json has no "expected" block for ${RISE.riseYear}; run with --candidate to check structure only`)
      process.exit(2)
    }
    checkIndex(D, { expected })
  } catch (e) { console.error(e.message); process.exit(1) }
}
