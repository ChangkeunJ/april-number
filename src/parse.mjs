// PHIO 상품 XML 을 스트리밍으로 읽는다. XML 라이브러리를 쓰지 않는다 —
// 247 MB 짜리 파일에서 필요한 필드가 전부 평평한 태그나 속성이라
// sax/fast-xml-parser 는 더 느리고 메모리만 훨씬 더 먹는다.
import { createReadStream } from 'node:fs'

const attr = (s, name) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(s)
  return m ? m[1] : null
}
const tag = (s, name) => {
  const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(s)
  return m ? m[1] : null
}

// 커버 벡터. 서비스명은 알파벳순으로 고정돼 있으므로 값만 이어 붙인다.
//   C=Covered  R=Restricted  N=NotCovered
const COVER = { Covered: 'C', Restricted: 'R', NotCovered: 'N' }
function coverVector(s) {
  const block = /<MedicalServices>([\s\S]*?)<\/MedicalServices>/.exec(s)
  if (!block) return null
  const out = []
  for (const m of block[1].matchAll(/<MedicalService Title="([^"]+)" Cover="([^"]+)"/g)) {
    out.push(m[1], COVER[m[2]] ?? '?')
  }
  // 제목까지 포함해 해시한다. 서비스 목록 자체가 바뀌면 벡터가 달라져야 한다.
  return out.join('')
}

// 누가 커버되는가. 성인 수 + 1인 전용 여부 + 커버되는 부양가족 종류.
function whoSignature(s) {
  const w = /<WhoIsCovered([^>]*)>([\s\S]*?)<\/WhoIsCovered>/.exec(s)
  if (!w) return null
  const only = attr(w[1], 'OnlyOnePerson') === 'true' ? '1' : '0'
  const adults = attr(w[2], 'NumberOfAdults') ?? '?'
  const deps = []
  for (const m of w[2].matchAll(/<DependantCover Title="([^"]+)" Covered="([^"]+)"/g)) {
    if (m[2] === 'true') deps.push(m[1])
  }
  return `${adults}|${only}|${deps.sort().join(',')}`
}

function parseProduct(s) {
  const excess = /<Excesses([^>]*)>([\s\S]*?)<\/Excesses>/.exec(s)
  const eBody = excess ? excess[2] : ''
  const corp = /<Corporate\b([^>]*)/.exec(s)
  const oaw = /<OnlyAvailableWith\b[^>]*?(?:\/>|>([\s\S]*?)<\/OnlyAvailableWith>)/.exec(s)
  const oawInner = (oaw && oaw[1] || '').trim()
  const hosp = /<HospitalCover\b([^>]*)>([\s\S]*)/.exec(s)

  const waits = {}
  for (const m of s.matchAll(/<WaitingPeriod Unit="([^"]+)"[^>]*Title="([^"]+)">(\d+)</g)) {
    waits[m[2]] = `${m[3]}${m[1][0]}`
  }
  const waivers = [...eBody.matchAll(/<Waiver>([^<]+)<\/Waiver>/g)].map(m => m[1]).sort()

  return {
    code: attr(s, 'ProductCode'),
    schema: attr(s, 'SchemaVersion'),
    fund: tag(s, 'FundCode'),
    name: tag(s, 'Name'),
    state: tag(s, 'State'),
    url: tag(s, 'ProductURL'),
    status: tag(s, 'ProductStatus'),
    premium: Number(tag(s, 'PremiumNoRebate')),
    who: whoSignature(s),
    exPerson: Number(tag(eBody, 'ExcessPerPerson') ?? 0),
    exAdmission: Number(tag(eBody, 'ExcessPerAdmission') ?? 0),
    exType: excess ? attr(excess[1], 'ExcessType') : null,
    waivers,
    copay: (/<CoPayments([^>]*)/.exec(s)?.[1] && attr(/<CoPayments([^>]*)/.exec(s)[1], 'CoPaymentType')) || 'None',
    tier: tag(s, 'HospitalTier'),
    accom: tag(s, 'Accommodation'),
    knownGap: /<ProductKnownGapCover[^>]*KnownGapCover="true"/.test(s),
    cover: coverVector(s),
    corporate: corp ? attr(corp[1], 'IsCorporate') === 'true' : false,
    corporateText: tag(s, 'CorporateText'),
    // NotApplicable = 누구나 살 수 있음. 그 외는 조건부.
    restricted: oawInner !== '' && !/^<NotApplicable/.test(oawInner),
    restrictedKind: oawInner ? (/<(\w+)/.exec(oawInner)?.[1] ?? null) : null,
    waits,
    accident: hosp ? attr(hosp[1], 'AccidentCover') === 'true' : null,
    ambulance: (/<Ambulance\b([^>]*)/.exec(s)?.[1] && attr(/<Ambulance\b([^>]*)/.exec(s)[1], 'Cover')) || null,
    premiumHospital: Number(tag(s, 'PremiumHospitalComponent') ?? tag(s, 'PremiumNoRebate')),
  }
}

// </Product> 로 끊어 읽는다. 마지막 조각은 다음 청크 앞에 붙인다.
export function parseFile(path, onProduct) {
  return new Promise((resolve, reject) => {
    let tail = ''
    let n = 0
    let declared = null
    const st = createReadStream(path, { encoding: 'utf8', highWaterMark: 4 << 20 })
    st.on('data', (chunk) => {
      if (declared === null) {
        const m = /<Products Count="(\d+)"/.exec(tail + chunk)
        if (m) declared = Number(m[1])
      }
      const buf = tail + chunk
      const parts = buf.split('</Product>')
      tail = parts.pop()
      for (const p of parts) {
        const i = p.indexOf('<Product ')
        if (i < 0) continue
        onProduct(parseProduct(p.slice(i)))
        n++
      }
    })
    st.on('end', () => resolve({ count: n, declared }))
    st.on('error', reject)
  })
}
