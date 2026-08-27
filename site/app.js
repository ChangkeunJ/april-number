// 열 순서는 src/build.mjs 와 함께 움직인다.
const F = { fund:0, name:1, state:2, who:3, exP:4, exA:5, tier:6, cover:7, type:8,
            prem:9, premH:10, pct:11, before:12, hist:13, corp:14, restr:15, corpTxt:16,
            url:17, copay:18, accom:19, gap:20, amb:21, waiv:22, waits:23, sibWho:24, sibPrem:25 }

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
  const seen = new Map()
  for (const p of rows) { const k = variantLabel(p); if (!seen.has(k)) seen.set(k, p) }
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
    ? `<p class="miss">No April ${missing.join(', ')} snapshot carries this product code — the fund had not listed it under this code yet, or renamed it. The line skips those years rather than guessing.</p>` : ''
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Listed premium before rebate, each April">${seg}${dots}${labs}</svg>${note}`
}

function distribution(p, st) {
  const LABELS = ['Fell', 'Under 5%', '5–10%', '10–15%', '15–20%', 'Over 20%']
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
    q[F.type] === p[F.type] && !q[F.corp] && !q[F.restr])
    .sort((a, b) => a[F.prem] - b[F.prem])
  if (!rows.length) return `<p class="sub">No other product that anyone can buy has a byte-identical clinical cover list at this state, scale and excess.</p>`
  const mine = DIFFS.map(([, f]) => f(p))
  const head = `<tr><th>Fund</th><th>Policy</th><th class="n">Listed premium<br>before rebate</th>` +
    DIFFS.map(([t]) => `<th>${t}</th>`).join('') + `</tr>`
  const body = rows.slice(0, 40).map(q => {
    const cells = DIFFS.map(([, f], i) => {
      const v = f(q)
      return `<td${v === mine[i] ? ' style="color:var(--ink3)"' : ''}>${esc(v)}</td>`
    }).join('')
    const u = D.s.urls[q[F.url]]
    return `<tr><td>${esc(D.funds[q[F.fund]] ?? q[F.fund])}</td>
      <td>${u ? `<a href="${esc(u)}" rel="nofollow noopener">${esc(D.s.names[q[F.name]])}</a>` : esc(D.s.names[q[F.name]])}</td>
      <td class="n">${money(q[F.prem])}</td>${cells}</tr>`
  }).join('')
  const more = rows.length > 40 ? `<p class="sub">${rows.length - 40} more not shown.</p>` : ''
  return `<div class="scroll"><table>${head}<tr style="background:var(--card)"><td><strong>${esc(D.funds[p[F.fund]] ?? p[F.fund])}</strong></td>
      <td><strong>${esc(D.s.names[p[F.name]])}</strong> — yours</td><td class="n"><strong>${money(p[F.prem])}</strong></td>
      ${mine.map(v => `<td>${esc(v)}</td>`).join('')}</tr>${body}</table></div>${more}
    <div class="note">Identical clinical cover is not an identical policy. These products match on the government file's medical-services list, state, who is covered and excess — and differ in the columns above. They may also use different private hospital networks, which changes what you are charged in hospital; check each fund's own agreement-hospital list. Products only available through an employer or another purchase are excluded from this table.</div>`
}

function render(p) {
  const out = $('out')
  if (!p) { out.innerHTML = ''; return }
  const st = D.stats[p[F.type] === 0 ? 'hospital' : 'combined']
  const d = p[F.pct]
  const kind = p[F.type] === 0 ? 'hospital' : 'combined hospital and extras'
  const corp = p[F.corp] ? `<div class="note">${esc(D.s.corpText[p[F.corpTxt]] || 'This product is only available through an employer or organisation.')}</div>` : ''
  // 3월엔 같은 값이던 형제 스케일이 4월엔 더 싸다. 추측이 아니라 파일에 있는 값이다.
  const split = (p[F.sibWho] >= 0 && p[F.sibPrem] != null) ? `<div class="note warn">In the 1 March file, the version of this policy covering <strong>${esc(whoLabel(D.s.whos[p[F.sibWho]]))}</strong> cost exactly the same as yours. On 1 April it costs <strong>${money(p[F.sibPrem])}</strong> — ${money(p[F.prem] - p[F.sibPrem])} a month less than yours. This fund has started charging separately for who a policy covers. If the cheaper version covers everyone you actually cover, that is worth asking your fund about.</div>` : ''

  const number = d == null
    ? `<p class="big">No April change</p><p class="sub">This product code does not appear in the 1 March 2026 file, so there is no before-price to compare. It was new, renamed, or re-coded.</p>`
    : `<p class="big ${d >= 0 ? 'up' : 'down'}">${pctStr(d)}</p>
       <p class="sub">Your listed premium before rebate went from <strong>${money(p[F.before])}</strong> to <strong>${money(p[F.prem])}</strong> a month on 1 April 2026.
       The announced industry average was ${D.meta.announcedAverage}%. Across ${st.priced.toLocaleString()} ${kind} products priced in both months, the median was ${st.median}%.</p>`

  const tiers = Object.entries(st.byTier).sort((a, b) => b[1][0] - a[1][0])
  out.innerHTML = `
    <section style="border:0;padding-top:0;margin-top:24px">
      <h2>${esc(D.s.names[p[F.name]])} · ${esc(p[F.state] === 'ALL' ? 'all states' : p[F.state])} · ${esc(variantLabel(p))}</h2>
      ${number}${corp}${split}
    </section>
    <section><h2>Listed premium each April</h2>${sparkline(p[F.hist], D.meta.years)}</section>
    <section><h2>Where this sits among ${st.priced.toLocaleString()} ${kind} products</h2>
      ${distribution(p, st)}
      <p class="sub" style="margin-top:14px">By tier, the median April rise was ${tiers.map(([t, [m, n]]) => `<strong>${t} ${pctStr(m)}</strong> (${n.toLocaleString()})`).join(', ')}. That spread is why one industry average describes almost nobody.</p>
    </section>
    <section><h2>Products the file records as covering the same things</h2>${sameCover(p)}</section>`
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
