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
const $ = (id) => document.getElementById(id)
const money = (n) => n == null ? null : '$' + n.toFixed(2)
const pctStr = (n) => (n > 0 ? '+' : '') + n.toFixed(2) + '%'
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))

// 누가 커버되는지의 서명은 "성인수|1인전용|부양가족종류" 다. 사람이 읽을 이름으로 바꾸되
// 펀드가 쓰는 마케팅 명칭을 지어내지 않는다. 부양가족 종류는 그대로 덧붙인다.
function whoLabel(sig) {
  const [adults, only, deps] = sig.split('|')
  const d = deps ? deps.split(',') : []
  let base
  if (only === '1') base = 'Single'
  else if (adults === '2') base = d.length ? 'Family' : 'Couple'
  else if (adults === '1') base = d.length ? 'Single parent' : 'Single'
  else if (adults === '0') base = 'Dependants only'
  else base = 'Single'
  return d.length ? `${base} (${d.join(', ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()})` : base
}
const excessLabel = (p) => {
  const bits = []
  if (p[F.exP]) bits.push(`$${p[F.exP]} excess per person`)
  if (p[F.exA]) bits.push(`$${p[F.exA]} per admission`)
  return bits.length ? bits.join(', ') : 'no excess'
}
const variantLabel = (p) => `${whoLabel(D.s.whos[p[F.who]])} — ${excessLabel(p)}`

const fill = (sel, opts, placeholder) => {
  sel.innerHTML = `<option value="">${placeholder}</option>` +
    opts.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('')
  sel.disabled = opts.length === 0
}

function refreshName() {
  const f = $('fund').value
  const names = [...new Set(D.products.filter(p => p[F.fund] === f).map(p => p[F.name]))]
    .map(i => [i, D.s.names[i]]).sort((a, b) => a[1].localeCompare(b[1]))
  fill($('name'), names, names.length ? 'Choose a policy' : '—')
  fill($('state'), [], '—'); fill($('variant'), [], '—'); render(null)
}
function refreshState() {
  const f = $('fund').value, n = Number($('name').value)
  const states = [...new Set(D.products.filter(p => p[F.fund] === f && p[F.name] === n).map(p => p[F.state]))].sort()
  fill($('state'), states.map(s => [s, s === 'ALL' ? 'All states' : s]), 'Choose your state')
  if (states.length === 1) { $('state').value = states[0]; refreshVariant(); return }
  fill($('variant'), [], '—'); render(null)
}
function refreshVariant() {
  const f = $('fund').value, n = Number($('name').value), st = $('state').value
  const rows = D.products.filter(p => p[F.fund] === f && p[F.name] === n && p[F.state] === st)
  // 같은 라벨(가구·본인부담금)로 두 상품코드가 올라온 묶음이 534개 있다. 가격이 다르면
  // 가격으로, 가격까지 같고 이력만 다르면(92건) 번호로 구분한다. 화면이 완전히 같은 972건은 접는다.
  const cnt = (f) => { const m = new Map(); for (const p of rows) { const k = f(p); m.set(k, (m.get(k) ?? 0) + 1) }; return m }
  const byLabel = cnt(variantLabel), byPrice = cnt(p => variantLabel(p) + p[F.prem])
  const seen = new Map(), nth = new Map()
  for (const p of rows) {
    const k = variantLabel(p), kp = k + p[F.prem]
    let label = byLabel.get(k) > 1 ? `${k} — listed at ${money(p[F.prem])}` : k
    if (byPrice.get(kp) > 1) {
      const same = [...seen.values()].find(q => variantLabel(q) + q[F.prem] === kp && JSON.stringify(q[F.hist]) === JSON.stringify(p[F.hist]))
      if (same) continue
      const n = (nth.get(kp) ?? 0) + 1; nth.set(kp, n)
      if (n > 1) label += ` (listing ${n})`
    }
    seen.set(label, p)
  }
  const opts = [...seen.keys()].sort().map(k => [k, k])
  fill($('variant'), opts, 'Choose your cover')
  window.__variants = seen
  if (opts.length === 1) { $('variant').value = opts[0][0]; onPick(); return }
  render(null)
}
function onPick() {
  const p = window.__variants?.get($('variant').value)
  if (p) location.hash = encodeURIComponent([p[F.fund], p[F.name], p[F.state], $('variant').value].join('~'))
  render(p ?? null)
}

// ---- 결과 ----
function sparkline(hist, years) {
  const pts = hist.map((v, i) => [years[i], v])
  const have = pts.filter(p => p[1] != null)
  if (have.length < 2) return `<p class="miss">Not enough April snapshots to draw a line for this policy.</p>`
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
  const note = missing.length
    ? `<p class="miss">The April ${missing.join(', ')} open-products file has no row for this product code with this state, household and excess. The line skips those years rather than guessing why.</p>` : ''
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Listed premium before rebate, each April">${seg}${dots}${labs}</svg>${note}`
}

function distribution(p, st) {
  const LABELS = ['Fell', 'No change or under 5%', '5–10%', '10–15%', '15–20%', 'Over 20%']
  const d = p[F.pct]
  const mine = d == null ? -1 : d < 0 ? 0 : d < 5 ? 1 : d < 10 ? 2 : d < 15 ? 3 : d < 20 ? 4 : 5
  const max = Math.max(...st.bands)
  return `<div class="bands">` + st.bands.map((n, i) =>
    `<div class="band${i === mine ? ' you' : ''}"><span>${LABELS[i]}</span>
      <span class="bar" style="width:${Math.max(2, n / max * 100)}%"></span>
      <span class="n">${n.toLocaleString()}</span></div>`).join('') + `</div>`
}

const DIFFS = [
  ['Excess waivers', p => D.s.waivers[p[F.waiv]] || 'none'],
  ['Co-payments', p => p[F.copay]],
  ['Known-gap cover', p => p[F.gap] ? 'yes' : 'no'],
  ['Accommodation', p => p[F.accom]],
  ['Ambulance', p => p[F.amb] ?? 'not stated'],
  ['Waiting periods', p => {
    const w = JSON.parse(D.s.waits[p[F.waits]] || '{}')
    return Object.entries(w).map(([k, v]) => `${k.replace(/([a-z])([A-Z])/g, '$1 $2')} ${v}`).join(', ') || 'not stated'
  }],
]

function sameCover(p) {
  // 같은 주, 같은 커버 벡터, 같은 스케일, 같은 초과금. 그리고 살 수 있는 것만.
  const rows = D.products.filter(q =>
    q !== p && q[F.state] === p[F.state] && q[F.cover] === p[F.cover] &&
    q[F.who] === p[F.who] && q[F.exP] === p[F.exP] && q[F.exA] === p[F.exA] &&
    q[F.type] === p[F.type] && !q[F.corp] && !q[F.restr] && !RESTRICTED.has(q[F.fund]))
    .sort((a, b) => a[F.prem] - b[F.prem])
  if (!rows.length) return `<p class="sub">No other product open to the general public lists exactly this set of covered hospital services at this state, household and excess. Products sold only through an employer, products sold only together with an extras product, insurers you must be eligible to join, and policies closed to new members are not in this comparison.</p>`
  const mine = DIFFS.map(([, f]) => f(p))
  const head = `<tr><th>Fund</th><th>Policy</th><th class="n">Listed premium<br>before rebate</th>` +
    DIFFS.map(([t]) => `<th>${t}</th>`).join('') + `</tr>`
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
      <td><strong>${esc(D.s.names[p[F.name]])}</strong> — yours</td><td class="n"><strong>${money(p[F.prem])}</strong></td>
      ${mine.map(v => `<td>${esc(v)}</td>`).join('')}</tr>${body}</table></div>
    ${p[F.corp] ? `<div class="note">Your own product is sold through an employer; the products below it are open to the general public.</div>` : ''}
    <div class="note">Sorted by listed price. That is an ordering, not a recommendation — the columns to the right are where these products differ. Matching cover is not an identical policy: these products match on the government file's medical-services list, state, who is covered and excess, and nothing else.${p[F.type] === 1 ? ' For a combined policy the extras side is not compared at all: two rows here can carry entirely different extras cover.' : ''} They may also use different private hospital networks, which can change what you are charged in hospital. The Ombudsman publishes each fund's agreement-hospital list in the same dataset as the prices; this page does not read it. Products sold only through an employer, products sold only together with an extras product, insurers you must be eligible to join, and policies closed to new members are not shown.</div>`
}

function render(p) {
  const out = $('out')
  if (!p) { out.innerHTML = ''; return }
  const st = D.stats[p[F.type] === 0 ? 'hospital' : 'combined']
  const d = p[F.pct]
  const kind = p[F.type] === 0 ? 'hospital' : 'combined hospital and extras'
  const corp = p[F.corp] ? `<div class="note">${esc(D.s.corpText[p[F.corpTxt]] || 'This product is only available through an employer or organisation.')}</div>` : ''
  // 3월엔 같은 값이던 형제 스케일이 4월엔 더 싸다. 추측이 아니라 파일에 있는 값이다.
  const split = (p[F.sibWho] >= 0 && p[F.sibPrem] != null) ? `<div class="note warn">In the 1 March file, the version of this policy covering <strong>${esc(whoLabel(D.s.whos[p[F.sibWho]]))}</strong> was listed at the same premium as yours. In the 5 April file it is listed at <strong>${money(p[F.sibPrem])}</strong> a month, ${money(p[F.prem] - p[F.sibPrem])} below yours. Both rows are in the file under this policy name, as separate product codes.</div>` : ''

  // 발표 평균과 이 숫자는 같은 것을 재지 않는다. 나란히 놓고 아무 말도 안 하면
  // 독자는 "우리 기금이 평균보다 더 올렸다" 로 읽는다. 그건 이 데이터로 말할 수 없다.
  const AVG = `<a href="${CIRCULAR}" rel="nofollow noopener">approved</a> an industry-wide average of ${D.meta.announcedAverage}% for 1 April 2026. That average is weighted by how many people each product covers, spans hospital and extras policies together, and includes discounts this file does not carry, so no single product is expected to match it.`

  // 반올림된 퍼센트가 아니라 실제 값으로 판정한다. 0.00% 로 표시되지만
  // 실제로는 몇 센트 움직인 행이 221 개 있고, 그걸 '같은 값' 이라고 하면 거짓말이다.
  const unchanged = d != null && p[F.before] === p[F.prem]
  const number = unchanged
    ? `<p class="big">No change in the file</p>
       <p class="sub">This product is listed at the same price in the 1 March and 5 April 2026 files: <strong>${money(p[F.prem])}</strong> a month. The file records the price, not the reason it did not move. The figure in your fund's own notice to you is the one that applies to you. The Government ${AVG}</p>`
    : d == null
    ? `<p class="big">No March price to compare</p><p class="sub">This product code is not in the 1 March 2026 list of policies open to new members, so there is no before-price to compare. The publisher's change record for April lists it as added or re-coded since the March file; this page does not follow that chain.</p>`
    : `<p class="big ${d >= 0 ? 'up' : 'down'}">${pctStr(d)}</p>
       <p class="sub">Your listed premium before rebate went from <strong>${money(p[F.before])}</strong> to <strong>${money(p[F.prem])}</strong> a month on 1 April 2026.
       The Government ${AVG} The figure above is a different measure. Across the ${st.priced.toLocaleString()} ${kind} products priced in both months, the middle one moved ${st.median}%.
       The Department publishes an approved average for <a href="${PERINSURER}" rel="nofollow noopener">each insurer separately</a>; that is where to check whether your own fund moved as a whole.</p>`

  const tiers = Object.entries(st.byTier).sort((a, b) => b[1][0] - a[1][0])
  out.innerHTML = `
    <section style="border:0;padding-top:0;margin-top:24px">
      <h2>${esc(D.s.names[p[F.name]])} · ${esc(p[F.state] === 'ALL' ? 'all states' : p[F.state])} · ${esc(variantLabel(p))}</h2>
      ${number}${corp}${split}
    </section>
    <section><h2>Listed premium each April</h2>${sparkline(p[F.hist], D.meta.years)}</section>
    <section><h2>Where this sits among ${st.priced.toLocaleString()} ${kind} products, ${(st.priced - st.pricedRetail).toLocaleString()} of them sold only through an employer, only together with an extras product, or only to people eligible to join a restricted insurer</h2>
      ${distribution(p, st)}
      <p class="sub" style="margin-top:12px">Across the ${st.pricedRetail.toLocaleString()} products open to the general public, the middle one moved ${st.medianRetail}%.${st.topBand && st.topBand.n / st.topBand.total > 0.5 ? ` The top band is concentrated in one insurer: ${st.topBand.n.toLocaleString()} of the ${st.topBand.total.toLocaleString()} products above 20% belong to ${esc(D.funds[st.topBand.fund] ?? st.topBand.fund)}. The Department publishes an <a href="${PERINSURER}" rel="nofollow noopener">approved average for each insurer</a>.` : ''}</p>
      <p class="sub" style="margin-top:12px">By tier as classified in the 5 April 2026 file, the median April change was ${tiers.map(([t, [m, n]]) => `<strong>${t} ${pctStr(m)}</strong> (${n.toLocaleString()})`).join(', ')}. These medians count every product priced in both months, including those sold only through an employer.</p>
    </section>
    <section><h2>Products the file records as covering the same hospital services</h2>${sameCover(p)}</section>`
}

function fromHash() {
  if (!location.hash) return
  // 잘못된 퍼센트 인코딩(#% 등)이면 decodeURIComponent 가 던진다. 링크 하나 때문에
  // 페이지 전체가 죽으면 안 되므로 조용히 무시하고 빈 폼으로 시작한다.
  let raw
  try { raw = decodeURIComponent(location.hash.slice(1)) } catch { return }
  const [fund, name, state, variant] = raw.split('~')
  if (!fund) return
  $('fund').value = fund; refreshName()
  $('name').value = name; refreshState()
  $('state').value = state; refreshVariant()
  if (variant && window.__variants?.has(variant)) { $('variant').value = variant; render(window.__variants.get(variant)) }
}

fetch('index.json').then(r => r.json()).then(j => {
  D = j
  $('snapbefore').textContent = j.meta.snapshots.before
  $('snapafter').textContent = j.meta.snapshots.after
  const funds = [...new Set(j.products.map(p => p[F.fund]))]
    .map(c => [c, j.funds[c] ?? c]).sort((a, b) => a[1].localeCompare(b[1]))
  fill($('fund'), funds, 'Choose your fund')
  $('fund').onchange = refreshName
  $('name').onchange = refreshState
  $('state').onchange = refreshVariant
  $('variant').onchange = onPick
  fromHash()
}).catch(e => { $('out').innerHTML = `<p class="sub">Could not load the data file: ${esc(e.message)}</p>` })
