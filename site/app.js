// 열 순서는 src/build.mjs 와 함께 움직인다.
const F = { fund:0, name:1, state:2, who:3, exP:4, exA:5, tier:6, cover:7, type:8,
            prem:9, pct:10, before:11, hist:12, corp:13, restr:14, corpTxt:15,
            url:16, copay:17, accom:18, gap:19, amb:20, waiv:21, waits:22, sibWho:23, sibPrem:24 }

// privatehealth.gov.au/dynamic/insurer/restricted — 가입 자격이 있어야 드는 곳들.
// 상품 단위 Corporate/OnlyAvailableWith 와는 별개라 따로 걸러야 한다.
const RESTRICTED = new Set(['ACA', 'CBH', 'AHB', 'AMA', 'NHB', 'SPE', 'RBH', 'NTF', 'QTU'])

// 부처 회람과 보험사별 승인 평균. 이 페이지가 대조하는 유일한 외부 숫자의 출처다.
const CIRCULAR = 'https://www.health.gov.au/news/phi-circulars/phi-1126-private-health-insurance-premium-round-announcement'
const PERINSURER = 'https://www.health.gov.au/resources/publications/average-annual-price-changes-in-private-health-insurance-premiums'

let D = null
let BY = null   // fund|name|state → [index]. picker 를 열 때마다 55,678행을 훑지 않는다.
function indexProducts() {
  BY = new Map()
  D.products.forEach((p, i) => { const k = p[F.fund] + '|' + p[F.name] + '|' + p[F.state]; let a = BY.get(k); if (!a) BY.set(k, a = []); a.push(i) })
}
const $ = (id) => document.getElementById(id)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))

// ---- 언어 ----
// 우선순위: ?lang= → 저장값 → 브라우저 언어 → en. 값이 없는 키는 영어로 떨어진다.
let LANG = 'en'
const t = (k, vars) => {
  let s = (STR[LANG] && STR[LANG][k]) ?? STR.en[k]
  if (s == null) return k
  if (vars) for (const [a, b] of Object.entries(vars)) s = s.split(`{${a}}`).join(b)
  return s
}
// 데이터 열거값(XSD 고정값)의 표시명. 표에 없는 값은 원문 그대로.
const tv = (prefix, v) => (STR[LANG] && STR[LANG][prefix + v]) ?? STR.en[prefix + v] ?? v
const num = (n) => n.toLocaleString(STR[LANG]?._locale ?? 'en-AU')
const money = (n) => n == null ? null : '$' + n.toFixed(2)
const pctStr = (n) => (n > 0 ? '+' : '') + n.toFixed(2) + '%'

function pickLang() {
  const q = new URLSearchParams(location.search).get('lang')
  if (q && STR[q]) return q
  try { const s = localStorage.getItem('lang'); if (s && STR[s]) return s } catch {}
  const nav = (navigator.language || 'en').slice(0, 2)
  return STR[nav] ? nav : 'en'
}
function setLang(l) {
  LANG = STR[l] ? l : 'en'
  try { localStorage.setItem('lang', LANG) } catch {}
  document.documentElement.lang = STR[LANG]._locale
  document.title = t('title')
  const m = document.querySelector('meta[name="description"]'); if (m) m.content = t('meta_desc')
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t)
  for (const el of document.querySelectorAll('[data-t-html]')) el.innerHTML = t(el.dataset.tHtml)
  if (D) { $('snapbefore').textContent = D.meta.snapshots.before; $('snapafter').textContent = D.meta.snapshots.after }
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
  const [adults, only, deps] = sig.split('|')
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
const variantLabel = (p) => `${whoLabel(D.s.whos[p[F.who]])} — ${excessLabel(p)}`

const fill = (sel, opts, placeholder) => {
  const keep = sel.value
  sel.innerHTML = `<option value="">${esc(placeholder)}</option>` +
    opts.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('')
  sel.disabled = opts.length === 0
  if (opts.some(([v]) => String(v) === keep)) sel.value = keep
}

function fillFunds() {
  const funds = [...new Set(D.products.map(p => p[F.fund]))]
    .map(c => [c, D.funds[c] ?? c]).sort((a, b) => a[1].localeCompare(b[1]))
  fill($('fund'), funds, t('ph_fund'))
}
function refreshName() {
  const f = $('fund').value
  const names = [...new Set(D.products.filter(p => p[F.fund] === f).map(p => p[F.name]))]
    .map(i => [i, D.s.names[i]]).sort((a, b) => a[1].localeCompare(b[1]))
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
  window.__variants = new Map(opts.map(([i]) => [String(i), D.products[i]]))
  if (opts.length === 1) { $('variant').value = String(opts[0][0]); onPick(); return }
  render(window.__variants.get($('variant').value) ?? null)
}
function onPick() {
  const v = $('variant').value
  const p = window.__variants?.get(v)
  if (p) location.hash = v
  render(p ?? null)
}

// ---- 결과 ----
function sparkline(hist, years) {
  const pts = hist.map((v, i) => [years[i], v])
  const have = pts.filter(p => p[1] != null)
  if (have.length < 2) return `<p class="miss">${esc(t('spark_short'))}</p>`
  const W = 520, H = 130, PAD = 34
  const lo = Math.min(...have.map(p => p[1])), hi = Math.max(...have.map(p => p[1]))
  const span = (hi - lo) || 1
  const x = (i) => PAD + i * (W - PAD * 2) / (years.length - 1)
  const y = (v) => H - 26 - (v - lo) / span * (H - 60)
  let seg = '', dots = '', labs = ''
  for (let i = 0; i < years.length; i++) {
    labs += `<text x="${x(i)}" y="${H - 6}" font-size="11" fill="currentColor" opacity=".55" text-anchor="middle">${years[i]}</text>`
    if (hist[i] == null) continue
    dots += `<circle cx="${x(i)}" cy="${y(hist[i])}" r="3.5" fill="currentColor"/>`
    dots += `<text x="${x(i)}" y="${y(hist[i]) - 9}" font-size="11" fill="currentColor" text-anchor="middle">$${hist[i].toFixed(0)}</text>`
    for (let j = i + 1; j < years.length; j++) {
      if (hist[j] == null) continue
      seg += `<line x1="${x(i)}" y1="${y(hist[i])}" x2="${x(j)}" y2="${y(hist[j])}" stroke="currentColor" stroke-width="1.6"/>`
      break
    }
  }
  const missing = years.filter((_, i) => hist[i] == null)
  const note = missing.length ? `<p class="miss">${esc(t('spark_missing', { years: missing.join(', ') }))}</p>` : ''
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('spark_aria'))}">${seg}${dots}${labs}</svg>${note}`
}

function distribution(p, st) {
  const LABELS = t('bands')
  const d = p[F.pct]
  const mine = d == null ? -1 : d < 0 ? 0 : d < 5 ? 1 : d < 10 ? 2 : d < 15 ? 3 : d < 20 ? 4 : 5
  const max = Math.max(...st.bands)
  return `<div class="bands">` + st.bands.map((n, i) =>
    `<div class="band${i === mine ? ' you' : ''}"><span>${esc(LABELS[i])}</span>
      <span class="bar" style="width:${Math.max(2, n / max * 100)}%"></span>
      <span class="n">${num(n)}</span></div>`).join('') + `</div>`
}

const DIFFS = [
  ['d_waivers', p => { const w = D.s.waivers[p[F.waiv]]; return w ? w.split(',').map(x => tv('waiver_', x)).join(', ') : t('v_none') }],
  ['d_copay', p => tv('copay_', p[F.copay])],
  ['d_gap', p => p[F.gap] ? t('v_yes') : t('v_no')],
  ['d_accom', p => tv('accom_', p[F.accom])],
  ['d_amb', p => p[F.amb] == null ? t('v_not_stated') : tv('amb_', p[F.amb])],
  ['d_waits', p => {
    const w = JSON.parse(D.s.waits[p[F.waits]] || '{}')
    return Object.entries(w).map(([k, v]) => `${tv('wait_', k)} ${t('unit_' + v.slice(-1), { n: v.slice(0, -1) })}`).join(', ') || t('v_not_stated')
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
      return `<td${v === mine[i] ? ' style="color:var(--ink3)"' : ''}>${esc(v)}</td>`
    }).join('')
    const u = D.s.urls[q[F.url]]
    return `<tr><td>${esc(D.funds[q[F.fund]] ?? q[F.fund])}</td>
      <td>${u ? `<a href="${esc(u)}" rel="nofollow noopener">${esc(D.s.names[q[F.name]])}</a>` : esc(D.s.names[q[F.name]])}</td>
      <td class="n">${money(q[F.prem])}</td>${cells}</tr>`
  }).join('')
  return `<div class="scroll"><table>${head}<tr style="background:var(--card)"><td><strong>${esc(D.funds[p[F.fund]] ?? p[F.fund])}</strong></td>
      <td><strong>${esc(D.s.names[p[F.name]])}</strong> — ${esc(t('yours'))}</td><td class="n"><strong>${money(p[F.prem])}</strong></td>
      ${mine.map(v => `<td>${esc(v)}</td>`).join('')}</tr>${body}</table></div>
    ${p[F.corp] ? `<div class="note">${esc(t('peers_corp'))}</div>` : ''}
    <div class="note">${esc(t('peers_note', { combined: p[F.type] === 1 ? t('peers_note_combined') : '' }))}</div>`
}

function render(p) {
  const out = $('out')
  if (!p) { out.innerHTML = ''; return }
  const st = D.stats[p[F.type] === 0 ? 'hospital' : 'combined']
  const d = p[F.pct]
  const kind = t(p[F.type] === 0 ? 'kind_hospital' : 'kind_combined')
  const corp = p[F.corp] ? `<div class="note">${esc(D.s.corpText[p[F.corpTxt]] || t('corp_default'))}</div>` : ''
  // 3월엔 같은 값이던 형제 스케일이 4월엔 더 싸다. 추측이 아니라 파일에 있는 값이다.
  const split = (p[F.sibWho] >= 0 && p[F.sibPrem] != null)
    ? `<div class="note warn">${t('split_html', { who: esc(whoLabel(D.s.whos[p[F.sibWho]])), sib: money(p[F.sibPrem]), diff: money(p[F.prem] - p[F.sibPrem]) })}</div>` : ''

  // 발표 평균과 이 숫자는 같은 것을 재지 않는다. 나란히 놓고 아무 말도 안 하면
  // 독자는 "우리 기금이 평균보다 더 올렸다" 로 읽는다. 그건 이 데이터로 말할 수 없다.
  const AVG = t('avg_html', { approved: `<a href="${CIRCULAR}" rel="nofollow noopener">${esc(t('avg_approved'))}</a>`, avg: D.meta.announcedAverage })

  // 반올림된 퍼센트가 아니라 실제 값으로 판정한다. 0.00% 로 표시되지만
  // 실제로는 몇 센트 움직인 행이 221 개 있고, 그걸 '같은 값' 이라고 하면 거짓말이다.
  const unchanged = d != null && p[F.before] === p[F.prem]
  const number = unchanged
    ? `<p class="big">${esc(t('unchanged_big'))}</p><p class="sub">${t('unchanged_html', { prem: money(p[F.prem]), avg: AVG })}</p>`
    : d == null
    ? `<p class="big">${esc(t('nomatch_big'))}</p><p class="sub">${t('nomatch_html')}</p>`
    : `<p class="big ${d >= 0 ? 'up' : 'down'}">${pctStr(d)}</p>
       <p class="sub">${t('changed_html', { before: money(p[F.before]), prem: money(p[F.prem]), avg: AVG, n: num(st.priced), kind, median: st.median,
         perinsurer: `<a href="${PERINSURER}" rel="nofollow noopener">${esc(t('perinsurer_link'))}</a>` })}</p>`

  const tiers = Object.entries(st.byTier).sort((a, b) => b[1][0] - a[1][0])
  const top = st.topBand && st.topBand.n / st.topBand.total > 0.5
    ? ' ' + t('topband_html', { n: num(st.topBand.n), total: num(st.topBand.total), fund: esc(D.funds[st.topBand.fund] ?? st.topBand.fund),
        link: `<a href="${PERINSURER}" rel="nofollow noopener">${esc(t('topband_link'))}</a>` }) : ''
  out.innerHTML = `
    <section style="border:0;padding-top:0;margin-top:24px">
      <h2>${esc(D.s.names[p[F.name]])} · ${esc(p[F.state] === 'ALL' ? t('all_states') : p[F.state])} · ${esc(variantLabel(p))}</h2>
      ${number}${corp}${split}
    </section>
    <section><h2>${esc(t('h_history'))}</h2>${sparkline(p[F.hist], D.meta.years)}</section>
    <section><h2>${esc(t('h_where', { n: num(st.priced), kind, excluded: num(st.priced - st.pricedRetail) }))}</h2>
      ${distribution(p, st)}
      <p class="sub" style="margin-top:12px">${esc(t('retail', { n: num(st.pricedRetail), median: st.medianRetail }))}${top}</p>
      <p class="sub" style="margin-top:12px">${t('tiers_html', { list: tiers.map(([tn, [m, n]]) => `<strong>${esc(tn)} ${pctStr(m)}</strong> (${num(n)})`).join(', ') })}</p>
    </section>
    <section><h2>${esc(t('h_peers'))}</h2>${sameCover(p)}</section>`
}

// 해시는 D.products 의 인덱스 하나다. 언어와 무관하고, 잘못된 값이면 빈 폼으로 시작한다.
function fromHash() {
  const i = Number(location.hash.slice(1))
  const p = Number.isInteger(i) && D.products[i]
  if (!p) return
  $('fund').value = p[F.fund]; refreshName()
  $('name').value = String(p[F.name]); refreshState()
  $('state').value = p[F.state]; refreshVariant()
  if (window.__variants?.has(String(i))) { $('variant').value = String(i); render(p) }
}

// 언어를 바꾸면 선택은 유지한 채 전부 다시 그린다.
function relabel() {
  if (!D) return
  const v = $('variant').value
  fillFunds()
  if ($('fund').value) {
    refreshName(); refreshState(); refreshVariant()
    if (window.__variants?.has(v)) { $('variant').value = v; render(window.__variants.get(v)) }
  }
}

setTheme((() => { try { return localStorage.getItem('theme') } catch { return null } })())
setLang(pickLang())
$('lang').onchange = () => { setLang($('lang').value); relabel() }
$('theme').onchange = () => setTheme($('theme').value)

fetch('index.json').then(r => r.json()).then(j => {
  D = j; indexProducts()
  $('snapbefore').textContent = j.meta.snapshots.before
  $('snapafter').textContent = j.meta.snapshots.after
  fillFunds()
  $('fund').onchange = refreshName
  $('name').onchange = refreshState
  $('state').onchange = refreshVariant
  $('variant').onchange = onPick
  fromHash()
}).catch(e => { $('out').innerHTML = `<p class="sub">${esc(t('load_error', { msg: e.message }))}</p>` })
