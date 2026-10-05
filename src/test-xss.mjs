// 적대적인 값이 든 합성 index 로 app.js 를 돌려 본다. 상품명·기금명·URL·법인 문구는 파일에 있는
// 그대로 화면에 가므로, 그 자리에 HTML 이 오면 글자로 보여야지 태그로 살아나면 안 된다.
// 언어 코드와 해시도 입력값이다: 'constructor', '__proto__', 빈 해시가 어디로도 새지 않아야 한다.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { F, WIDTH } from './columns.mjs'   // src/build.mjs 가 내는 열. site/app.js 의 F 와 같다 (test-unit 이 대조한다).

// src/build.mjs 의 SCHEMA 와 같은 값. 합성 index 는 이 값을 싣고, stale 분기는 999 를 넣어 본다.
export const SCHEMA = 2
// version.js 가 만드는 모양의 BUILD. makeDom({ build }) 로 app.js 보다 먼저 정의한다.
export const syntheticBuild = () => ({ v: 'abc123def456', built: '2026-04-06T01:02:03.000Z', schema: SCHEMA, riseYear: 2026, riseDate: '2026-04-01',
                                       before: '2026-03-01', after: '2026-04-05', years: [2022, 2023, 2024, 2025, 2026] })

// 자기 속성으로 '__proto__' 를 만든다. 객체 리터럴의 __proto__: 는 프로토타입을 바꿔 버린다.
const withProto = (o, v) => { Object.defineProperty(o, '__proto__', { value: v, enumerable: true, writable: true, configurable: true }); return o }
const pct = (b, a) => Math.round((a - b) / b * 100 * 100) / 100

// build.mjs 와 같은 모양의 index. 상승·하락·변동없음·비교불가·형제갈라짐·법인·제한·결합을 다 담는다.
export function syntheticIndex() {
  const names = ['Hostile <img src=x onerror=alert(1)>', 'Plain Policy', 'Peer Policy A', 'Peer Policy B', 'Corporate Policy',
                 'Combined Policy', 'constructor', 'Falling Policy', 'Flat Policy', 'New Policy', 'Split Policy', 'Restricted Policy', 'Big Rise Policy',
                 'Members Only Policy']
  const urls = ['javascript:alert(1)', 'https://example.com/ok', 'data:text/html,<script>alert(1)</script>', 'http://example.com/also-ok']
  const whos = ['2|0|', '1|1|', 'constructor|1|', '2|0|Child,Student', '__proto__|0|', '1|0|NonStudent']
  const covers = ['1111000011', '1100000000', '<svg onload=alert(1)>']
  const waivers = ['Dependents,Accidents', 'Accidents', 'constructor']
  const waits = ['{"SubAcute":"2m","PreExisting":"12m"}', '{"__proto__":"12m","Other":5,"PregnancyBirth":"12m"}', 'not json', '{"constructor":"2d"}']
  const corpText = ['<script>alert(1)</script>', 'Members of X Pty Ltd & their families only']
  const funds = withProto({ AAA: 'Safe Fund', BBB: 'Other Fund', MYO: 'Top Band Fund', ACA: 'Restricted Insurer', NHB: 'Members Only Fund', constructor: '"\'<>&' }, 'Proto Fund')

  // [fund, name, state, who, exP, exA, tier, cover, type, prem, pct, before, hist, corp, restr, corpTxt, url, copay, accom, gap, amb, waiv, waits, sibWho, sibPrem]
  const row = (o) => {
    const r = [o.fund, o.name, o.state ?? 'NSW', o.who ?? 0, o.exP ?? 500, o.exA ?? 0, o.tier ?? 'Gold', o.cover ?? 0, o.type ?? 0,
      o.prem, o.before == null ? null : pct(o.before, o.prem), o.before ?? null,
      o.hist ?? [150.5, 160, 170.25, o.before ?? null, o.prem], o.corp ?? 0, o.restr ?? 0, o.corpTxt ?? -1,
      o.url ?? -1, o.copay ?? 'None', o.accom ?? 'PrivateOrPublic', o.gap ?? 1, o.amb ?? 'EmergencyOnly', o.waiv ?? 0, o.waits ?? 0,
      o.sibWho ?? -1, o.sibPrem ?? null]
    if (r.length !== WIDTH) throw new Error('row width')
    return r
  }
  const products = [
    // 0: 적대적 상품. 기금 코드 'constructor', 커버 서명 'constructor|1|', 티어에 태그, javascript: URL, 잘못된 waits
    row({ fund: 'constructor', name: 0, who: 2, tier: '<b>Gold</b>', prem: 200, before: 184.33, hist: [150, null, 170, 184.33, 200], url: 0, waits: 1, cover: 2 }),
    // 1: 같은 커버의 동료 — https 링크는 살아야 한다
    row({ fund: 'AAA', name: 2, who: 2, prem: 190, before: 180, url: 1, waits: 0, cover: 2, waiv: 1 }),
    // 2: 기금 코드 '__proto__', data: URL 은 링크가 되면 안 된다
    row({ fund: '__proto__', name: 3, who: 2, prem: 210.1, before: 200, url: 2, waits: 2, cover: 2, copay: 'Limited', amb: null }),
    // 3: 법인 전용 동료 — 비교 표에서 빠진다
    row({ fund: 'BBB', name: 4, who: 2, prem: 150, before: 140, corp: 1, corpTxt: 0, cover: 2 }),
    // 4: 제한 보험사 동료 — 빠진다
    row({ fund: 'ACA', name: 11, who: 2, prem: 100, before: 95, restr: 1, cover: 2 }),
    // 5: http 링크 동료
    row({ fund: 'BBB', name: 1, who: 2, prem: 205, before: 190, url: 3, waits: 3, cover: 2, waiv: 2 }),
    // 6: 하락
    row({ fund: 'AAA', name: 7, who: 0, prem: 180, before: 190, hist: [null, null, 185, 190, 180] }),
    // 7: 변동 없음
    row({ fund: 'AAA', name: 8, who: 1, prem: 120, before: 120, hist: [100, 105, 110, 120, 120] }),
    // 8: 3월 값 없음
    row({ fund: 'BBB', name: 9, who: 3, prem: 300, hist: [null, null, null, null, 300], exP: 750, exA: 0 }),
    // 9/10: 형제 갈라짐 — 같은 상품, 다른 가구, 4월에 더 싼 쪽
    row({ fund: 'BBB', name: 10, who: 3, prem: 400, before: 380, sibWho: 5, sibPrem: 360, state: 'VIC' }),
    row({ fund: 'BBB', name: 10, who: 5, prem: 360, before: 380, state: 'VIC' }),
    // 11: 법인, 상승률 있음, 평범한 법인 문구 (& 는 이스케이프돼야 한다)
    row({ fund: 'BBB', name: 4, who: 0, prem: 160, before: 150, corp: 1, corpTxt: 1, state: 'QLD' }),
    // 12: 제한 보험사, 상승률 있음
    row({ fund: 'ACA', name: 11, who: 0, prem: 130, before: 125, restr: 1, state: 'ALL' }),
    // 13: 최대 상승 (20% 초과 밴드)
    row({ fund: 'MYO', name: 12, who: 0, prem: 250, before: 200, tier: 'Basic', state: 'WA' }),
    // 14/15: 결합 상품, 같은 라벨로 두 상품코드 (listed_at 분기)
    row({ fund: 'AAA', name: 5, who: 0, prem: 500, before: 480, type: 1, cover: 1, state: 'SA', hist: [400, 420, 450, 480, 500] }),
    row({ fund: 'AAA', name: 5, who: 0, prem: 520, before: 480, type: 1, cover: 1, state: 'SA', hist: [400, 420, 450, 480, 520] }),
    // 16: 상품명 'constructor' (문자열 표 인덱스 6), 변동 없음, 결합
    row({ fund: 'BBB', name: 6, who: 1, prem: 90, before: 90, type: 1, cover: 1, state: 'TAS' }),
    // 17: 상품 플래그는 없지만 기금이 meta.restrictedFunds 에 있는 동료 — 비교 표에서 빠져야 한다
    row({ fund: 'NHB', name: 13, who: 2, prem: 170, before: 160, cover: 2 }),
  ]
  const stat = (type) => {
    const ds = products.filter(p => p[F.type] === type && p[F.pct] != null).map(p => p[F.pct])
    const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? Math.round((s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) * 100) / 100 : 0 }
    const band = (lo, hi) => ds.filter(d => d >= lo && d < hi).length
    const byTier = withProto({ Gold: [med(ds), ds.length], '<b>Gold</b>': [8.5, 1], Basic: [25, 1] }, [1, 1])
    return {
      open: products.filter(p => p[F.type] === type).length, priced: ds.length, median: med(ds),
      bands: [ds.filter(d => d < 0).length, band(0, 5), band(5, 10), band(10, 15), band(15, 20), ds.filter(d => d >= 20).length],
      byTier, pricedRetail: Math.max(1, ds.length - 2), medianRetail: med(ds), zero: ds.filter(d => d === 0).length,
      topBand: type === 0 ? { fund: 'MYO', n: 1, total: 1 } : null, split: type === 0 ? 1 : 0,
    }
  }
  return {
    // links.circular 는 javascript: — 링크 없이 글자만 남아야 한다. restrictedFunds 의 'constructor' 는 코드 모양이 아니라 걸러진다.
    meta: { built: '2026-04-06T01:02:03.000Z', version: 'abc123def456', schema: SCHEMA, rateRise: '2026-04-01', announcedAverage: 4.41, years: [2022, 2023, 2024, 2025, 2026],
            source: 'https://data.gov.au/data/dataset/8ab10b1f-6eac-423c-abc5-bbffc31b216c', publisher: 'Private Health Insurance Ombudsman',
            licence: 'CC BY 3.0 AU', snapshots: { before: '2026-03-01', after: '2026-04-05', beforeName: 'March 2026', afterName: 'April 2026' },
            riseYear: 2026, riseDate: '2026-04-01',
            links: { circular: 'javascript:alert(1)', perInsurer: 'https://www.health.gov.au/resources/publications/example' },
            restrictedFunds: ['ACA', 'NHB', 'constructor'] },
    stats: { hospital: stat(0), combined: stat(1) }, funds,
    s: { names, urls, whos, covers, waivers, waits, corpText },
    products,
  }
}

// smoke.mjs 도 쓰는 DOM 스텁. app.js 가 만지는 것만 있다. version.js 는 build 를 주면 그 값으로, 아니면 site 에 있을 때 읽어 BUILD 를 정의한다.
// fetch 는 호출만 기록하고 끝나지 않는다. index 는 실제 로드 경로와 같은 applyIndex() 로 넣는다.
export function makeDom({ D = null, site = 'site', build = undefined } = {}) {
  const els = {}
  const mk = (id) => ({ id, innerHTML: '', textContent: '', value: '', disabled: false, onchange: null, dataset: {}, content: '' })
  const el = (id) => (els[id] ??= mk(id))
  for (const id of ['out', 'fund', 'name', 'state', 'variant', 'snapbefore', 'snapafter', 'lang', 'theme', 'theme-system', 'theme-light', 'theme-dark']) el(id)
  const store = {}, session = {}, fetched = [], reloads = { n: 0 }
  const ctx = vm.createContext({
    document: { getElementById: el, querySelectorAll: () => [], querySelector: () => null, documentElement: { dataset: {}, lang: '' }, title: '' },
    location: { hash: '', search: '', reload: () => { reloads.n++ } },
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v }, removeItem: k => { delete store[k] } },
    sessionStorage: { getItem: k => session[k] ?? null, setItem: (k, v) => { session[k] = v }, removeItem: k => { delete session[k] } },
    navigator: { language: 'en-AU' },
    fetch: (u, o) => { fetched.push([u, o]); return new Promise(() => {}) },
    URL, URLSearchParams,
    console,
  })
  vm.runInContext(readFileSync(`${site}/strings.js`, 'utf8'), ctx)
  if (build !== undefined) { ctx.__B = build; vm.runInContext('var BUILD = __B', ctx) }
  else if (existsSync(`${site}/version.js`)) vm.runInContext(readFileSync(`${site}/version.js`, 'utf8'), ctx)
  vm.runInContext(readFileSync(`${site}/app.js`, 'utf8'), ctx)
  if (D) { ctx.__J = D; vm.runInContext('applyIndex(__J)', ctx) }
  return { ctx, els, store, session, fetched, reloads }
}

// 합성 index 와 strings.js·app.js 를 한 디렉터리에 쓴다. smoke.mjs --site <dir> 용.
export function emitSite(dir, site = 'site') {
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${dir}/index.json`, JSON.stringify(syntheticIndex()))
  writeFileSync(`${dir}/version.js`, `var BUILD = ${JSON.stringify(syntheticBuild())}\n`)
  for (const f of ['strings.js', 'app.js', 'index.html']) copyFileSync(`${site}/${f}`, `${dir}/${f}`)
  return dir
}

function main() {
  const args = process.argv.slice(2)
  const site = args.includes('--site') ? args[args.indexOf('--site') + 1] : 'site'
  if (args.includes('--emit')) { console.log(emitSite(args[args.indexOf('--emit') + 1], site)); return }

  // JSON 왕복: 실제 index.json 처럼 파싱된 객체로 돌린다 (own '__proto__' 키가 그대로 살아 있어야 한다).
  const D = JSON.parse(JSON.stringify(syntheticIndex()))
  if (!Object.hasOwn(D.funds, '__proto__')) throw new Error('fixture: funds.__proto__ 가 자기 속성이 아니다')
  const { ctx, els, store, fetched } = makeDom({ D, site, build: syntheticBuild() })
  let bad = 0
  const fail = (msg) => { console.log('  ✗ ' + msg); bad++ }
  const mustHave = (h, s, why) => { if (!h.includes(s)) fail(`${why}: "${s}" 가 없다`) }
  const mustNot = (h, s, why) => { if (h.includes(s)) fail(`${why}: "${s}" 가 있다`) }
  const NEVER = ['<img', '<script', 'javascript:', 'function Object', 'function Array', '[object Object]', 'undefined', 'NaN', '<b>', '<svg onload', 'data:text/html']

  // 상품 선택 → render. 해시 경로와 같은 함수를 직접 밟는다.
  const open = (i) => {
    const p = D.products[i]
    els.fund.value = p[F.fund]; ctx.refreshName()
    els.name.value = String(p[F.name]); ctx.refreshState()
    els.state.value = p[F.state]; ctx.refreshVariant()
    els.variant.value = String(i); ctx.render(p)
    return els.out.innerHTML
  }

  ctx.setLang('en')
  ctx.fillFunds()
  mustHave(els.fund.innerHTML, '&quot;&#39;&lt;&gt;&amp;', 'fund picker: 기금명 이스케이프')
  mustHave(els.fund.innerHTML, 'Proto Fund', 'fund picker: __proto__ 키의 기금명')
  for (const s of NEVER) mustNot(els.fund.innerHTML, s, 'fund picker')

  // 0: 적대적 상품
  {
    const h = open(0)
    mustHave(h, '&lt;img src=x onerror=alert(1)&gt;', '상품명 이스케이프')
    mustHave(h, '&quot;&#39;&lt;&gt;&amp;', '기금명 이스케이프 (constructor 키)')
    mustHave(h, '&lt;b&gt;Gold&lt;/b&gt;', '티어 이스케이프')
    mustHave(h, '<a href="https://example.com/ok" rel="nofollow noopener">', 'https 링크는 산다')
    mustHave(h, '<a href="http://example.com/also-ok" rel="nofollow noopener">', 'http 링크는 산다')
    mustHave(h, 'Peer Policy B', 'data: URL 상품은 이름만')
    mustNot(h, 'href="data:', 'data: URL 은 링크가 아니다')
    mustHave(h, 'Proto Fund', '__proto__ 기금명')
    mustNot(h, 'Corporate Policy', '법인 전용은 비교 표에서 빠진다')
    mustNot(h, 'Restricted Policy', '제한 보험사는 비교 표에서 빠진다')
    mustNot(h, 'Members Only Policy', 'meta.restrictedFunds 의 기금은 상품 플래그가 없어도 비교 표에서 빠진다')
    // meta.links: javascript: 회람 링크는 <a> 없이 글자만, https 보험사별 링크는 산다
    mustHave(h, 'The Government approved an industry-wide average of 4.41% for 1 April 2026', 'circular 링크 없이 문장은 온전하다')
    mustNot(h, '<a href="javascript', 'javascript: 회람 링크는 <a> 가 아니다')
    mustHave(h, '<a href="https://www.health.gov.au/resources/publications/example" rel="nofollow noopener">each insurer separately</a>', 'perInsurer https 링크')
    // 날짜 자리표시자가 영어 문장에 채워진다
    mustHave(h, 'a month on 1 April 2026.', 'changed_html 의 {rise_date}')
    mustHave(h, 'By tier as classified in the 5 April 2026 file', 'tiers_html 의 {after_date}')
    mustHave(h, 'Pre-existing', 'waits: 정상 키')
    mustHave(h, '12 months', 'waits: 정상 값')
    mustHave(h, 'class="first"', 'section 클래스')
    mustHave(h, '<rect width="', '분포 막대는 SVG rect')
    mustNot(h, 'style=', 'inline style 없음')
    for (const s of NEVER) mustNot(h, s, '상품 0')
    if (!/<rect width="\d+(\.\d+)?%" height="100%"/.test(h)) fail('막대 폭이 숫자 % 가 아니다')
  }
  // 11: 평범한 법인 문구는 이스케이프만 거친다
  {
    const h = open(11)
    mustHave(h, 'Members of X Pty Ltd &amp; their families only', 'corpText 이스케이프')
  }
  // 0 의 법인 동료(3)는 script 태그 corpText 를 가진다
  {
    const h = open(3)
    mustHave(h, '&lt;script&gt;alert(1)&lt;/script&gt;', 'corpText 이스케이프')
    for (const s of NEVER) mustNot(h, s, '상품 3')
  }
  // 모든 상품 × 모든 언어: 예외 없이 그려지고 금지 문자열이 없다
  let n = 0
  for (const lang of Object.keys(ctx.STR)) {
    ctx.setLang(lang)
    for (let i = 0; i < D.products.length; i++) {
      let h
      try { h = open(i) } catch (e) { fail(`${lang}/상품 ${i}: 예외 ${e.message}`); continue }
      for (const s of NEVER) mustNot(h, s, `${lang}/상품 ${i}`)
      if (h.length < 400) fail(`${lang}/상품 ${i}: 출력이 너무 짧다`)
      n++
    }
  }
  ctx.setLang('en')
  console.log(`  렌더 ${n}건, 금지 문자열 없음`)

  // 날짜·빌드 정보: 영어와 한국어의 Intl 출력, 비교불가 분기의 {before_date}, 푸터 built_html
  {
    const en = vm.runInContext('dates()', ctx)
    if (en.rise_date !== '1 April 2026' || en.before_date !== '1 March 2026' || en.after_date !== '5 April 2026' || en.rise_year !== '2026') fail(`dates() en: ${JSON.stringify(en)}`)
    mustHave(open(8), 'not in the 1 March 2026 list', 'nomatch_html 의 {before_date}')
    ctx.setLang('ko')
    const ko = vm.runInContext('dates()', ctx)
    if (ko.rise_date !== '2026년 4월 1일' || ko.after_date !== '2026년 4월 5일') fail(`dates() ko: ${JSON.stringify(ko)}`)
    ctx.setLang('en')
    const bv = vm.runInContext('builtVars()', ctx)
    if (bv.v !== 'abc123def456' || !/2026/.test(bv.built) || !/AE[DS]T|GMT|UTC/.test(bv.built)) fail(`builtVars(): ${JSON.stringify(bv)}`)
    const footer = vm.runInContext("t('built_html', builtVars())", ctx)
    if (/[{}]|undefined|Invalid Date/.test(footer)) fail(`built_html: ${footer}`)
    if (!fetched.length || fetched[0][0] !== 'index.json?v=abc123def456' || fetched[0][1]?.cache !== 'no-cache') fail(`fetch URL: ${JSON.stringify(fetched[0])}`)
    if (/[{}]|undefined/.test(vm.runInContext("t('stale_html')", ctx))) fail('stale_html')
  }
  // index.json 이 오기 전: version.js 의 값으로 날짜·푸터를 그리고, 적대적인 BUILD 는 이스케이프된다
  {
    const { ctx: c2, fetched: f2 } = makeDom({ site, build: syntheticBuild() })
    const d2 = vm.runInContext('dates()', c2)
    if (d2.rise_date !== '1 April 2026' || d2.before_date !== '1 March 2026') fail(`dates() from BUILD: ${JSON.stringify(d2)}`)
    if (!/1 April 2026/.test(vm.runInContext("t('eyebrow')", c2))) fail('eyebrow from BUILD')
    if (vm.runInContext('builtVars()', c2).v !== 'abc123def456') fail('builtVars() from BUILD')
    if (f2[0][0] !== 'index.json?v=abc123def456') fail(`fetch URL from BUILD: ${f2[0][0]}`)
    const { ctx: c3, fetched: f3 } = makeDom({ site, build: { v: '<script>&"', built: 'garbage', riseDate: '<b>x</b>', before: 20260301, after: null, riseYear: '2026' } })
    const d3 = vm.runInContext('dates()', c3)
    // HTML 특수문자가 든 날짜는 버려지고(_html 문구에 그대로 들어가므로), ISO 가 아닌 무해한 원문은 그대로 보인다
    if (d3.rise_date !== '' || d3.before_date !== '' || d3.after_date !== '' || d3.rise_year !== '') fail(`dates() hostile BUILD: ${JSON.stringify(d3)}`)
    if (/<b>/.test(vm.runInContext("t('avg_html', { approved: 'x', avg: '1' })", c3))) fail('hostile riseDate reached an _html string')
    if (vm.runInContext('dates().rise_date', makeDom({ site, build: { riseDate: '2026-04' } }).ctx) !== '2026-04') fail('non-ISO date without HTML chars should pass through')
    const b3 = vm.runInContext("t('built_html', builtVars())", c3)
    if (/<script|"|Invalid Date|undefined/.test(b3) || !b3.includes('&lt;script&gt;&amp;&quot;') || !b3.includes('garbage')) fail(`built_html hostile BUILD: ${b3}`)
    if (f3[0][0] !== 'index.json?v=' + encodeURIComponent('<script>&"')) fail(`fetch URL hostile BUILD: ${f3[0][0]}`)
    const { ctx: c4 } = makeDom({ site, build: null })
    const d4 = vm.runInContext('dates()', c4)
    if (d4.rise_date !== '' || d4.rise_year !== '') fail(`dates() without BUILD: ${JSON.stringify(d4)}`)
    if (/[{}]|undefined/.test(vm.runInContext("t('eyebrow') + t('built_html', builtVars())", c4))) fail('eyebrow/built_html without BUILD')
  }
  // stale: meta.schema 가 다르면 안내문을 그리고 한 번만 새로고침한다. 예외는 없다.
  {
    const { ctx: c5, els: e5, reloads, session } = makeDom({ site, build: syntheticBuild() })
    c5.__S = { ...D, meta: { ...D.meta, schema: 999 } }
    let r
    try { r = vm.runInContext('applyIndex(__S)', c5) } catch (e) { fail(`stale: 예외 ${e.message}`) }
    if (r !== false) fail('stale: applyIndex 가 false 가 아니다')
    if (!e5.out.innerHTML.includes(c5.STR.en.stale_html)) fail(`stale: 안내문 없음 — ${e5.out.innerHTML}`)
    if (reloads.n !== 1) fail(`stale: reload ${reloads.n}번`)
    if (session['reloaded-abc123def456'] !== '1') fail('stale: sessionStorage 가드')
    if (vm.runInContext('D', c5) !== null) fail('stale: D 가 대입됐다')
    try { vm.runInContext('applyIndex(__S)', c5) } catch (e) { fail(`stale 2회: 예외 ${e.message}`) }
    if (reloads.n !== 1) fail(`stale: 두 번째에도 reload (${reloads.n})`)
    if (!e5.out.innerHTML.includes(c5.STR.en.stale_html)) fail('stale: 두 번째 안내문 없음')
    for (const badIdx of [null, {}, { ...D, meta: null }, { ...D, products: {} }]) {
      c5.__S = badIdx
      try { vm.runInContext('applyIndex(__S)', c5); fail('bad index 가 통과했다') } catch (e) { if (!/bad index/.test(e.message)) fail(`bad index: ${e.message}`) }
    }
    console.log('  stale/BUILD 분기 OK')
  }

  // t(): 치환된 값 안의 {x} 는 다시 치환되지 않는다
  {
    const r = vm.runInContext(`t('listed_at', { label: '{m}', m: '$1' })`, ctx)
    if (r !== '{m} — listed at $1') fail(`t() 재치환: ${r}`)
    const r2 = vm.runInContext(`t('listed_at', { label: 'x' })`, ctx)
    if (r2 !== 'x — listed at {m}') fail(`t() 빠진 변수: ${r2}`)
    if (vm.runInContext(`t('no_such_key')`, ctx) !== 'no_such_key') fail('t() 모르는 키')
    if (vm.runInContext(`esc("<a href='x'>&\\"")`, ctx) !== '&lt;a href=&#39;x&#39;&gt;&amp;&quot;') fail('esc()')
    for (const [expr, want] of [[`num('abc')`, '—'], [`num(null)`, '—'], [`money(undefined)`, null], [`money('x')`, '—'], [`pctStr(NaN)`, '—'], [`pctStr(2)`, '+2.00%'], [`num(1234)`, '1,234']]) {
      const got = vm.runInContext(expr, ctx); if (got !== want) fail(`${expr} → ${got}`)
    }
  }

  // 언어 가드
  for (const q of ['__proto__', 'constructor', 'toString', 'KO', 'en-US', 'xx', '']) {
    ctx.location.search = '?lang=' + q
    const l = ctx.pickLang()
    if (l !== 'en') fail(`?lang=${q} → ${l}`)
  }
  ctx.location.search = '?lang=ko'
  if (ctx.pickLang() !== 'ko') fail('?lang=ko')
  ctx.location.search = ''
  store.lang = 'constructor'
  if (ctx.pickLang() !== 'en') fail('localStorage lang=constructor')
  ctx.setLang(ctx.pickLang())
  if (store.lang !== 'en') fail(`setLang 이 저장한 값: ${store.lang}`)
  for (const q of ['__proto__', 'constructor', 'toString', 'KO', 'xx']) {
    ctx.setLang(q)
    const dl = ctx.document.documentElement.lang
    if (dl === 'undefined' || dl === undefined || dl === '') fail(`setLang(${q}) → documentElement.lang=${dl}`)
    if (store.lang !== 'en') fail(`setLang(${q}) 이 ${store.lang} 을 저장했다`)
  }
  ctx.navigator.language = 'ko-KR'; store.lang = 'toString'; ctx.location.search = ''
  if (ctx.pickLang() !== 'ko') fail('navigator.language → ko')
  ctx.navigator.language = '__proto__'; delete store.lang
  if (ctx.pickLang() !== 'en') fail('navigator.language=__proto__')
  ctx.navigator.language = 'en-AU'
  ctx.setLang('en')
  mustHave(els.lang.innerHTML, '<option value="ko">한국어</option>', '언어 옵션')
  mustNot(els.lang.innerHTML, 'undefined', '언어 옵션')
  console.log('  언어 가드 OK')

  // 해시 가드
  const tryHash = (h, want) => {
    ctx.location.hash = h
    els.out.innerHTML = ''; els.fund.value = ''; els.variant.value = ''
    ctx.fromHash()
    const got = els.out.innerHTML.length > 400
    if (got !== want) fail(`hash "${h}": ${got ? '렌더됨' : '렌더 안 됨'}`)
    if (want && els.variant.value !== h.slice(1)) fail(`hash "${h}": variant=${els.variant.value}`)
  }
  tryHash('', false)
  tryHash('#', false)
  tryHash('#0', true)
  tryHash('#6', true)
  tryHash('#abc', false)
  tryHash('#%', false)
  tryHash('#1e3', false)
  tryHash('#-1', false)
  tryHash('#99999', false)
  tryHash('#12345678', false)
  tryHash('#constructor', false)
  tryHash('#__proto__', false)
  console.log('  해시 가드 OK')

  // VARIANTS 는 모듈 변수다. window 에 아무것도 걸지 않는다. RESTRICTED 는 meta 에서 온 코드만 담는다.
  if (vm.runInContext('typeof VARIANTS', ctx) !== 'object') fail('VARIANTS 가 없다')
  if (vm.runInContext('[...RESTRICTED].join()', ctx) !== 'ACA,NHB') fail(`RESTRICTED: ${vm.runInContext('[...RESTRICTED].join()', ctx)}`)
  if (vm.runInContext('SCHEMA', ctx) !== SCHEMA) fail('app.js SCHEMA ≠ test-xss SCHEMA')
  if (/window\.__/.test(readFileSync(`${site}/app.js`, 'utf8'))) fail('app.js 에 window.__')

  console.log(bad ? `\n실패 ${bad}건` : '\ntest-xss OK')
  process.exit(bad ? 1 : 0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
