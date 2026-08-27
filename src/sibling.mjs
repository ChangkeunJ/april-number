// 형제 갈라짐. 같은 상품(기금·이름·주·초과금·티어·커버) 안에서 누가 커버되는지만
// 다른 행들 중, 3월엔 내 것과 값이 같았는데 4월엔 더 싸진 게 있는가.
// 있으면 그건 의심이 아니라 사실이고, 독자가 바로 쓸 수 있는 정보다.
import { parseFile } from './parse.mjs'
import { key, pct, median } from './join.mjs'
const D='data'
const load = async p => { const a=[]; await parseFile(p, r=>{ if(r.status==='Open') a.push(r) }); return a }
const marA = await load(`${D}/march-2026/Hospital Open 01-Mar-2026.xml`)
const aprA = await load(`${D}/april-2026/Hospital Open 05-Apr-2026.xml`)
const mar = new Map(marA.map(r=>[key(r),r]))
const sib = r => `${r.fund}|${r.name}|${r.state}|${r.exPerson}|${r.exAdmission}|${r.tier}|${r.cover}`

const aprSib = new Map()
for (const r of aprA) { let s=aprSib.get(sib(r)); if(!s) aprSib.set(sib(r), s=[]); s.push(r) }

let n=0, hits=0
const gaps=[]
for (const a of aprA) {
  const b = mar.get(key(a)); if(!b || !(a.premium>0) || !(b.premium>0)) continue
  n++
  // 3월 동가 → 4월 내가 더 비쌈
  const best = (aprSib.get(sib(a))||[]).filter(x => {
    if (x.who === a.who) return false
    const xb = mar.get(key(x))
    return xb && xb.premium === b.premium && x.premium < a.premium
  }).sort((p,q)=>p.premium-q.premium)[0]
  if (best) { hits++; gaps.push({ f:a.fund, name:a.name, st:a.state, mine:a.who, theirs:best.who,
    was:b.premium, now:a.premium, alt:best.premium, pct:pct(b.premium,a.premium) }) }
}
console.log(`매칭 ${n} 중 형제 갈라짐 ${hits} (${(hits/n*100).toFixed(1)}%)`)
const byFund={}; for(const g of gaps) byFund[g.f]=(byFund[g.f]||0)+1
console.log('기금별:', Object.entries(byFund).sort((a,b)=>b[1]-a[1]).slice(0,8))
console.log('갈라진 쪽 중앙값', median(gaps.map(g=>g.pct)).toFixed(2)+'%')
console.log('\n샘플:')
for (const g of gaps.sort((a,b)=>b.pct-a.pct).slice(0,6))
  console.log(`  ${g.f} ${g.name} (${g.st})\n     내 스케일 ${g.mine}  ${g.was} → ${g.now} (${g.pct.toFixed(1)}%)\n     3월 동가였던 ${g.theirs}  는 지금 ${g.alt}`)
