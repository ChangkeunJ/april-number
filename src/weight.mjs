// 6.98% 라는 합산 상승률이 무엇을 가중하는지 확인한다.
import { parseFile } from './parse.mjs'
import { key, pct, median } from './join.mjs'
const D='data'
const load = async p => { const m=new Map(); await parseFile(p, r=>{ if(r.status==='Open') m.set(key(r),r) }); return m }
const mar = await load(`${D}/march-2026/Hospital Open 01-Mar-2026.xml`)
const apr = await load(`${D}/april-2026/Hospital Open 05-Apr-2026.xml`)

const rows=[]
for (const [k,a] of apr) { const b=mar.get(k); if(b && a.premium>0 && b.premium>0) rows.push({a,b,p:pct(b.premium,a.premium)}) }
const byFund=new Map()
for (const r of rows) { const f=r.a.fund; if(!byFund.has(f)) byFund.set(f,[]); byFund.get(f).push(r) }

const sum=(xs,f)=>xs.reduce((s,x)=>s+f(x),0)
const agg = xs => pct(sum(xs,r=>r.b.premium), sum(xs,r=>r.a.premium))

console.log('fund   n     %products  median   aggregate')
const fs=[...byFund].sort((x,y)=>y[1].length-x[1].length)
for (const [f,xs] of fs.slice(0,15))
  console.log(f.padEnd(6), String(xs.length).padStart(5), (xs.length/rows.length*100).toFixed(1).padStart(9),
    median(xs.map(r=>r.p)).toFixed(2).padStart(8), agg(xs).toFixed(2).padStart(10))

console.log('\n전체 상품수', rows.length)
console.log('중앙값        ', median(rows.map(r=>r.p)).toFixed(4))
console.log('단순평균      ', (sum(rows,r=>r.p)/rows.length).toFixed(4))
console.log('보험료합산    ', agg(rows).toFixed(4))
const noA = rows.filter(r=>r.a.fund!=='AIA')
console.log('AIA 제외 중앙값', median(noA.map(r=>r.p)).toFixed(4), '합산', agg(noA).toFixed(4), 'n', noA.length)
// 기금당 1표로 가중하면?
const perFundMed=[...byFund].map(([f,xs])=>median(xs.map(r=>r.p)))
console.log('기금별 중앙값의 중앙값', median(perFundMed).toFixed(4), '기금수', perFundMed.length)
