// ProductID 기반 조인 검증. 파일 안에 정부가 만든 정체성 필드가 있다.
//   ProductID     이번 판 정체성 (판마다 새 GUID — 259건만 3월과 같다)
//   ProductItemID 상품 정체성 (개정돼도 유지 — 29,702건이 3·4월 공유)
//   Product Changes CSV 의 OLD_ProductID 가 이전 판을 가리킨다.
import { readFileSync } from 'node:fs'
import { parseFile } from './parse.mjs'
import { key, pct, median } from './join.mjs'

const D = 'data'
const MAR = `${D}/march-2026/Hospital Open 01-Mar-2026.xml`
const APR = `${D}/april-2026/Hospital Open 05-Apr-2026.xml`

const grab = async (path) => {
  const byId = new Map(), byKey = new Map()
  let dupId = 0, dupKey = 0
  await parseFile(path, r => {
    if (r.status !== 'Open') return
    if (byId.has(r.pid)) dupId++
    byId.set(r.pid, r)
    const k = key(r)
    if (byKey.has(k)) dupKey++
    byKey.set(k, r)
  })
  return { byId, byKey, dupId, dupKey }
}

const mar = await grab(MAR), apr = await grab(APR)
console.log(`MAR ${mar.byId.size} ids (dup ${mar.dupId}), ${mar.byKey.size} keys (dup ${mar.dupKey})`)
console.log(`APR ${apr.byId.size} ids (dup ${apr.dupId}), ${apr.byKey.size} keys (dup ${apr.dupKey})`)

// 변경 CSV: ProductID -> OLD_ProductID
const csv = readFileSync(`${D}/april-2026/Product Changes 05-Apr-2026.csv`, 'utf8').split('\n')
const hdr = csv[0].split(',')
const iPid = hdr.indexOf('ProductID'), iOld = hdr.indexOf('OLD_ProductID')
const iType = hdr.indexOf('Change Type'), iCode = hdr.indexOf('ProductCode')
const iOldCode = hdr.indexOf('OLD_ProductCode')
const prev = new Map(); const types = {}
let recode = 0
for (let i = 1; i < csv.length; i++) {
  const f = csv[i].split(',')
  if (f.length < hdr.length) continue
  types[f[iType]] = (types[f[iType]] || 0) + 1
  if (f[iOld]) prev.set(f[iPid].toLowerCase(), f[iOld].toLowerCase())
  if (f[iOld] && f[iCode] !== f[iOldCode]) recode++
}
console.log('CSV change types:', types, '| code changed on', recode)

// 조인 세 방식 비교
const lower = m => new Map([...m].map(([k, v]) => [String(k).toLowerCase(), v]))
const marById = lower(mar.byId)
let sameId = 0, viaCsv = 0, noMatch = 0
const rises = []
const disagree = []
for (const [pid, a] of apr.byId) {
  const p = pid.toLowerCase()
  let b = marById.get(p)
  if (b) sameId++
  else { const o = prev.get(p); if (o && marById.get(o)) { b = marById.get(o); viaCsv++ } }
  if (!b) { noMatch++; continue }
  if (!(a.premium > 0) || !(b.premium > 0)) continue
  rises.push(pct(b.premium, a.premium))
  // 키 조인은 뭐라고 하나?
  const kb = mar.byKey.get(key(a))
  if (kb && kb.pid && kb.pid.toLowerCase() !== (b.pid || '').toLowerCase()) {
    disagree.push({ code: a.code, fund: a.fund, idPct: pct(b.premium, a.premium), keyPct: pct(kb.premium, a.premium) })
  }
}
console.log(`ID join: same ${sameId}, via CSV ${viaCsv}, unmatched ${noMatch}`)
console.log(`median rise (ID join) = ${median(rises).toFixed(4)}%  n=${rises.length}`)
console.log(`키 조인과 다른 짝을 고른 건수: ${disagree.length}`)
for (const d of disagree.slice(0, 10)) console.log('  ', d.fund, d.code, 'id', d.idPct.toFixed(2), 'key', d.keyPct.toFixed(2))
