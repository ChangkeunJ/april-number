// index.json 을 만든다. 런타임에는 이 파일 하나만 받아 간다.
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import glob from 'node:fs'
import { parseFile } from './parse.mjs'
import { load, key, pct, median } from './join.mjs'

const YEARS = [2022, 2023, 2024, 2025, 2026]
const APR = { 2022: '03-Apr-2022', 2023: '01-Apr-2023', 2024: '02-Apr-2024', 2025: '02-Apr-2025', 2026: '05-Apr-2026' }
const f = (dir, kind, stamp) => `data/${dir}/${kind} Open ${stamp}.xml`

// 발표된 업계 평균. 이 페이지가 대조하는 유일한 외부 숫자다.
const ANNOUNCED = 4.41

function fundNames() {
  const s = readFileSync(`data/april-2026/Funds ${APR[2026]}.xml`, 'utf8')
  const out = {}
  for (const m of s.matchAll(/<FundCode>([^<]+)<\/FundCode><FundName>([^<]+)<\/FundName>/g)) out[m[1]] = m[2]
  return out
}

// 과거 스냅샷은 보험료만 있으면 된다. 전체 객체를 들고 있으면 메모리가 터진다.
async function premiums(path) {
  const m = new Map()
  await parseFile(path, r => { if (r.status === 'Open') m.set(key(r), r.premium) })
  return m
}

// 상품 가족. 같은 기금의 같은 상품명·주·초과금 안에서 스케일만 다른 행들.
const fam = (r) => `${r.fund}|${r.name}|${r.state}|${r.exPerson}|${r.exAdmission}`

// 보험료와 가족별 상품코드를 한 번에 훑는다. 파일이 240 MB 라 두 번 읽지 않는다.
async function premiumsAndFamilies(path) {
  const m = new Map(), fc = new Map()
  await parseFile(path, r => {
    if (r.status !== 'Open') return
    m.set(key(r), r.premium)
    const f = fam(r)
    let s = fc.get(f); if (!s) fc.set(f, s = new Set())
    s.add(r.code)
  })
  return { premiums: m, families: fc }
}

const T = () => { const a = [], i = new Map(); return { a, of: (v) => { if (v == null) return -1; let k = i.get(v); if (k === undefined) { k = a.length; a.push(v); i.set(v, k) } return k } } }

async function main() {
  const funds = fundNames()
  const names = T(), urls = T(), whos = T(), covers = T(), waits = T(), waivers = T(), corpText = T()
  const products = []
  const stats = {}

  for (const kind of ['Hospital', 'Combined']) {
    const cur = await load(f('april-2026', kind, APR[2026]))
    const marBoth = await premiumsAndFamilies(f('march-2026', kind, '01-Mar-2026'))
    const mar = marBoth.premiums

    // 3월에 없던 상품코드가 4월에 같은 가족 안으로 들어왔다면 그 가족은 개편됐다.
    // 매칭된 옛 코드의 상승률은 회원이 실제로 겪은 인상이 아니라 스케일 재편의
    // 부산물일 수 있다. 숫자는 그대로 싣되 표시해 둔다.
    const aprFam = new Map()
    for (const r of cur.values()) { const f2 = fam(r); let s2 = aprFam.get(f2); if (!s2) aprFam.set(f2, s2 = new Set()); s2.add(r.code) }
    const restructured = new Set()
    for (const [f2, ac] of aprFam) {
      const oc = marBoth.families.get(f2)
      if (oc && [...ac].some(c => !oc.has(c))) restructured.add(f2)
    }
    const hist = {}
    for (const y of YEARS.slice(0, -1)) hist[y] = await premiums(f(`april-${y}`, kind, APR[y]))

    const deltas = []
    for (const [k, r] of cur) {
      const before = mar.get(k)
      const d = (Number.isFinite(before) && before > 0 && Number.isFinite(r.premium)) ? pct(before, r.premium) : null
      if (d !== null) deltas.push({ d, tier: r.tier })
      products.push([
        r.fund, names.of(r.name), r.state, whos.of(r.who), r.exPerson, r.exAdmission,
        r.tier, covers.of(r.cover), kind === 'Hospital' ? 0 : 1,
        r.premium, r.premiumHospital,
        d === null ? null : Math.round(d * 100) / 100,
        // 반올림된 퍼센트에서 역산하면 몇 센트가 틀린다. 3월 값을 그대로 싣는다.
        Number.isFinite(before) ? before : null,
        YEARS.map(y => y === 2026 ? r.premium : (hist[y].get(k) ?? null)),
        r.corporate ? 1 : 0, r.restricted ? 1 : 0, corpText.of(r.corporateText),
        urls.of(r.url), r.copay, r.accom, r.knownGap ? 1 : 0, r.ambulance,
        waivers.of(r.waivers.join(',')), waits.of(JSON.stringify(r.waits)),
        restructured.has(fam(r)) ? 1 : 0,
      ])
    }
    const band = (lo, hi) => deltas.filter(x => x.d >= lo && x.d < hi).length
    const byTier = {}
    for (const x of deltas) (byTier[x.tier] ??= []).push(x.d)
    stats[kind.toLowerCase()] = {
      open: cur.size, priced: deltas.length,
      median: Math.round(median(deltas.map(x => x.d)) * 100) / 100,
      bands: [deltas.filter(x => x.d < 0).length, band(0, 5), band(5, 10), band(10, 15), band(15, 20), deltas.filter(x => x.d >= 20).length],
      byTier: Object.fromEntries(Object.entries(byTier).map(([t, v]) => [t, [Math.round(median(v) * 100) / 100, v.length]])),
      restructured: [...cur.values()].filter(r => restructured.has(fam(r)) && Number.isFinite(mar.get(key(r)))).length,
    }
    console.log(`${kind}: ${cur.size} open, ${deltas.length} priced both months, median ${stats[kind.toLowerCase()].median}%, 개편가족 ${restructured.size} → 상품 ${stats[kind.toLowerCase()].restructured}`)
  }

  const out = {
    meta: {
      built: new Date().toISOString().slice(0, 10),
      rateRise: '2026-04-01', announcedAverage: ANNOUNCED, years: YEARS,
      source: 'https://data.gov.au/dataset/8ab10b1f-6eac-423c-abc5-bbffc31b216c',
      publisher: 'Private Health Insurance Ombudsman', licence: 'CC BY 3.0 AU',
      snapshots: { before: '2026-03-01', after: '2026-04-05' },
    },
    stats, funds,
    s: { names: names.a, urls: urls.a, whos: whos.a, covers: covers.a, waivers: waivers.a, waits: waits.a, corpText: corpText.a },
    products,
  }
  mkdirSync('site', { recursive: true })
  const json = JSON.stringify(out)
  writeFileSync('site/index.json', json)
  const gz = gzipSync(json, { level: 9 })
  console.log(`\nindex.json  ${(json.length / 1e6).toFixed(2)} MB raw / ${(gz.length / 1e6).toFixed(2)} MB gzip`)
  console.log(`products ${products.length}  names ${names.a.length}  covers ${covers.a.length}  funds ${Object.keys(funds).length}`)
}
main()
