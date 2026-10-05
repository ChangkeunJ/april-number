// 열 순서는 src/build.mjs 와 함께 움직인다.
const F = { fund:0, name:1, state:2, who:3, exP:4, exA:5, tier:6, cover:7, type:8,
            prem:9, pct:10, before:11, hist:12, corp:13, restr:14, corpTxt:15,
            url:16, copay:17, accom:18, gap:19, amb:20, waiv:21, waits:22, sibWho:23, sibPrem:24 }

// index.json 의 레이아웃 버전. src/build.mjs 의 SCHEMA 와 같아야 한다.
// 캐시된 app.js 와 새 index.json(또는 그 반대)이 만나면 meta.schema 가 달라 한 번 새로고침한다.
const SCHEMA = 2
// version.js 가 정의하는 빌드 정보(v, built, riseDate, before, after …). 없으면 빈 객체 — index.json 이 오면 meta 로 채운다.
const B = (typeof BUILD === 'object' && BUILD) ? BUILD : {}

let D = null
let BY = null   // fund|name|state → [index]. picker 를 열 때마다 55,678행을 훑지 않는다.
let VARIANTS = new Map()   // variant 옵션 값(인덱스 문자열) → 상품 행
// privatehealth.gov.au/dynamic/insurer/restricted — 가입 자격이 있어야 드는 곳들. 상품 단위
// Corporate/OnlyAvailableWith 와는 별개라 따로 걸러야 한다. 집합은 rise.json → meta.restrictedFunds 에서 온다.
let RESTRICTED = new Set()
const restrictedSet = (meta) => new Set((meta && Array.isArray(meta.restrictedFunds) ? meta.restrictedFunds : [])
  .filter(c => typeof c === 'string' && /^[A-Z]{3}$/.test(c)))
function indexProducts() {
  BY = new Map()
  D.products.forEach((p, i) => { const k = p[F.fund] + '|' + p[F.name] + '|' + p[F.state]; let a = BY.get(k); if (!a) BY.set(k, a = []); a.push(i) })
}
const $ = (id) => document.getElementById(id)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
// 데이터나 입력값을 키로 쓰는 조회는 자기 속성만 본다. 'constructor' 같은 키가 프로토타입을 타지 않게.
const own = (o, k) => (o != null && Object.hasOwn(o, k)) ? o[k] : undefined
// 데이터에서 온 URL 은 http(s) 만 링크로 만든다.
const safeHref = (u) => { try { const url = new URL(u); return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : null } catch { return null } }

// ---- 언어 ----
// 우선순위: ?lang= → 저장값 → 브라우저 언어 → en. 값이 없는 키는 영어로 떨어진다.
let LANG = 'en'
// 언어 코드는 두 글자 소문자이고 STR 의 자기 속성이어야 한다. 그 외의 값은 저장하지도 lang 에 쓰지도 않는다.
const okLang = (q) => typeof q === 'string' && /^[a-z]{2}$/.test(q) && Object.hasOwn(STR, q) && typeof STR[q]?._locale === 'string'
const t = (k, vars) => {
  let s = own(STR[LANG], k) ?? own(STR.en, k)
  if (s == null) return k
  // 한 번에 치환한다. 치환된 값 안의 {x} 가 다시 치환되면 안 된다. 날짜 자리표시자는 항상 채우고, vars 가 우선한다.
  if (typeof s === 'string' && s.includes('{')) {
    const v = Object.assign(dates(), vars)
    s = s.replace(/\{(\w+)\}/g, (m, key) => Object.hasOwn(v, key) ? String(v[key]) : m)
  }
  return s
}
// 부처 회람·보험사별 승인 평균 링크. rise.json → meta.links. http(s) 가 아니거나 없으면 글자만 둔다.
const linkHtml = (name, text) => {
  const href = safeHref(D && D.meta && D.meta.links ? own(D.meta.links, name) : null)
  return href ? `<a href="${esc(href)}" rel="nofollow noopener">${esc(text)}</a>` : esc(text)
}

// ---- 날짜 ----
// 문구의 {rise_date} {before_date} {after_date} {rise_year}. index.json 이 오기 전엔 version.js(B)의 값으로,
// 온 뒤엔 meta 로 그린다. 월 이름은 언어의 로캘이 정한다. 값이 없거나 이상하면 원문 그대로 또는 빈 문자열 — 'Invalid Date' 는 안 된다.
// 원문은 _html 문구에도 그대로 들어가므로 HTML 특수문자가 있으면 버린다 (Intl 출력에는 없다).
const fmtDate = (iso) => {
  if (typeof iso !== 'string' || /[&<>"']/.test(iso)) return ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const d = new Date(iso + 'T00:00:00Z')
  if (Number.isNaN(d.getTime())) return iso
  try { return new Intl.DateTimeFormat(STR[LANG]._locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d) } catch { return iso }
}
let DATES = null, DATES_KEY = ''   // 같은 언어·같은 값이면 다시 포맷하지 않는다 (t() 는 렌더마다 수백 번 불린다)
function dates() {
  const fromMeta = !!(D && D.meta)
  const m = fromMeta ? D.meta : B
  const snap = fromMeta ? (m.snapshots && typeof m.snapshots === 'object' ? m.snapshots : {}) : m
  const key = [LANG, m.riseDate, snap.before, snap.after, m.riseYear].map(String).join('|')
  if (DATES && key === DATES_KEY) return Object.assign({}, DATES)
  DATES = { rise_date: fmtDate(m.riseDate), before_date: fmtDate(snap.before), after_date: fmtDate(snap.after),
            rise_year: Number.isInteger(m.riseYear) ? String(m.riseYear) : '' }
  DATES_KEY = key
  return Object.assign({}, DATES)
}
// 푸터의 빌드 시각과 버전. index.json 이 오기 전엔 version.js 값으로. Intl 출력이거나 esc() 를 거친 값만 돌려준다.
function builtVars() {
  const m = (D && D.meta) ? D.meta : B
  const raw = typeof m.built === 'string' ? m.built : ''
  const d = raw ? new Date(raw) : null
  let built = esc(raw)
  if (d && !Number.isNaN(d.getTime())) {
    try {
      built = esc(new Intl.DateTimeFormat(STR[LANG]._locale, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney', timeZoneName: 'short' }).format(d))
    } catch {}
  }
  const v = typeof m.version === 'string' ? m.version : (typeof m.v === 'string' ? m.v : '')
  return { built, v: esc(v) }
}
// 데이터 열거값(XSD 고정값)의 표시명. 표에 없는 값은 원문 그대로.
const tv = (prefix, v) => own(STR[LANG], prefix + v) ?? own(STR.en, prefix + v) ?? v
// 숫자 표시. 숫자가 아니거나 비어 있으면 — 로 둔다 (Number(null) 은 0 이라 따로 거른다). 화면에 NaN 이나 undefined 가 찍히면 안 된다.
const toNum = (v) => (v == null || v === '') ? NaN : Number(v)
const num = (n) => { n = toNum(n); return Number.isFinite(n) ? n.toLocaleString(STR[LANG]?._locale ?? 'en-AU') : '—' }
const money = (n) => { if (n == null) return null; n = Number(n); return Number.isFinite(n) ? '$' + n.toFixed(2) : '—' }
const pctStr = (n) => { n = toNum(n); return Number.isFinite(n) ? (n > 0 ? '+' : '') + n.toFixed(2) + '%' : '—' }
const dec = (n) => { n = toNum(n); return Number.isFinite(n) ? String(n) : '—' }   // 중앙값·발표 평균처럼 그대로 보여 주는 소수
const fin = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : null   // 데이터의 숫자 칸. 숫자가 아니면 없는 값으로 본다

// 언어 목록은 strings.js 가 정한다. (index.html 의 인라인 스크립트였다 — CSP 때문에 여기로.)
function fillLangs() {
  $('lang').innerHTML = Object.keys(STR).filter(okLang).map(k => `<option value="${esc(k)}">${esc(STR[k]._name ?? k)}</option>`).join('')
}
function pickLang() {
  const q = new URLSearchParams(location.search).get('lang')
  if (okLang(q)) return q
  try { const s = localStorage.getItem('lang'); if (okLang(s)) return s } catch {}
  const nav = String(navigator.language || 'en').slice(0, 2)
  return okLang(nav) ? nav : 'en'
}
function showSnapshots() {
  const s = (D && D.meta && D.meta.snapshots) || {}
  const b = $('snapbefore'), a = $('snapafter')
  if (b) b.textContent = String(s.before ?? '')
  if (a) a.textContent = String(s.after ?? '')
}
// 고정 문구(제목·설명·data-t·data-t-html·푸터). 언어를 바꿀 때와 index.json 이 온 뒤(날짜·빌드 정보가 meta 로 바뀐다) 다시 그린다.
function fillStatic() {
  document.title = t('title')
  const m = document.querySelector('meta[name="description"]'); if (m) m.content = t('meta_desc')
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t)
  const bv = builtVars()
  for (const el of document.querySelectorAll('[data-t-html]')) el.innerHTML = t(el.dataset.tHtml, bv)
  if (D) showSnapshots()
}
function setLang(l) {
  LANG = okLang(l) ? l : 'en'
  try { localStorage.setItem('lang', LANG) } catch {}
  document.documentElement.lang = STR[LANG]._locale
  fillStatic()
  for (const [id, k] of [['theme-system', 'theme_system'], ['theme-light', 'theme_light'], ['theme-dark', 'theme_dark']]) { const o = $(id); if (o) o.textContent = t(k) }
  $('lang').value = LANG
}

// ---- 테마 ----
// 저장값이 없으면 data-theme 을 두지 않아 OS 설정을 따른다.
function setTheme(v) {
  if (v === 'light' || v === 'dark') document.documentElement.dataset.theme = v
  else delete document.documentElement.dataset.theme
  try { v === 'light' || v === 'dark' ? localStorage.setItem('theme', v) : localStorage.removeItem('theme') } catch {}
  $('theme').value = v === 'light' || v === 'dark' ? v : 'system'
}

// 누가 커버되는지의 서명은 "성인수|1인전용|부양가족종류" 다. 사람이 읽을 이름으로 바꾸되
// 펀드가 쓰는 마케팅 명칭을 지어내지 않는다. 부양가족 종류는 그대로 덧붙인다.
function whoLabel(sig) {
  const [adults, only, deps] = String(sig ?? '').split('|')
  const d = deps ? deps.split(',') : []
  let base
  if (only === '1') base = t('who_single')
  else if (adults === '2') base = d.length ? t('who_family') : t('who_couple')
  else if (adults === '1') base = d.length ? t('who_single_parent') : t('who_single')
  else if (adults === '0') base = t('who_dependants_only')
  else base = t('who_single')
  return d.length ? `${base} (${d.map(x => tv('dep_', x)).join(', ')})` : base
}
const excessLabel = (p) => {
  const bits = []
  if (p[F.exP]) bits.push(t('excess_person', { n: p[F.exP] }))
  if (p[F.exA]) bits.push(t('excess_admission', { n: p[F.exA] }))
  return bits.length ? bits.join(', ') : t('no_excess')
}
const variantLabel = (p) => `${whoLabel(own(D.s.whos, p[F.who]))} — ${excessLabel(p)}`
const nameOf = (p) => String(own(D.s.names, p[F.name]) ?? '')
const fundOf = (code) => String(own(D.funds, code) ?? code)

const fill = (sel, opts, placeholder) => {
  const keep = sel.value
  sel.innerHTML = `<option value="">${esc(placeholder)}</option>` +
    opts.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('')
  sel.disabled = opts.length === 0
  if (opts.some(([v]) => String(v) === keep)) sel.value = keep
}

function fillFunds() {
  const funds = [...new Set(D.products.map(p => p[F.fund]))]
    .map(c => [c, fundOf(c)]).sort((a, b) => a[1].localeCompare(b[1]))
  fill($('fund'), funds, t('ph_fund'))
}
function refreshName() {
  const f = $('fund').value
  const names = [...new Set(D.products.filter(p => p[F.fund] === f).map(p => p[F.name]))]
    .map(i => [i, String(own(D.s.names, i) ?? '')]).sort((a, b) => a[1].localeCompare(b[1]))
  fill($('name'), names, names.length ? t('ph_name') : '—')
  fill($('state'), [], '—'); fill($('variant'), [], '—'); render(null)
}
function refreshState() {
  const f = $('fund').value, n = Number($('name').value)
  const states = [...new Set(D.products.filter(p => p[F.fund] === f && p[F.name] === n).map(p => p[F.state]))].sort()
  fill($('state'), states.map(s => [s, s === 'ALL' ? t('all_states') : s]), t('ph_state'))
  if (states.length === 1) { $('state').value = states[0]; refreshVariant(); return }
  fill($('variant'), [], '—'); render(null)
}
// 옵션 값은 D.products 의 인덱스다. 라벨은 언어마다 달라지지만 인덱스는 그대로라 해시가 언어를 안 탄다.
function refreshVariant() {
  const f = $('fund').value, n = Number($('name').value), st = $('state').value
  const rows = (BY.get(f + '|' + n + '|' + st) ?? []).map(i => [D.products[i], i])
  // 같은 라벨(가구·본인부담금)로 두 상품코드가 올라온 묶음이 534개 있다. 가격이 다르면
  // 가격으로, 가격까지 같고 이력만 다르면(92건) 번호로 구분한다. 화면이 완전히 같은 972건은 접는다.
  const cnt = (f) => { const m = new Map(); for (const [p] of rows) { const k = f(p); m.set(k, (m.get(k) ?? 0) + 1) }; return m }
  const byLabel = cnt(variantLabel), byPrice = cnt(p => variantLabel(p) + p[F.prem])
  const opts = [], nth = new Map(), kept = []
  for (const [p, i] of rows) {
    const k = variantLabel(p), kp = k + p[F.prem]
    let label = byLabel.get(k) > 1 ? t('listed_at', { label: k, m: money(p[F.prem]) }) : k
    if (byPrice.get(kp) > 1) {
      if (kept.some(q => variantLabel(q) + q[F.prem] === kp && JSON.stringify(q[F.hist]) === JSON.stringify(p[F.hist]))) continue
      const n = (nth.get(kp) ?? 0) + 1; nth.set(kp, n)
      if (n > 1) label = t('listing_n', { label, n })
    }
    kept.push(p); opts.push([i, label])
  }
  opts.sort((a, b) => a[1].localeCompare(b[1]))
  fill($('variant'), opts, t('ph_variant'))
  VARIANTS = new Map(opts.map(([i]) => [String(i), D.products[i]]))
  if (opts.length === 1) { $('variant').value = String(opts[0][0]); onPick(); return }
  render(VARIANTS.get($('variant').value) ?? null)
}
function onPick() {
  const v = $('variant').value
  const p = VARIANTS.get(v)
  if (p) location.hash = v
  render(p ?? null)
}

// ---- 결과 ----
function sparkline(hist, years) {
  years = Array.isArray(years) ? years : []
  hist = (Array.isArray(hist) ? hist : []).map(fin)
  const pts = years.map((y, i) => [y, hist[i] ?? null])
  const have = pts.filter(p => p[1] != null)
  if (have.length < 2 || years.length < 2) return `<p class="miss">${esc(t('spark_short'))}</p>`
  const W = 520, H = 130, PAD = 34
  const lo = Math.min(...have.map(p => p[1])), hi = Math.max(...have.map(p => p[1]))
  const span = (hi - lo) || 1
  const x = (i) => PAD + i * (W - PAD * 2) / (years.length - 1)
  const y = (v) => H - 26 - (v - lo) / span * (H - 60)
  let seg = '', dots = '', labs = ''
  for (let i = 0; i < years.length; i++) {
    labs += `<text x="${x(i)}" y="${H - 6}" font-size="11" fill="currentColor" opacity=".55" text-anchor="middle">${esc(String(years[i]))}</text>`
    if (pts[i][1] == null) continue
    dots += `<circle cx="${x(i)}" cy="${y(pts[i][1])}" r="3.5" fill="currentColor"/>`
    dots += `<text x="${x(i)}" y="${y(pts[i][1]) - 9}" font-size="11" fill="currentColor" text-anchor="middle">$${pts[i][1].toFixed(0)}</text>`
    for (let j = i + 1; j < years.length; j++) {
      if (pts[j][1] == null) continue
      seg += `<line x1="${x(i)}" y1="${y(pts[i][1])}" x2="${x(j)}" y2="${y(pts[j][1])}" stroke="currentColor" stroke-width="1.6"/>`
      break
    }
  }
  const missing = pts.filter(p => p[1] == null).map(p => String(p[0]))
  const note = missing.length ? `<p class="miss">${esc(t('spark_missing', { years: missing.join(', ') }))}</p>` : ''
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('spark_aria'))}">${seg}${dots}${labs}</svg>${note}`
}

function distribution(p, st) {
  const LABELS = t('bands')
  const d = fin(p[F.pct])
  const mine = d == null ? -1 : d < 0 ? 0 : d < 5 ? 1 : d < 10 ? 2 : d < 15 ? 3 : d < 20 ? 4 : 5
  const bands = (Array.isArray(st.bands) ? st.bands : []).map(Number)
  const max = Math.max(...bands)
  // 막대 폭은 CSS 가 아니라 SVG 표현 속성으로 준다. style= 은 CSP 가 막는다.
  const width = (n) => { const w = n / max * 100; return Number.isFinite(w) ? Math.max(2, Math.min(100, w)) : 2 }
  return `<div class="bands">` + bands.map((n, i) =>
    `<div class="band${i === mine ? ' you' : ''}"><span>${esc(Array.isArray(LABELS) ? LABELS[i] : '')}</span>
      <svg class="bar" aria-hidden="true"><rect width="${width(n)}%" height="100%" rx="2"/></svg>
      <span class="n">${num(n)}</span></div>`).join('') + `</div>`
}

const DIFFS = [
  ['d_waivers', p => { const w = own(D.s.waivers, p[F.waiv]); return w ? String(w).split(',').map(x => tv('waiver_', x)).join(', ') : t('v_none') }],
  ['d_copay', p => tv('copay_', p[F.copay])],
  ['d_gap', p => p[F.gap] ? t('v_yes') : t('v_no')],
  ['d_accom', p => tv('accom_', p[F.accom])],
  ['d_amb', p => p[F.amb] == null ? t('v_not_stated') : tv('amb_', p[F.amb])],
  ['d_waits', p => {
    let w = null
    try { w = JSON.parse(own(D.s.waits, p[F.waits]) || '{}') } catch {}
    if (!w || typeof w !== 'object' || Array.isArray(w)) w = {}
    return Object.entries(w).filter(([, v]) => typeof v === 'string' && v.length > 1)
      .map(([k, v]) => `${tv('wait_', k)} ${t('unit_' + v.slice(-1), { n: v.slice(0, -1) })}`).join(', ') || t('v_not_stated')
  }],
]

function sameCover(p) {
  // 같은 주, 같은 커버 벡터, 같은 스케일, 같은 초과금. 그리고 살 수 있는 것만.
  const rows = D.products.filter(q =>
    q !== p && q[F.state] === p[F.state] && q[F.cover] === p[F.cover] &&
    q[F.who] === p[F.who] && q[F.exP] === p[F.exP] && q[F.exA] === p[F.exA] &&
    q[F.type] === p[F.type] && !q[F.corp] && !q[F.restr] && !RESTRICTED.has(q[F.fund]))
    .sort((a, b) => a[F.prem] - b[F.prem])
  if (!rows.length) return `<p class="sub">${esc(t('no_peers'))}</p>`
  const mine = DIFFS.map(([, f]) => f(p))
  const head = `<tr><th>${esc(t('th_fund'))}</th><th>${esc(t('th_policy'))}</th><th class="n">${t('th_premium_html')}</th>` +
    DIFFS.map(([k]) => `<th>${esc(t(k))}</th>`).join('') + `</tr>`
  const body = rows.map(q => {
    const cells = DIFFS.map(([, f], i) => {
      const v = f(q)
      return `<td${v === mine[i] ? ' class="dim"' : ''}>${esc(v)}</td>`
    }).join('')
    const href = safeHref(own(D.s.urls, q[F.url]))
    return `<tr><td>${esc(fundOf(q[F.fund]))}</td>
      <td>${href ? `<a href="${esc(href)}" rel="nofollow noopener">${esc(nameOf(q))}</a>` : esc(nameOf(q))}</td>
      <td class="n">${money(q[F.prem])}</td>${cells}</tr>`
  }).join('')
  return `<div class="scroll"><table>${head}<tr class="you-row"><td><strong>${esc(fundOf(p[F.fund]))}</strong></td>
      <td><strong>${esc(nameOf(p))}</strong> — ${esc(t('yours'))}</td><td class="n"><strong>${money(p[F.prem])}</strong></td>
      ${mine.map(v => `<td>${esc(v)}</td>`).join('')}</tr>${body}</table></div>
    ${p[F.corp] ? `<div class="note">${esc(t('peers_corp'))}</div>` : ''}
    <div class="note">${esc(t('peers_note', { combined: p[F.type] === 1 ? t('peers_note_combined') : '' }))}</div>`
}

function render(p) {
  const out = $('out')
  if (!p) { out.innerHTML = ''; return }
  const st = own(D.stats, p[F.type] === 0 ? 'hospital' : 'combined') ?? {}
  const d = fin(p[F.pct])
  const kind = t(p[F.type] === 0 ? 'kind_hospital' : 'kind_combined')
  const corp = p[F.corp] ? `<div class="note">${esc(own(D.s.corpText, p[F.corpTxt]) || t('corp_default'))}</div>` : ''
  // 3월엔 같은 값이던 형제 스케일이 4월엔 더 싸다. 추측이 아니라 파일에 있는 값이다.
  const split = (p[F.sibWho] >= 0 && p[F.sibPrem] != null)
    ? `<div class="note warn">${t('split_html', { who: esc(whoLabel(own(D.s.whos, p[F.sibWho]))), sib: money(p[F.sibPrem]), diff: money(p[F.prem] - p[F.sibPrem]) })}</div>` : ''

  // 발표 평균과 이 숫자는 같은 것을 재지 않는다. 나란히 놓고 아무 말도 안 하면
  // 독자는 "우리 기금이 평균보다 더 올렸다" 로 읽는다. 그건 이 데이터로 말할 수 없다.
  const AVG = t('avg_html', { approved: linkHtml('circular', t('avg_approved')), avg: dec(D.meta.announcedAverage) })

  // 반올림된 퍼센트가 아니라 실제 값으로 판정한다. 0.00% 로 표시되지만
  // 실제로는 몇 센트 움직인 행이 221 개 있고, 그걸 '같은 값' 이라고 하면 거짓말이다.
  const unchanged = d != null && p[F.before] === p[F.prem]
  const number = unchanged
    ? `<p class="big">${esc(t('unchanged_big'))}</p><p class="sub">${t('unchanged_html', { prem: money(p[F.prem]), avg: AVG })}</p>`
    : d == null
    ? `<p class="big">${esc(t('nomatch_big'))}</p><p class="sub">${t('nomatch_html')}</p>`
    : `<p class="big ${d >= 0 ? 'up' : 'down'}">${pctStr(d)}</p>
       <p class="sub">${t('changed_html', { before: money(p[F.before]), prem: money(p[F.prem]), avg: AVG, n: num(st.priced), kind, median: dec(st.median),
         perinsurer: linkHtml('perInsurer', t('perinsurer_link')) })}</p>`

  const tiers = Object.entries(st.byTier && typeof st.byTier === 'object' ? st.byTier : {}).sort((a, b) => Number(b[1][0]) - Number(a[1][0]))
  const tb = st.topBand
  const top = tb && Number(tb.n) / Number(tb.total) > 0.5
    ? ' ' + t('topband_html', { n: num(tb.n), total: num(tb.total), fund: esc(fundOf(tb.fund)),
        link: linkHtml('perInsurer', t('topband_link')) }) : ''
  out.innerHTML = `
    <section class="first">
      <h2>${esc(nameOf(p))} · ${esc(p[F.state] === 'ALL' ? t('all_states') : p[F.state])} · ${esc(variantLabel(p))}</h2>
      ${number}${corp}${split}
    </section>
    <section><h2>${esc(t('h_history'))}</h2>${sparkline(p[F.hist], D.meta.years)}</section>
    <section><h2>${esc(t('h_where', { n: num(st.priced), kind, excluded: num(st.priced - st.pricedRetail) }))}</h2>
      ${distribution(p, st)}
      <p class="sub mt12">${esc(t('retail', { n: num(st.pricedRetail), median: dec(st.medianRetail) }))}${top}</p>
      <p class="sub mt12">${t('tiers_html', { list: tiers.map(([tn, v]) => `<strong>${esc(tn)} ${pctStr(Array.isArray(v) ? v[0] : NaN)}</strong> (${num(Array.isArray(v) ? v[1] : NaN)})`).join(', ') })}</p>
    </section>
    <section><h2>${esc(t('h_peers'))}</h2>${sameCover(p)}</section>`
}

// 해시는 D.products 의 인덱스 하나다. 언어와 무관하고, 숫자가 아니면(빈 해시 포함) 빈 폼으로 시작한다.
function fromHash() {
  const h = location.hash.slice(1)
  if (!/^\d{1,7}$/.test(h)) return
  const i = Number(h)
  const p = own(D.products, i)
  if (!p) return
  $('fund').value = p[F.fund]; refreshName()
  $('name').value = String(p[F.name]); refreshState()
  $('state').value = p[F.state]; refreshVariant()
  if (VARIANTS.has(String(i))) { $('variant').value = String(i); render(p) }
}

// 언어를 바꾸면 선택은 유지한 채 전부 다시 그린다.
function relabel() {
  if (!D) return
  const v = $('variant').value
  fillFunds()
  if ($('fund').value) {
    refreshName(); refreshState(); refreshVariant()
    if (VARIANTS.has(v)) { $('variant').value = v; render(VARIANTS.get(v)) }
  }
}

setTheme((() => { try { return localStorage.getItem('theme') } catch { return null } })())
fillLangs()
setLang(pickLang())
$('lang').onchange = () => { setLang($('lang').value); relabel() }
$('theme').onchange = () => setTheme($('theme').value)

// 캐시된 페이지와 데이터 파일이 다른 빌드다. 한 번만 새로고침하고(sessionStorage 가드), 두 번째도 다르면 안내만 남긴다.
function stale() {
  let again = true   // 가드를 기록하지 못하면(저장소 불가) 새로고침하지 않는다 — 무한 새로고침을 막는다
  try {
    const key = 'reloaded-' + (typeof B.v === 'string' ? B.v : '')
    const seen = sessionStorage.getItem(key) === '1'
    if (!seen) sessionStorage.setItem(key, '1')
    again = seen
  } catch {}
  $('out').innerHTML = `<p class="sub">${t('stale_html')}</p>`
  if (!again) location.reload()
}
// index.json 을 받아 화면을 연다. fetch 의 .then 이 부르고, smoke/test-xss 는 네트워크 없이 직접 부른다.
function applyIndex(j) {
  if (!j || !Array.isArray(j.products) || !j.meta || typeof j.meta !== 'object' || !j.s || !j.stats || !j.funds) throw new Error('bad index')
  if (j.meta.schema !== SCHEMA) { stale(); return false }
  D = j; indexProducts()
  RESTRICTED = restrictedSet(D.meta)
  fillStatic()
  fillFunds()
  $('fund').onchange = refreshName
  $('name').onchange = refreshState
  $('state').onchange = refreshVariant
  $('variant').onchange = onPick
  fromHash()
  return true
}

// ?v= 는 version.js 의 빌드 버전이다. 같은 데이터면 같은 값이라 캐시가 살고, 새 빌드면 새 URL 이라 캐시를 비켜 간다.
fetch('index.json?v=' + encodeURIComponent(typeof B.v === 'string' ? B.v : ''), { cache: 'no-cache' })
  .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
  .then(applyIndex)
  .catch(e => { $('out').innerHTML = `<p class="sub">${esc(t('load_error', { msg: e.message }))}</p>` })
