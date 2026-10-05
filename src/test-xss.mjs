// 적대적인 값이 든 합성 index 로 app.js 를 돌려 본다. 상품명·기금명·URL·법인 문구는 파일에 있는
// 그대로 화면에 가므로, 그 자리에 HTML 이 오면 글자로 보여야지 태그로 살아나면 안 된다.
// 언어 코드와 해시도 입력값이다: 'constructor', '__proto__', 빈 해시가 어디로도 새지 않아야 한다.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'

// src/build.mjs 가 내는 열. site/app.js 의 F 와 같다.
export const F = { fund:0, name:1, state:2, who:3, exP:4, exA:5, tier:6, cover:7, type:8,
                   prem:9, pct:10, before:11, hist:12, corp:13, restr:14, corpTxt:15,
                   url:16, copay:17, accom:18, gap:19, amb:20, waiv:21, waits:22, sibWho:23, sibPrem:24 }
const WIDTH = Math.max(...Object.values(F)) + 1

// 자기 속성으로 '__proto__' 를 만든다. 객체 리터럴의 __proto__: 는 프로토타입을 바꿔 버린다.
const withProto = (o, v) => { Object.defineProperty(o, '__proto__', { value: v, enumerable: true, writable: true, configurable: true }); return o }
const pct = (b, a) => Math.round((a - b) / b * 100 * 100) / 100

// build.mjs 와 같은 모양의 index. 상승·하락·변동없음·비교불가·형제갈라짐·법인·제한·결합을 다 담는다.
export function syntheticIndex() {
  const names = ['Hostile <img src=x onerror=alert(1)>', 'Plain Policy', 'Peer Policy A', 'Peer Policy B', 'Corporate Policy',
                 'Combined Policy', 'constructor', 'Falling Policy', 'Flat Policy', 'New Policy', 'Split Policy', 'Restricted Policy', 'Big Rise Policy']
  const urls = ['javascript:alert(1)', 'https://example.com/ok', 'data:text/html,<script>alert(1)</script>', 'http://example.com/also-ok']
  const whos = ['2|0|', '1|1|', 'constructor|1|', '2|0|Child,Student', '__proto__|0|', '1|0|NonStudent']
  const covers = ['1111000011', '1100000000', '<svg onload=alert(1)>']
  const waivers = ['Dependents,Accidents', 'Accidents', 'constructor']
  const waits = ['{"SubAcute":"2m","PreExisting":"12m"}', '{"__proto__":"12m","Other":5,"PregnancyBirth":"12m"}', 'not json', '{"constructor":"2d"}']
  const corpText = ['<script>alert(1)</script>', 'Members of X Pty Ltd & their families only']
  const funds = withProto({ AAA: 'Safe Fund', BBB: 'Other Fund', MYO: 'Top Band Fund', ACA: 'Restricted Insurer', constructor: '"\'<>&' }, 'Proto Fund')

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
    meta: { built: '2026-04-06', rateRise: '2026-04-01', announcedAverage: 4.41, years: [2022, 2023, 2024, 2025, 2026],
            source: 'https://data.gov.au/data/dataset/8ab10b1f-6eac-423c-abc5-bbffc31b216c', publisher: 'Private Health Insurance Ombudsman',
            licence: 'CC BY 3.0 AU', snapshots: { before: '2026-03-01', after: '2026-04-05' } },
    stats: { hospital: stat(0), combined: stat(1) }, funds,
    s: { names, urls, whos, covers, waivers, waits, corpText },
    products,
  }
}

// smoke.mjs 와 같은 DOM 스텁. app.js 가 만지는 것만 있다.
export function makeDom({ D = null, site = 'site' } = {}) {
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
  if (D) { ctx.__J = D; vm.runInContext('D = __J; indexProducts()', ctx) }
  return { ctx, els, store }
}

// 합성 index 와 strings.js·app.js 를 한 디렉터리에 쓴다. smoke.mjs --site <dir> 용.
export function emitSite(dir, site = 'site') {
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${dir}/index.json`, JSON.stringify(syntheticIndex()))
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
  const { ctx, els, store } = makeDom({ D, site })
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

  // VARIANTS 는 모듈 변수다. window 에 아무것도 걸지 않는다.
  if (vm.runInContext('typeof VARIANTS', ctx) !== 'object') fail('VARIANTS 가 없다')
  if (/window\.__/.test(readFileSync(`${site}/app.js`, 'utf8'))) fail('app.js 에 window.__')

  console.log(bad ? `\n실패 ${bad}건` : '\ntest-xss OK')
  process.exit(bad ? 1 : 0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
