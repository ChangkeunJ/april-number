// 이력 커버리지. 현재 열린 상품 중 몇 개가 history 의 모든 4월 점을 갖는가.
import { load, key } from './join.mjs'
import { RISE, xmlPath, yearOf } from './config.mjs'

const NAMES = RISE.history
const snap = new Map()
for (const n of NAMES) { snap.set(n, await load(xmlPath(n, 'Hospital'))); console.log(`${yearOf(n)}: ${snap.get(n).size}`) }

const cur = snap.get(RISE.after)
let full = 0, twoPoint = 0
const hist = new Map()
const L = NAMES.length
for (const k of cur.keys()) {
  const pts = NAMES.map(n => snap.get(n).get(k)?.premium ?? null)
  hist.set(k, pts)
  if (pts.every(p => Number.isFinite(p))) full++
  if (L >= 2 && Number.isFinite(pts[L - 2]) && Number.isFinite(pts[L - 1])) twoPoint++
}
const n = cur.size
console.log(`\n${L}개 점 전부: ${full} / ${n} = ${(full / n * 100).toFixed(1)}%`)
if (L >= 2) console.log(`${yearOf(NAMES[L - 2])}→${yearOf(NAMES[L - 1])}:   ${twoPoint} / ${n} = ${(twoPoint / n * 100).toFixed(1)}%`)
