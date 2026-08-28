// 브라우저 없이 render() 를 실제로 돌려 본다. 템플릿 문자열이 많이 바뀌었고
// 열 번호가 하나만 어긋나도 화면에 undefined 가 찍힌다.
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const D = JSON.parse(readFileSync('site/index.json', 'utf8'))
const els = {}
const el = (id) => (els[id] ??= { id, innerHTML: '', textContent: '', value: '', disabled: false, onchange: null })
el('out')
const ctx = vm.createContext({
  document: { getElementById: el },
  location: { hash: '' },
  window: {},
  fetch: () => new Promise(() => {}),   // 로드는 직접 채운다
  console,
})
vm.runInContext(readFileSync('site/app.js', 'utf8'), ctx)
// app.js 의 `let D` 는 컨텍스트의 렉시컬 스코프에 있어 밖에서 못 꽂는다. 안에서 대입한다.
ctx.__J = D
vm.runInContext('D = __J', ctx)

const F = { fund:0, name:1, state:2, who:3, exP:4, exA:5, tier:6, cover:7, type:8,
            prem:9, pct:10, before:11, hist:12, corp:13, restr:14, corpTxt:15,
            url:16, copay:17, accom:18, gap:19, amb:20, waiv:21, waits:22, sibWho:23, sibPrem:24 }

// 각 분기를 최소 하나씩 태운다
const pick = (f, n = 3) => D.products.filter(f).slice(0, n)
const cases = [
  ['상승', pick(p => p[F.pct] > 5 && !p[F.corp])],
  ['하락', pick(p => p[F.pct] != null && p[F.pct] < 0)],
  ['변동없음', pick(p => p[F.pct] != null && p[F.before] === p[F.prem])],
  ['비교불가', pick(p => p[F.pct] == null)],
  ['형제갈라짐', pick(p => p[F.sibWho] >= 0)],
  ['법인', pick(p => p[F.corp] === 1 && p[F.pct] != null)],
  ['제한', pick(p => p[F.restr] === 1 && p[F.pct] != null)],
  ['최대상승', D.products.filter(p => p[F.pct] != null).sort((a, b) => b[F.pct] - a[F.pct]).slice(0, 2)],
  ['결합', pick(p => p[F.type] === 1 && p[F.pct] != null)],
]

let bad = 0
for (const [label, ps] of cases) {
  if (!ps.length) { console.log(`  ${label}: 표본 없음`); continue }
  for (const p of ps) {
    els.out.innerHTML = ''
    ctx.render(p)
    const h = els.out.innerHTML
    for (const probe of ['undefined', 'NaN', '[object Object]', '&amp;amp;', '$null'])
      if (h.includes(probe)) { console.log(`  ✗ ${label}: "${probe}" 발견 — ${D.s.names[p[F.name]]}`); bad++ }
    if (h.length < 400) { console.log(`  ✗ ${label}: 출력이 너무 짧다 (${h.length})`); bad++ }
  }
  console.log(`  ${label}: ${ps.length}건 렌더 OK`)
}

// 금지어가 렌더된 결과에 나오는지 — 설계 문서가 아니라 실제 출력으로 본다
const sample = D.products.filter(p => p[F.pct] != null).slice(0, 300)
const banned = /\b(cheaper|cheapest|better|best|switch to|you should|we recommend)\b/i
let hits = 0
for (const p of sample) { els.out.innerHTML = ''; ctx.render(p); if (banned.test(els.out.innerHTML)) hits++ }
console.log(`  금지어: 300건 중 ${hits}건`)
if (hits) bad++

// picker: 화면상 다른 행이 라벨 충돌로 숨으면 안 된다 (2026-08-28 에 1,108건이 숨어 있었다)
for (const id of ['fund', 'name', 'state', 'variant']) el(id)
const g = new Map()
for (const p of D.products) { const k = [p[F.fund], p[F.name], p[F.state]].join('|'); (g.get(k) ?? g.set(k, []).get(k)).push(p) }
const vis = (a, b) => [F.who, F.exP, F.exA, F.prem, F.pct].every(i => a[i] === b[i]) && JSON.stringify(a[F.hist]) === JSON.stringify(b[F.hist])
let hidden = 0
for (const rows of g.values()) {
  els.fund.value = rows[0][F.fund]; els.name.value = String(rows[0][F.name]); els.state.value = rows[0][F.state]
  ctx.refreshVariant()
  const shown = [...ctx.window.__variants.values()]
  for (const p of rows) if (!shown.some(q => vis(q, p))) hidden++
}
console.log(`  picker: 화면상 다른데 숨는 행 ${hidden}`)
if (hidden) bad++

console.log(bad ? `\n실패 ${bad}건` : '\nOK — 모든 분기 렌더 정상')
process.exit(bad ? 1 : 0)
