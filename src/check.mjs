// Day 2 의 유일한 테스트. 이 숫자들이 깨지면 스케일 서명이나 초과금 추출이
// 조용히 어긋난 것이다. 값은 2026-08-27 에 원본 ZIP 에서 실측한 것.
import assert from 'node:assert'
import { load, key, pct, median } from './join.mjs'

const mar = await load('data/march-2026/Hospital Open 01-Mar-2026.xml')
const apr = await load('data/april-2026/Hospital Open 05-Apr-2026.xml')
console.log(`march ${mar.size} / april ${apr.size} open products`)

const changes = []
for (const [k, a] of apr) {
  const m = mar.get(k)
  if (m && Number.isFinite(m.premium) && Number.isFinite(a.premium) && m.premium > 0) {
    changes.push({ k, tier: a.tier, d: pct(m.premium, a.premium) })
  }
}
const band = (lo, hi) => changes.filter(c => c.d >= lo && c.d < hi).length
const bands = [changes.filter(c => c.d < 0).length, band(0, 5), band(5, 10), band(10, 15), band(15, 20), changes.filter(c => c.d >= 20).length]
const med = median(changes.map(c => c.d))

console.log(`common       ${changes.length}`)
console.log(`median       ${med.toFixed(2)}%`)
console.log(`bands        fell ${bands[0]} / <5% ${bands[1]} / 5-10% ${bands[2]} / 10-15% ${bands[3]} / 15-20% ${bands[4]} / 20%+ ${bands[5]}`)
const byTier = {}
for (const c of changes) (byTier[c.tier] ??= []).push(c.d)
for (const t of Object.keys(byTier).sort()) console.log(`  ${t.padEnd(12)} ${median(byTier[t]).toFixed(2)}%  (n=${byTier[t].length})`)

assert.strictEqual(changes.length, 29702, 'common product count')
assert.strictEqual(med.toFixed(2), '4.15', 'median increase')
assert.deepStrictEqual(bands, [524, 17538, 9515, 1352, 177, 596], 'distribution bands')
console.log('\nOK — 관문 숫자 3종 일치')
