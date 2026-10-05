// 브라우저 없이 app.js 를 실제로 돌려 본다. 템플릿 문자열이 많고 열 번호가 하나만
// 어긋나도 화면에 undefined 가 찍힌다. 언어마다 전부 돌린다.
// --site <dir> 로 index.json·version.js·strings.js·app.js 를 다른 곳에서 읽는다 (픽스처·합성 index 로 돌릴 때).
import { readFileSync, existsSync } from 'node:fs'
import vm from 'node:vm'
import { checkStrings } from './strings-check.mjs'
import { F } from './columns.mjs'
import { makeDom } from './test-xss.mjs'

const args = process.argv.slice(2)
const site = args.includes('--site') ? args[args.indexOf('--site') + 1] : 'site'
const D = JSON.parse(readFileSync(`${site}/index.json`, 'utf8'))
if (!existsSync(`${site}/version.js`)) console.log(`  (${site}/version.js 가 없다 — npm run build 가 만든다; BUILD 없이 돌린다)`)
// 실제 로드 경로(applyIndex)로 넣는다. schema 가 다르면 stale 분기로 가므로 먼저 분명하게 알린다.
const SCHEMA = vm.runInNewContext(/\bconst SCHEMA = (\d+)/.exec(readFileSync(`${site}/app.js`, 'utf8'))?.[1] ?? 'NaN')
if (D.meta?.schema !== SCHEMA) { console.log(`index.json 의 meta.schema ${D.meta?.schema} ≠ app.js 의 SCHEMA ${SCHEMA} — 옛 빌드다. npm run build 를 다시 돌릴 것`); process.exit(1) }
const { ctx, els, reloads, session } = makeDom({ D, site })

// 키 집합·자리표시자·HTML 태그는 strings-check 가 영어와 대조한다. 어긋나면 실패로 세되 렌더는 계속해
// 나머지 결과도 보인다 (영어에 키·자리표시자를 더한 뒤 번역이 따라오기 전까지는 여기서 실패한다).
let bad = 0
try { checkStrings(ctx.STR) } catch (e) { console.log(`  ✗ ${e.message}`); bad++ }

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
const probes = ['undefined', 'NaN', '[object Object]', '&amp;amp;', '$null', '{', 'style=', 'Invalid Date']
// 모든 결과 문장(changed/unchanged/nomatch, tiers)에 날짜가 들어가므로 어느 분기든 인상 연도 숫자가 보여야 한다.
const riseYear = String(D.meta.riseYear)

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
      if (!h.includes(riseYear)) { console.log(`  ✗ ${lang}/${label}: 인상 연도 ${riseYear} 가 없다`); bad++ }
      n++
    }
  }
  // 고정 문구: 날짜 자리표시자와 푸터의 빌드 정보가 이 언어로 채워진다
  for (const [k, expr] of [['eyebrow', "t('eyebrow')"], ['meta_desc', "t('meta_desc')"], ['built_html', "t('built_html', builtVars())"], ['stale_html', "t('stale_html')"]]) {
    const v = vm.runInContext(expr, ctx)
    if (/[{}]|undefined|Invalid Date/.test(v)) { console.log(`  ✗ ${lang}/${k}: ${v}`); bad++ }
    // built_html 의 날짜는 빌드 시각이라 인상 연도와 무관하다 (1월에 재빌드하면 해가 다르다)
    if ((k === 'eyebrow' || k === 'meta_desc') && !v.includes(riseYear)) { console.log(`  ✗ ${lang}/${k}: 인상 연도 ${riseYear} 가 없다 — ${v}`); bad++ }
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

// stale 분기: schema 가 다른 index 를 새 컨텍스트에 넣으면 안내문을 그리고 한 번만 새로고침한다. 예외는 없어야 한다.
{
  const fresh = makeDom({ site })
  fresh.ctx.__S = { ...D, meta: { ...D.meta, schema: 999 } }
  let ok = true
  try { if (vm.runInContext('applyIndex(__S)', fresh.ctx) !== false) ok = false } catch (e) { console.log(`  ✗ stale: 예외 ${e.message}`); ok = false }
  try { vm.runInContext('applyIndex(__S)', fresh.ctx) } catch (e) { console.log(`  ✗ stale 2회: 예외 ${e.message}`); ok = false }
  const h = fresh.els.out.innerHTML
  if (!h.includes(fresh.ctx.STR.en.stale_html) || fresh.reloads.n !== 1 || /[{}]|undefined/.test(h)) ok = false
  if (reloads.n !== 0 || Object.keys(session).length) { console.log('  ✗ 정상 로드가 새로고침을 건드렸다'); ok = false }
  console.log(`  stale 분기: ${ok ? 'OK (안내문, 새로고침 1회)' : '실패'}`)
  if (!ok) bad++
}

console.log(bad ? `\n실패 ${bad}건` : `\nOK — ${langs.length}개 언어 모든 분기 렌더 정상`)
process.exit(bad ? 1 : 0)
