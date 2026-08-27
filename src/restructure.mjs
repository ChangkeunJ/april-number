// 상품 개편 탐지. 4월에 같은 (기금,상품명,주) 가족 안으로 새 상품코드가
// 들어왔다면, 매칭된 옛 코드의 상승률은 회원이 실제로 겪은 인상이 아니라
// 스케일 재편의 부산물일 수 있다.
import { parseFile } from './parse.mjs'
import { key, pct, median } from './join.mjs'
const D='data'
const load = async p => { const a=[]; await parseFile(p, r=>{ if(r.status==='Open') a.push(r) }); return a }
const marA = await load(`${D}/march-2026/Hospital Open 01-Mar-2026.xml`)
const aprA = await load(`${D}/april-2026/Hospital Open 05-Apr-2026.xml`)
const mar = new Map(marA.map(r=>[key(r),r]))

const fam = r => `${r.fund}|${r.name}|${r.state}|${r.exPerson}|${r.exAdmission}`
const marCodes = new Map()   // family -> Set(code)
for (const r of marA) { (marCodes.get(fam(r)) ?? marCodes.set(fam(r), new Set()).get(fam(r))).add(r.code) }
const aprCodes = new Map()
for (const r of aprA) { (aprCodes.get(fam(r)) ?? aprCodes.set(fam(r), new Set()).get(fam(r))).add(r.code) }
// 가족별로 4월에 새로 생긴 코드가 있는가
const restructured = new Set()
for (const [f, ac] of aprCodes) { const oc = marCodes.get(f); if (oc && [...ac].some(c => !oc.has(c))) restructured.add(f) }
console.log('개편된 가족', restructured.size, '/ 전체 가족', aprCodes.size)

let matched=0, inRestructured=0
const rows=[], flagged=[], clean=[]
const byFundFlag = new Map()
for (const a of aprA) {
  const b = mar.get(key(a)); if(!b || !(a.premium>0) || !(b.premium>0)) continue
  matched++
  const p = pct(b.premium, a.premium)
  const f = fam(a)
  const newCode = restructured.has(f)
  rows.push(p)
  if (newCode) { inRestructured++; flagged.push(p)
    const k=a.fund; byFundFlag.set(k,(byFundFlag.get(k)||0)+1) }
  else clean.push(p)
}
console.log(`매칭 ${matched}`)
console.log(`개편 가족 안 ${inRestructured} (${(inRestructured/matched*100).toFixed(1)}%)  중앙값 ${median(flagged).toFixed(2)}%`)
console.log(`그 외      ${clean.length} (${(clean.length/matched*100).toFixed(1)}%)  중앙값 ${median(clean).toFixed(2)}%`)
console.log(`전체 중앙값 ${median(rows).toFixed(4)}%`)
console.log('\n개편 플래그가 가장 많은 기금:')
for (const [f,n] of [...byFundFlag].sort((a,b)=>b[1]-a[1]).slice(0,8)) console.log('  ',f,n)

// MYO(AIA) 상세
const myo = aprA.filter(a=>a.fund==='MYO' && mar.get(key(a)))
const myoP = myo.map(a=>pct(mar.get(key(a)).premium, a.premium)).filter(Number.isFinite)
const over = myoP.filter(x=>x>20).length
console.log(`\nMYO 매칭 ${myo.length} 중앙값 ${median(myoP).toFixed(2)}% 20%초과 ${over}`)
const myoFlag = myo.filter(a=>restructured.has(fam(a)))
console.log(`MYO 개편 가족 안 ${myoFlag.length}`)
const myoClean = myo.filter(a=>!restructured.has(fam(a))).map(a=>pct(mar.get(key(a)).premium,a.premium))
console.log(`MYO 개편 제외 중앙값 ${myoClean.length?median(myoClean).toFixed(2):'-'}% n=${myoClean.length}`)
