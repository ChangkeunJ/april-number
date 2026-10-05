// index.json 을 만든다. 런타임에는 이 파일 하나만 받아 간다.
// 연도·스냅샷·발표 평균·제한 보험사는 rise.json(config.mjs) 에서 온다.
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseFile, dec } from './parse.mjs'
import { load, key, pct, median } from './join.mjs'
import { RISE, xmlPath, stampOf, stampToIso, years, isCandidate } from './config.mjs'
import { WIDTH } from './columns.mjs'

// index.json 의 레이아웃 버전. 행 레이아웃 F(columns.mjs)나 stats 필드가 바뀔 때마다 올린다.
// site/app.js 의 SCHEMA 와 같아야 한다 — 다르면 캐시된 app.js 가 새 데이터를 잘못 읽을 수 있어 app.js 가 새로고침한다.
export const SCHEMA = 2

const tag = (s, name) => { const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(s); return m ? dec(m[1]) : null }

// 기금 코드 → 이름. 데이터 값이 키라 프로토타입 없는 객체에 담고, 이름은 parse.mjs 와 같이 엔티티를 푼다.
function fundNames(s) {
  const out = Object.create(null)
  for (const m of s.matchAll(/<FundCode>([^<]+)<\/FundCode><FundName>([^<]+)<\/FundName>/g)) out[dec(m[1])] = dec(m[2])
  return out
}
// Funds 파일이 <FundType>Restricted</FundType> 를 싣는다(README). 태그가 없으면 null — 대조를 건너뛴다.
// <Fund>…</Fund> 블록이 있으면 블록 단위로, 없으면 <FundCode> 사이 구간으로 묶는다.
export function restrictedInFunds(s) {
  if (!/<FundType>/.test(s)) return null
  const blocks = s.match(/<Fund\b[^>]*>[\s\S]*?<\/Fund>/g) ?? s.split(/(?=<FundCode>)/)
  const out = new Set()
  for (const b of blocks) {
    const code = tag(b, 'FundCode'), type = tag(b, 'FundType')
    if (code && type && /^restricted$/i.test(type.trim())) out.add(code)
  }
  return out
}

// 과거 스냅샷은 보험료만 있으면 된다. 전체 객체를 들고 있으면 메모리가 터진다.
async function premiums(path) {
  const m = new Map()
  await parseFile(path, r => { if (r.status === 'Open') m.set(key(r), r.premium) })
  return m
}

// 상품 URL 은 http(s) 로 파싱될 때만 싣는다. 프론트의 safeHref 와 같은 규칙.
const safeUrl = (u) => { try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:' ? u : null } catch { return null } }

// 형제. 같은 상품 안에서 '누가 커버되는지' 만 다른 행들.
const sib = (r) => `${r.fund}|${r.name}|${r.state}|${r.exPerson}|${r.exAdmission}|${r.tier}|${r.cover}`

const T = () => { const a = [], i = new Map(); return { a, of: (v) => { if (v == null) return -1; let k = i.get(v); if (k === undefined) { k = a.length; a.push(v); i.set(v, k) } return k } } }

export async function build({ outDir = 'site', log = console.log } = {}) {
  const strict = !isCandidate()
  // 발표된 업계 평균. 이 페이지가 대조하는 유일한 외부 숫자다. 없으면 공개할 수 없다.
  if (strict && RISE.announcedAverage == null) {
    throw new Error('rise.json: announcedAverage is null — fill it from the PHI circular before a strict build (or run with --candidate)')
  }
  const fundsXml = readFileSync(xmlPath(RISE.after, 'Funds'), 'utf8')
  const funds = fundNames(fundsXml)
  // privatehealth.gov.au/dynamic/insurer/restricted — 가입 자격이 있어야 드는 곳들.
  // 상품 단위 Corporate/OnlyAvailableWith 와 별개다. site/app.js 는 meta.restrictedFunds 로 받는다.
  const RESTRICTED = new Set(RISE.restrictedFunds)
  const inFile = restrictedInFunds(fundsXml)
  if (inFile === null) {
    log('Funds file carries no <FundType>; restricted set not cross-checked against rise.json')
  } else {
    const a = [...inFile].sort().join(','), b = [...RESTRICTED].sort().join(',')
    if (a !== b) {
      const msg = `restricted funds differ — Funds file: [${a}] rise.json: [${b}]`
      if (strict) throw new Error(msg)
      log(`warning: ${msg}`)
    } else log(`restricted funds: ${inFile.size} codes match the Funds file`)
  }

  const names = T(), urls = T(), whos = T(), covers = T(), waits = T(), waivers = T(), corpText = T()
  const products = []
  const stats = {}
  const history = RISE.history  // 마지막 항목이 이번 스냅샷(RISE.after)

  for (const kind of ['Hospital', 'Combined']) {
    const cur = await load(xmlPath(RISE.after, kind))
    const mar = await premiums(xmlPath(RISE.before, kind))

    // 3월엔 내 스케일과 값이 같았는데 4월에 더 싸진 형제가 있는가. 있다면
    // 그 기금이 부양가족 종류별로 값을 나누기 시작했다는 뜻이고, 독자가
    // 자기 기금에 물어볼 수 있는 사실이다. 추측이 아니라 파일에 있는 값이다.
    const sibs = new Map()
    for (const r of cur.values()) { const k2 = sib(r); let a2 = sibs.get(k2); if (!a2) sibs.set(k2, a2 = []); a2.push(r) }
    const cheaperSibling = (r) => {
      const mine = mar.get(key(r))
      if (!Number.isFinite(mine)) return null
      let best = null
      for (const x of sibs.get(sib(r))) {
        if (x.who === r.who || !(x.premium < r.premium)) continue
        if (mar.get(key(x)) !== mine) continue
        if (!best || x.premium < best.premium) best = x
      }
      return best
    }
    const hist = new Map()
    for (const name of history.slice(0, -1)) hist.set(name, await premiums(xmlPath(name, kind)))

    const deltas = []
    let split = 0
    for (const [k, r] of cur) {
      const before = mar.get(k)
      const d = (Number.isFinite(before) && before > 0 && Number.isFinite(r.premium)) ? pct(before, r.premium) : null
      if (d !== null) deltas.push({ d, tier: r.tier, retail: !r.corporate && !r.restricted && !RESTRICTED.has(r.fund), fund: r.fund })
      const sb = d === null ? null : cheaperSibling(r)
      const sibWho = sb ? whos.of(sb.who) : -1
      const sibPrem = sb ? sb.premium : null
      if (sb) split++
      const row = [
        r.fund, names.of(r.name), r.state, whos.of(r.who), r.exPerson, r.exAdmission,
        r.tier, covers.of(r.cover), kind === 'Hospital' ? 0 : 1,
        r.premium,
        d === null ? null : Math.round(d * 100) / 100,
        // 반올림된 퍼센트에서 역산하면 몇 센트가 틀린다. 3월 값을 그대로 싣는다.
        Number.isFinite(before) ? before : null,
        history.map(name => name === RISE.after ? r.premium : (hist.get(name).get(k) ?? null)),
        r.corporate ? 1 : 0, r.restricted ? 1 : 0, corpText.of(r.corporateText),
        urls.of(safeUrl(r.url)), r.copay, r.accom, r.knownGap ? 1 : 0, r.ambulance,
        waivers.of(r.waivers.join(',')), waits.of(JSON.stringify(r.waits)),
        sibWho, sibPrem,
      ]
      if (row.length !== WIDTH) throw new Error(`row width ${row.length} ≠ ${WIDTH} (columns.mjs)`)
      products.push(row)
    }
    const band = (lo, hi) => deltas.filter(x => x.d >= lo && x.d < hi).length
    const retail = deltas.filter(x => x.retail)
    const byTier = Object.create(null)
    for (const x of deltas) (byTier[x.tier] ??= []).push(x.d)
    stats[kind.toLowerCase()] = {
      open: cur.size, priced: deltas.length,
      median: Math.round(median(deltas.map(x => x.d)) * 100) / 100,
      bands: [deltas.filter(x => x.d < 0).length, band(0, 5), band(5, 10), band(10, 15), band(15, 20), deltas.filter(x => x.d >= 20).length],
      byTier: Object.fromEntries(Object.entries(byTier).map(([t, v]) => [t, [Math.round(median(v) * 100) / 100, v.length]])),
      // 법인 전용·가입조건부를 뺀, 누구나 살 수 있는 상품만의 모집단.
      // 대안 표에서 빼는 상품을 분포에는 넣어 두면 앞뒤가 안 맞는다.
      pricedRetail: retail.length,
      medianRetail: Math.round(median(retail.map(x => x.d)) * 100) / 100,
      zero: deltas.filter(x => x.d === 0).length,
      // 최상단 밴드가 한 기금에 몰려 있으면 그 사실을 말한다.
      topBand: (() => {
        const hi = deltas.filter(x => x.d >= 20)
        const by = Object.create(null); for (const x of hi) by[x.fund] = (by[x.fund] || 0) + 1
        const [fund, n] = Object.entries(by).sort((a, b) => b[1] - a[1])[0] ?? []
        return fund ? { fund, n, total: hi.length } : null
      })(),
      split,
    }
    log(`${kind}: ${cur.size} open, ${deltas.length} priced both months, median ${stats[kind.toLowerCase()].median}%, 형제 갈라짐 ${split}`)
  }

  const out = {
    meta: {
      // built 와 version 은 아래에서 채운다. 둘을 null 로 둔 직렬화의 sha256 이 version 이라
      // 같은 데이터는 날이 달라도 같은 version 을 받는다 (version.js 의 ?v= 캐시 키).
      built: null, version: null, schema: SCHEMA,
      rateRise: RISE.riseDate, announcedAverage: RISE.announcedAverage, years: years(),
      source: 'https://data.gov.au/data/dataset/8ab10b1f-6eac-423c-abc5-bbffc31b216c',
      publisher: 'Private Health Insurance Ombudsman', licence: 'CC BY 3.0 AU',
      snapshots: {
        before: stampToIso(stampOf(RISE.before)), after: stampToIso(stampOf(RISE.after)),
        beforeName: RISE.before, afterName: RISE.after,
      },
      riseYear: RISE.riseYear, riseDate: RISE.riseDate, links: RISE.links, restrictedFunds: RISE.restrictedFunds,
    },
    stats, funds,
    s: { names: names.a, urls: urls.a, whos: whos.a, covers: covers.a, waivers: waivers.a, waits: waits.a, corpText: corpText.a },
    products,
  }
  out.meta.version = createHash('sha256').update(JSON.stringify(out)).digest('hex').slice(0, 12)
  out.meta.built = new Date().toISOString()
  mkdirSync(outDir, { recursive: true })
  const json = JSON.stringify(out)
  writeFileSync(join(outDir, 'index.json'), json)
  // version.js: classic script 하나. app.js 가 index.json 을 ?v= 로 받고, index.json 이 오기 전에도 날짜를 그린다.
  const BUILD = { v: out.meta.version, built: out.meta.built, schema: SCHEMA, riseYear: RISE.riseYear, riseDate: RISE.riseDate,
                  before: out.meta.snapshots.before, after: out.meta.snapshots.after, years: out.meta.years }
  writeFileSync(join(outDir, 'version.js'), `var BUILD = ${JSON.stringify(BUILD)}\n`)
  const gz = gzipSync(json, { level: 9 })
  log(`\nindex.json  ${(json.length / 1e6).toFixed(2)} MB raw / ${(gz.length / 1e6).toFixed(2)} MB gzip`)
  log(`products ${products.length}  names ${names.a.length}  covers ${covers.a.length}  funds ${Object.keys(funds).length}`)
  return out
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build().catch(e => { console.error(e.message); process.exit(1) })
}
