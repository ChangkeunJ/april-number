// 브라우저 없이 app.js 를 실제로 돌려 본다. 템플릿 문자열이 많고 열 번호가 하나만
// 어긋나도 화면에 undefined 가 찍힌다. 언어마다 전부 돌린다.
// --site <dir> 로 index.json·strings.js·app.js 를 다른 곳에서 읽는다 (합성 index 로 돌릴 때).
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { checkStrings } from './strings-check.mjs'

const args = process.argv.slice(2)
const site = args.includes('--site') ? args[args.indexOf('--site') + 1] : 'site'
const D = JSON.parse(readFileSync(`${site}/index.json`, 'utf8'))
const els = {}
const mk = (id) => ({ id, innerHTML: '', textContent: '', value: '', disabled: false, onchange: null, dataset: {}, content: '' })
const el = (id) => (els[id] ??= mk(id))
for (const id of ['out', 'fund', 'name', 'state', 'variant', 'snapbefore', 'snapafter', 'lang', 'theme', 'theme-system', 'theme-light', 'theme-dark']) el(id)
const store = {}
const ctx = vm.createContext({
  document: { getElementById: el, querySelectorAll: () => [], querySelector: () => null, documentElement: { dataset: {}, lang: '' }, title: '' },
  location: { hash: '', search: '' },
  localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v }, removeItem: k => { delete store[k] } },
  navigator: { language: 'en-AU' },
  fetch: () => new Promise(() => {}),
  URL, URLSearchParams,
  console,
})
vm.runInContext(readFileSync(`${site}/strings.js`, 'utf8'), ctx)
vm.runInContext(readFileSync(`${site}/app.js`, 'utf8'), ctx)
ctx.__J = D
vm.runInContext('D = __J; indexProducts()', ctx)

// 키 집합·자리표시자·HTML 태그는 strings-check 가 영어와 대조한다. 어긋나면 렌더 전에 던진다.
checkStrings(ctx.STR)

const F = { fund:0, name:1, state:2, who:3, exP:4, exA:5, tier:6, cover:7, type:8,
            prem:9, pct:10, before:11, hist:12, corp:13, restr:14, corpTxt:15,
            url:16, copay:17, accom:18, gap:19, amb:20, waiv:21, waits:22, sibWho:23, sibPrem:24 }

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
const banned = /\b(cheaper|cheapest|better|best|switch to|you should|we recommend)\b/i
const probes = ['undefined', 'NaN', '[object Object]', '&amp;amp;', '$null', '{', 'style=']

let bad = 0
const langs = Object.keys(ctx.STR)
for (const lang of langs) {
  ctx.setLang(lang)
  let n = 0
  for (const [label, ps] of cases) {
    for (const p of ps) {
      els.out.innerHTML = ''
      ctx.render(p)
      const h = els.out.innerHTML
      for (const probe of probes) if (h.includes(probe)) { console.log(`  ✗ ${lang}/${label}: "${probe}" 발견 — ${D.s.names[p[F.name]]}`); bad++ }
      if (lang === 'en' && banned.test(h)) { console.log(`  ✗ ${lang}/${label}: 금지어`); bad++ }
      if (h.length < 400) { console.log(`  ✗ ${lang}/${label}: 출력이 너무 짧다 (${h.length})`); bad++ }
      n++
    }
  }
  console.log(`  ${lang}: ${n}건 렌더 OK`)
}

// picker: 화면상 다른 행이 라벨 충돌로 숨으면 안 된다 (2026-08-28 에 1,108건이 숨어 있었다)
ctx.setLang('en')
const g = new Map()
for (const p of D.products) { const k = [p[F.fund], p[F.name], p[F.state]].join('|'); (g.get(k) ?? g.set(k, []).get(k)).push(p) }
const vis = (a, b) => [F.who, F.exP, F.exA, F.prem, F.pct].every(i => a[i] === b[i]) && JSON.stringify(a[F.hist]) === JSON.stringify(b[F.hist])
let hidden = 0
for (const rows of g.values()) {
  els.fund.value = rows[0][F.fund]; els.name.value = String(rows[0][F.name]); els.state.value = rows[0][F.state]
  ctx.refreshVariant()
  const shown = vm.runInContext('[...VARIANTS.values()]', ctx)
  for (const p of rows) if (!shown.some(q => vis(q, p))) hidden++
}
console.log(`  picker: 화면상 다른데 숨는 행 ${hidden}`)
if (hidden) bad++

// 해시 왕복: 인덱스 하나로 같은 상품이 다시 열리고, 언어를 바꿔도 유지된다
{
  const i = D.products.findIndex(p => p[F.sibWho] >= 0)
  ctx.location.hash = '#' + i
  els.fund.value = ''; els.out.innerHTML = ''
  ctx.fromHash()
  const ok1 = els.variant.value === String(i) && els.out.innerHTML.length > 400
  ctx.setLang('ko'); ctx.relabel()
  const ok2 = els.variant.value === String(i) && els.out.innerHTML.length > 400
  ctx.setLang('en')
  console.log(`  해시 왕복: ${ok1 && ok2 ? 'OK' : '실패'}`)
  if (!(ok1 && ok2)) bad++
  // 쓰레기 해시와 빈 해시는 조용히 무시한다 (빈 해시가 0번 상품을 열던 적이 있다)
  for (const h of ['#%', '', '#abc', '#1e3']) {
    ctx.location.hash = h; els.out.innerHTML = ''; els.fund.value = ''
    ctx.fromHash()
    if (els.out.innerHTML !== '') { console.log(`  ✗ 해시 "${h}" 가 렌더됐다`); bad++ }
  }
}

console.log(bad ? `\n실패 ${bad}건` : `\nOK — ${langs.length}개 언어 모든 분기 렌더 정상`)
process.exit(bad ? 1 : 0)
