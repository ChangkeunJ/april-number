import { load, key, pct } from './join.mjs'
const YEARS = [2022, 2023, 2024, 2025, 2026]
const FILE = {
  2022: 'data/april-2022/Hospital Open 03-Apr-2022.xml',
  2023: 'data/april-2023/Hospital Open 01-Apr-2023.xml',
  2024: 'data/april-2024/Hospital Open 02-Apr-2024.xml',
  2025: 'data/april-2025/Hospital Open 02-Apr-2025.xml',
  2026: 'data/april-2026/Hospital Open 05-Apr-2026.xml',
}
const snap = {}
for (const y of YEARS) { snap[y] = await load(FILE[y]); console.log(`${y}: ${snap[y].size}`) }

const cur = snap[2026]
let full = 0, twoPoint = 0
const hist = new Map()
for (const k of cur.keys()) {
  const pts = YEARS.map(y => snap[y].get(k)?.premium ?? null)
  hist.set(k, pts)
  if (pts.every(p => Number.isFinite(p))) full++
  if (Number.isFinite(pts[3]) && Number.isFinite(pts[4])) twoPoint++
}
const n = cur.size
console.log(`\n5개 점 전부: ${full} / ${n} = ${(full/n*100).toFixed(1)}%`)
console.log(`2025→2026:   ${twoPoint} / ${n} = ${(twoPoint/n*100).toFixed(1)}%`)
