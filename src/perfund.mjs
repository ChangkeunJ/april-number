import { readFileSync } from 'node:fs'
const D = JSON.parse(readFileSync('site/index.json', 'utf8'))
const F = { fund:0, type:8, prem:9, pct:11, before:12 }
const med = (a) => { const s=[...a].sort((x,y)=>x-y); const i=s.length>>1; return s.length%2?s[i]:(s[i-1]+s[i])/2 }
const g = {}
for (const p of D.products) {
  if (p[F.pct] == null) continue
  ;(g[p[F.fund]] ??= { d: [], before: 0, after: 0 }).d.push(p[F.pct])
  g[p[F.fund]].before += p[F.before]; g[p[F.fund]].after += p[F.prem]
}
const rows = Object.entries(g).map(([c, v]) => ({
  code: c, name: D.funds[c] ?? c, n: v.d.length,
  mean: v.d.reduce((a, b) => a + b, 0) / v.d.length,
  median: med(v.d),
  premWeighted: (v.after - v.before) / v.before * 100,
})).sort((a, b) => b.premWeighted - a.premWeighted)
console.log('fund'.padEnd(46), 'n'.padStart(6), 'mean'.padStart(7), 'median'.padStart(7), 'prem-wtd'.padStart(9))
for (const r of rows) console.log(r.name.slice(0,45).padEnd(46), String(r.n).padStart(6),
  r.mean.toFixed(2).padStart(7), r.median.toFixed(2).padStart(7), r.premWeighted.toFixed(2).padStart(9))
const all = Object.values(g).reduce((a, v) => ({ b: a.b + v.before, af: a.af + v.after }), { b: 0, af: 0 })
console.log('\nALL PRODUCTS prem-weighted:', ((all.af - all.b) / all.b * 100).toFixed(3) + '%')
