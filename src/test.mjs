// site/app.js 가 인덱스에 대해 세우는 가정을 브라우저 없이 검사한다.
// 열 번호가 어긋나거나 데이터 모양이 바뀌면 여기서 먼저 터진다.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const D = JSON.parse(readFileSync('site/index.json', 'utf8'))
const F = { fund:0, name:1, state:2, who:3, exP:4, exA:5, tier:6, cover:7, type:8,
            prem:9, pct:10, before:11, hist:12, corp:13, restr:14, corpTxt:15,
            url:16, copay:17, accom:18, gap:19, amb:20, waiv:21, waits:22, sibWho:23, sibPrem:24 }

// 1. 열 개수가 F 와 맞는다
const width = Math.max(...Object.values(F)) + 1
for (const p of D.products) assert.equal(p.length, width, 'row width')

// 2. 관문 숫자. 이게 깨지면 파서나 조인 키가 조용히 어긋난 것이다.
assert.equal(D.stats.hospital.open, 30563)
assert.equal(D.stats.hospital.priced, 29702)
assert.equal(D.stats.hospital.median, 4.15)
assert.deepEqual(D.stats.hospital.bands, [524, 17538, 9515, 1352, 177, 596])
// 형제 갈라짐: 3월엔 동가였는데 4월엔 더 싼 스케일이 같은 상품 안에 있다
assert.equal(D.stats.hospital.split, 499)
// 소매 모집단과 변동 없음 집계 — 화면 문장이 그대로 쓰는 숫자들
assert.equal(D.stats.hospital.pricedRetail, 14574)
assert.equal(D.stats.hospital.medianRetail, 3.54)
assert.equal(D.stats.hospital.zero, 2392)
assert.deepEqual(D.stats.hospital.topBand, { fund: 'MYO', n: 526, total: 596 })
// 변동 없음 분기는 반올림이 아니라 실제 값으로 갈린다
assert.equal(D.products.filter(p => p[F.pct] != null && p[F.before] === p[F.prem]).length,
  D.stats.hospital.zero + D.stats.combined.zero, '값 동일 행 수')
// 가입 제한 보험사는 대안 표 모집단에서 빠진다
{
  const R = new Set(['ACA','CBH','AHB','AMA','NHB','SPE','RBH','NTF','QTU'])
  for (const c of R) assert.ok(D.funds[c], `제한 보험사 코드 ${c} 가 데이터에 없다`)
}
{
  const flagged = D.products.filter(p => p[F.sibWho] >= 0)
  assert.equal(flagged.length, D.stats.hospital.split + D.stats.combined.split, '플래그된 행 수')
  for (const p of flagged) {
    assert.ok(p[F.pct] != null, '갈라짐 표시는 상승률이 있는 행에만')
    assert.ok(p[F.sibPrem] < p[F.prem], '형제가 더 싸야 한다')
    assert.ok(D.s.whos[p[F.sibWho]] !== D.s.whos[p[F.who]], '형제는 다른 스케일이어야 한다')
  }
}
assert.equal(D.products.length, 55678)

// 3. before → prem 이 pct 와 일치한다 (역산이 아니라 실제 값이어야 한다)
let checked = 0
for (const p of D.products) {
  if (p[F.pct] == null) { assert.equal(p[F.before], null); continue }
  const d = (p[F.prem] - p[F.before]) / p[F.before] * 100
  assert.ok(Math.abs(d - p[F.pct]) < 0.005, `pct mismatch ${d} vs ${p[F.pct]}`)
  checked++
}
assert.equal(checked, 29702 + 22312)

// 4. 이력의 마지막 점은 4월 보험료와 같아야 한다
for (const p of D.products) assert.equal(p[F.hist][4], p[F.prem])
assert.equal(D.meta.years.length, 5)

// 5. 문자열 테이블 참조가 전부 유효하다
for (const p of D.products) {
  assert.ok(D.s.names[p[F.name]], 'name')
  assert.ok(D.s.whos[p[F.who]] !== undefined, 'who')
  assert.ok(D.s.covers[p[F.cover]], 'cover')
  assert.ok(p[F.corpTxt] === -1 || D.s.corpText[p[F.corpTxt]] !== undefined, 'corpText')
}

// 6. 대안 목록은 절대로 못 사는 상품을 담지 않는다 (Trivago 형태의 오표시 방지)
const buyable = D.products.filter(p => !p[F.corp] && !p[F.restr])
assert.ok(buyable.every(p => p[F.corp] === 0 && p[F.restr] === 0))
const excluded = D.products.length - buyable.length
assert.ok(excluded > 10000, `expected the restricted universe to be large, got ${excluded}`)

// 7. 실제 상품 하나로 끝까지 걸어본다
const p = D.products.find(x => x[F.type] === 0 && x[F.pct] != null && x[F.hist].every(v => v != null))
const peers = D.products.filter(q => q !== p && q[F.state] === p[F.state] && q[F.cover] === p[F.cover] &&
  q[F.who] === p[F.who] && q[F.exP] === p[F.exP] && q[F.exA] === p[F.exA] && q[F.type] === p[F.type] &&
  !q[F.corp] && !q[F.restr])
console.log(`sample: ${D.funds[p[F.fund]]} — ${D.s.names[p[F.name]]} (${p[F.state]})`)
console.log(`  ${p[F.before]} → ${p[F.prem]} = ${p[F.pct]}%   history ${p[F.hist].join(' ')}`)
console.log(`  buyable same-cover peers: ${peers.length}`)
console.log(`  corporate+restricted excluded from alternatives: ${excluded.toLocaleString()} of ${D.products.length.toLocaleString()}`)
console.log(`\nOK — ${D.products.length.toLocaleString()} rows, ${checked.toLocaleString()} price changes verified`)
