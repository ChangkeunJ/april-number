// 합성 픽스처 생성기. 실데이터 없이 src/parse.mjs → join → build → test 경로를 돌리기 위한
// 작은 PHIO 스냅샷 세 개(March 2026, April 2026, April 2025)를 만든다.
//   node test/fixtures/gen.mjs
// 요소·속성 이름은 src/parse.mjs 의 정규식에서만 가져왔다. 출력은 결정적이다(ZIP 의 mtime 만 다르다).
import { mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA = join(HERE, 'data')

// ---- 어휘 ----
const SERVICES = ['Cataracts', 'Dental surgery', 'Heart and vascular', 'Joint replacements']
const COVER = {
  Gold: ['Covered', 'Covered', 'Covered', 'Covered'],
  Silver: ['Covered', 'Restricted', 'Covered', 'Restricted'],
  Bronze: ['Covered', 'NotCovered', 'NotCovered', 'Covered'],
  Basic: ['Restricted', 'NotCovered', 'NotCovered', 'Restricted'],
}
const WHO = {
  single: { only: true, adults: 1, deps: [] },               // 1|1|
  couple: { only: false, adults: 2, deps: [] },              // 2|0|
  family: { only: false, adults: 2, deps: ['Child', 'Student'] },   // 2|0|Child,Student
  singleParent: { only: false, adults: 1, deps: ['Child'] }, // 1|0|Child
}
const DEPS = ['Child', 'Student']

const FUNDS = [
  ['AAA', 'Alpha Health Fund', 'Open'],
  ['BBB', 'Beta &amp; Gamma Health', 'Open'],
  ['CCC', 'Coastal Care &lt;Mutual&gt;', 'Open'],
  ['DDD', 'Delta Workers Health', 'Open'],
  ['EEE', 'Epsilon Health', 'Open'],
  ['ACA', 'Restricted Fund ACA', 'Restricted'],
  ['CBH', 'Restricted Fund CBH', 'Restricted'],
  ['AHB', 'Restricted Fund AHB', 'Restricted'],
  ['AMA', 'Restricted Fund AMA', 'Restricted'],
  ['NHB', 'Restricted Fund NHB', 'Restricted'],
  ['SPE', 'Restricted Fund SPE', 'Restricted'],
  ['RBH', 'Restricted Fund RBH', 'Restricted'],
  ['NTF', 'Restricted Fund NTF', 'Restricted'],
  ['QTU', 'Restricted Fund QTU', 'Restricted'],
]

// ---- 상품 ----
// p: [y25, mar, apr] 보험료 (null = 그 스냅샷에 없음). 나머지는 기본값이 있다.
const H = [
  // 같은 상품의 세 스케일 (이력 전부 있음)
  { code: 'AAA-001', fund: 'AAA', name: 'Alpha Gold Plus', state: 'NSW', who: 'single', ex: [500, 0], tier: 'Gold', p: [190, 200, 208.30] },
  { code: 'AAA-001', fund: 'AAA', name: 'Alpha Gold Plus', state: 'NSW', who: 'couple', ex: [500, 0], tier: 'Gold', p: [380, 400, 416.60] },
  { code: 'AAA-001', fund: 'AAA', name: 'Alpha Gold Plus', state: 'NSW', who: 'family', ex: [500, 0], tier: 'Gold', p: [400, 420, 437.43] },
  { code: 'AAA-002', fund: 'AAA', name: 'Alpha Silver', state: 'VIC', who: 'single', ex: [750, 0], tier: 'Silver', p: [null, 150, 156] },
  { code: 'AAA-003', fund: 'AAA', name: 'Alpha Bronze', state: 'QLD', who: 'single', ex: [500, 0], tier: 'Bronze', p: [95, 100, 100] },          // 변동 없음
  { code: 'AAA-004', fund: 'AAA', name: 'Alpha Basic', state: 'NSW', who: 'single', ex: [750, 0], tier: 'Basic', p: [80, 80, 78] },             // 하락
  { code: 'AAA-005', fund: 'AAA', name: 'Alpha Bronze Jump', state: 'SA', who: 'single', ex: [500, 0], tier: 'Bronze', p: [90, 100, 121] },     // 20%+
  { code: 'AAA-006', fund: 'AAA', name: 'Alpha Gold Fell', state: 'VIC', who: 'couple', ex: [0, 0], tier: 'Gold', p: [null, 500, 480], waivers: [] },
  { code: 'AAA-007', fund: 'AAA', name: 'Alpha Silver Zero', state: 'SA', who: 'couple', ex: [500, 0], tier: 'Silver', p: [null, 300, 300] },    // 변동 없음
  // 엔티티
  { code: 'BBB-010', fund: 'BBB', name: 'Beta &amp; Gamma Gold', state: 'NSW', who: 'single', ex: [750, 0], tier: 'Gold', p: [200, 210, 219.45] },
  { code: 'BBB-010', fund: 'BBB', name: 'Beta &amp; Gamma Gold', state: 'NSW', who: 'couple', ex: [750, 0], tier: 'Gold', p: [400, 420, 438.90] },
  { code: 'BBB-011', fund: 'BBB', name: 'Beta Silver Plus &#8217;26', state: 'VIC', who: 'family', ex: [500, 0], tier: 'Silver', p: [null, 300, 330] },
  { code: 'BBB-012', fund: 'BBB', name: 'Beta Bronze &#x2013; Saver', state: 'QLD', who: 'single', ex: [500, 0], tier: 'Bronze', p: [null, 95, 105] },
  { code: 'BBB-013', fund: 'BBB', name: 'Beta Basic &#99999999999; Edition', state: 'NSW', who: 'single', ex: [750, 0], tier: 'Basic', p: [null, 60, 63] },
  { code: 'BBB-014', fund: 'BBB', name: 'Beta New Gold', state: 'TAS', who: 'single', ex: [500, 0], tier: 'Gold', p: [null, null, 230] },          // 3월에 없음
  // 형제 갈라짐: 3월 동가, 4월엔 single 이 더 비쌈
  { code: 'BBB-015', fund: 'BBB', name: 'Beta Sibling Silver', state: 'NSW', who: 'single', ex: [250, 0], tier: 'Silver', p: [140, 150, 160] },
  { code: 'BBB-015', fund: 'BBB', name: 'Beta Sibling Silver', state: 'NSW', who: 'singleParent', ex: [250, 0], tier: 'Silver', p: [140, 150, 155] },
  { code: 'BBB-016', fund: 'BBB', name: 'Beta Gold 15', state: 'NSW', who: 'single', ex: [500, 0], tier: 'Gold', p: [null, 100, 117] },           // 15-20%
  { code: 'BBB-017', fund: 'BBB', name: 'Beta Gold 12', state: 'NSW', who: 'single', ex: [500, 0], tier: 'Gold', p: [null, 100, 112] },           // 10-15%
  // 이상한 값들
  { code: 'CCC-020', fund: 'CCC', name: 'Coastal Gold', state: 'WA', who: 'single', ex: [500, 0], tier: 'Gold', p: [180, 190, 198.55], coverAt: [2, 'constructor'] },
  { code: 'CCC-021', fund: 'CCC', name: 'Coastal Silver', state: 'WA', who: 'single', ex: [500, 0], tier: 'Silver', p: [null, 140, 147], waitTitle: '__proto__' },
  { code: 'CCC-022', fund: 'CCC', name: 'Coastal Closed Gold', state: 'WA', who: 'single', ex: [500, 0], tier: 'Gold', p: [null, 180, 185], status: 'Closed' },
  { code: 'CCC-023', fund: 'CCC', name: 'Coastal Basic', state: 'ALL', who: 'single', ex: [750, 0], tier: 'Basic', p: [null, 70, 70], url: 'javascript:alert(1)' },
  { code: 'CCC-024', fund: 'CCC', name: 'Coastal Gold Family', state: 'WA', who: 'family', ex: [0, 0], tier: 'Gold', p: [null, 600, 630], waivers: [], url: 'not a url' },
  // 법인·가입조건부
  { code: 'DDD-030', fund: 'DDD', name: 'Delta Corporate Gold', state: 'NSW', who: 'single', ex: [500, 0], tier: 'Gold', p: [160, 170, 177.65], corp: 'Available to employees of Delta Pty Ltd &amp; their families.' },
  { code: 'DDD-031', fund: 'DDD', name: 'Delta Staff Silver', state: 'NSW', who: 'couple', ex: [500, 0], tier: 'Silver', p: [null, 260, 273], oaw: 'GeneralHealthCover' },
  { code: 'DDD-032', fund: 'DDD', name: 'Delta Bronze', state: 'ALL', who: 'single', ex: [500, 0], tier: 'Bronze', p: [null, 110, 115.5] },
  // 제한 보험사
  { code: 'ACA-040', fund: 'ACA', name: 'Restricted Gold', state: 'ALL', who: 'single', ex: [500, 0], tier: 'Gold', p: [210, 220, 233.2] },
  { code: 'NHB-060', fund: 'NHB', name: 'Restricted Silver', state: 'ALL', who: 'couple', ex: [500, 0], tier: 'Silver', p: [null, 280, 291.2] },
  // 최상단 밴드가 한 기금에 몰림
  { code: 'EEE-050', fund: 'EEE', name: 'Epsilon Gold Jump', state: 'NSW', who: 'single', ex: [500, 0], tier: 'Gold', p: [95, 100, 125] },
  { code: 'EEE-051', fund: 'EEE', name: 'Epsilon Silver Jump', state: 'NSW', who: 'single', ex: [500, 0], tier: 'Silver', p: [95, 100, 122] },
  { code: 'EEE-052', fund: 'EEE', name: 'Epsilon Basic', state: 'NT', who: 'single', ex: [750, 0], tier: 'Basic', p: [null, 50, 52] },
  { code: 'EEE-053', fund: 'EEE', name: 'Epsilon Bronze', state: 'ACT', who: 'family', ex: [500, 0], tier: 'Bronze', p: [null, 240, 249.6] },
  // 3월에만 있는 상품 (조인에서 무시된다)
  { code: 'AAA-099', fund: 'AAA', name: 'Alpha Retired Gold', state: 'NSW', who: 'single', ex: [500, 0], tier: 'Gold', p: [null, 310, null] },
]
const C = [
  { code: 'AAA-101', fund: 'AAA', name: 'Alpha Gold Extras', state: 'NSW', who: 'single', ex: [500, 0], tier: 'Gold', p: [240, 250, 260] },
  { code: 'AAA-101', fund: 'AAA', name: 'Alpha Gold Extras', state: 'NSW', who: 'couple', ex: [500, 0], tier: 'Gold', p: [480, 500, 520] },
  { code: 'AAA-102', fund: 'AAA', name: 'Alpha Combined Fell', state: 'SA', who: 'couple', ex: [500, 0], tier: 'Silver', p: [null, 400, 390] },
  { code: 'BBB-110', fund: 'BBB', name: 'Beta Combined &amp; More', state: 'VIC', who: 'single', ex: [500, 0], tier: 'Silver', p: [190, 200, 212] },
  { code: 'BBB-111', fund: 'BBB', name: 'Beta Combined New', state: 'TAS', who: 'single', ex: [500, 0], tier: 'Bronze', p: [null, null, 150] },
  { code: 'CCC-120', fund: 'CCC', name: 'Coastal Combined Basic', state: 'WA', who: 'single', ex: [750, 0], tier: 'Basic', p: [null, 90, 90] },
  { code: 'CCC-121', fund: 'CCC', name: 'Coastal Combined Sibling', state: 'NSW', who: 'single', ex: [500, 0], tier: 'Silver', p: [null, 180, 190] },
  { code: 'CCC-121', fund: 'CCC', name: 'Coastal Combined Sibling', state: 'NSW', who: 'family', ex: [500, 0], tier: 'Silver', p: [null, 180, 185] },
  { code: 'DDD-130', fund: 'DDD', name: 'Delta Corp Combined', state: 'NSW', who: 'single', ex: [500, 0], tier: 'Gold', p: [null, 300, 315], corp: 'Employees of Delta Pty Ltd only.' },
  { code: 'EEE-150', fund: 'EEE', name: 'Epsilon Combined Jump', state: 'QLD', who: 'single', ex: [500, 0], tier: 'Bronze', p: [95, 100, 130] },
  { code: 'ACA-140', fund: 'ACA', name: 'Restricted Combined', state: 'ALL', who: 'single', ex: [500, 0], tier: 'Gold', p: [null, 310, 322.4] },
]

// ---- 직렬화 ----
const guid = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`
const money = (n) => n.toFixed(2)

function product(spec, i, snap, kind) {
  const prem = spec.p[snap.i]
  if (prem == null) return null
  const w = WHO[spec.who]
  const cover = [...COVER[spec.tier]]
  if (spec.coverAt) cover[spec.coverAt[0]] = spec.coverAt[1]
  const waivers = spec.waivers ?? ['Accident']
  const url = spec.url ?? `https://example.com/${spec.code.toLowerCase()}`
  const corp = spec.corp ? `<Corporate IsCorporate="true"><CorporateText>${spec.corp}</CorporateText></Corporate>` : `<Corporate IsCorporate="false"/>`
  const oaw = spec.oaw ? `<OnlyAvailableWith><${spec.oaw}><Min>1</Min></${spec.oaw}></OnlyAvailableWith>` : `<OnlyAvailableWith><NotApplicable/></OnlyAvailableWith>`
  const waitTitle = spec.waitTitle ?? 'PreExisting'
  const hospComponent = kind === 'Combined' ? `<PremiumHospitalComponent>${money(prem * 0.7)}</PremiumHospitalComponent>` : ''
  return `<Product ProductCode="${spec.code}" ProductID="${guid(snap.pid, i)}" ProductItemID="${guid('ffffffff', i)}" SchemaVersion="3.1">` +
    `<FundCode>${spec.fund}</FundCode><Name>${spec.name}</Name><State>${spec.state}</State><ProductStatus>${spec.status ?? 'Open'}</ProductStatus>` +
    `<ProductURL>${url}</ProductURL><PremiumNoRebate>${money(prem)}</PremiumNoRebate>${hospComponent}` +
    `<WhoIsCovered OnlyOnePerson="${w.only}"><Adults NumberOfAdults="${w.adults}"/>` +
    DEPS.map(d => `<DependantCover Title="${d}" Covered="${w.deps.includes(d)}"/>`).join('') + `</WhoIsCovered>` +
    corp + oaw +
    `<HospitalCover AccidentCover="${spec.tier !== 'Basic'}"><HospitalTier>${spec.tier}</HospitalTier>` +
    `<Excesses ExcessType="PerPerson"><ExcessPerPerson>${spec.ex[0]}</ExcessPerPerson><ExcessPerAdmission>${spec.ex[1]}</ExcessPerAdmission>` +
    waivers.map(x => `<Waiver>${x}</Waiver>`).join('') + `</Excesses>` +
    `<CoPayments CoPaymentType="${spec.copay ?? 'None'}"/><Accommodation>${spec.tier === 'Basic' ? 'Shared' : 'Private'}</Accommodation>` +
    `<ProductKnownGapCover KnownGapCover="${spec.tier === 'Gold'}"/><Ambulance Cover="${spec.tier === 'Basic' ? 'EmergencyOnly' : 'Full'}"/>` +
    `<WaitingPeriods><WaitingPeriod Unit="Months" Title="${waitTitle}">12</WaitingPeriod><WaitingPeriod Unit="Days" Title="Accident">1</WaitingPeriod></WaitingPeriods>` +
    `<MedicalServices>` + SERVICES.map((s, k) => `<MedicalService Title="${s}" Cover="${cover[k]}"/>`).join('') + `</MedicalServices>` +
    `</HospitalCover></Product>`
}

function productsXml(specs, snap, kind) {
  const rows = specs.map((s, i) => product(s, i, snap, kind)).filter(Boolean)
  return `<?xml version="1.0" encoding="utf-8"?>\n<Products Count="${rows.length}">\n${rows.join('\n')}\n</Products>\n`
}
const fundsXml = () => `<?xml version="1.0" encoding="utf-8"?>\n<Funds>\n` +
  FUNDS.map(([c, n, t]) => `<Fund><FundCode>${c}</FundCode><FundName>${n}</FundName><FundType>${t}</FundType></Fund>`).join('\n') + `\n</Funds>\n`

// ---- 스냅샷 ----
const SNAPS = [
  { dir: 'april-2025', stamp: '02-Apr-2025', iso: '2025-04-02', i: 0, pid: 'a2025000' },
  { dir: 'march-2026', stamp: '01-Mar-2026', iso: '2026-03-01', i: 1, pid: 'b2026030' },
  { dir: 'april-2026', stamp: '05-Apr-2026', iso: '2026-04-05', i: 2, pid: 'c2026040' },
]
rmSync(DATA, { recursive: true, force: true })
for (const snap of SNAPS) {
  const d = join(DATA, snap.dir)
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, `Hospital Open ${snap.stamp}.xml`), productsXml(H, snap, 'Hospital'))
  writeFileSync(join(d, `Combined Open ${snap.stamp}.xml`), productsXml(C, snap, 'Combined'))
  writeFileSync(join(d, `Funds ${snap.stamp}.xml`), fundsXml())
}
// Product Changes CSV (src/idjoin.mjs 가 읽는 열만). 4월 ProductID → 3월 ProductID.
{
  const lines = ['ProductID,OLD_ProductID,Change Type,ProductCode,OLD_ProductCode,Fund']
  H.forEach((s, i) => {
    if (s.p[2] == null) return
    const old = s.p[1] == null ? '' : guid('b2026030', i)
    lines.push(`${guid('c2026040', i)},${old},${old ? 'Premium Change' : 'New Product'},${s.code},${old ? s.code : ''},${s.fund}`)
  })
  writeFileSync(join(DATA, 'april-2026', 'Product Changes 05-Apr-2026.csv'), lines.join('\n') + '\n')
}
// 잘린 파일: </Product> 가 하나도 없다 (꼬리 상한 테스트용, LIMIT_TAIL_BYTES=4096 보다 크다)
{
  const apr = readFileSync(join(DATA, 'april-2026', 'Hospital Open 05-Apr-2026.xml'), 'utf8')
  const cut = apr.split('\n').slice(0, 6).join('\n').replaceAll('</Product>', '')
  writeFileSync(join(HERE, 'truncated.xml'), cut)
}
// ZIP 두 개. python3 -m zipfile -c 는 파일 인자를 basename 으로, 디렉터리는 재귀로 넣는다.
{
  const stage = mkdtempSync(join(tmpdir(), 'april-fixture-'))
  const src = join(DATA, 'april-2026')
  const members = ['Hospital Open 05-Apr-2026.xml', 'Combined Open 05-Apr-2026.xml', 'Funds 05-Apr-2026.xml', 'Product Changes 05-Apr-2026.csv']
  writeFileSync(join(stage, 'evil.sh'), '#!/bin/sh\necho this member must never be extracted\n')
  rmSync(join(HERE, 'snapshot.zip'), { force: true })
  execFileSync('python3', ['-m', 'zipfile', '-c', join(HERE, 'snapshot.zip'), ...members, join(stage, 'evil.sh')], { cwd: src, stdio: 'pipe' })
  // dup.zip: 같은 basename 의 Hospital 파일이 루트와 sub/ 에 하나씩 → "종류당 정확히 하나" 위반
  const dup = join(stage, 'dup')
  mkdirSync(join(dup, 'sub'), { recursive: true })
  for (const m of members.slice(0, 3)) cpSync(join(src, m), join(dup, m))
  cpSync(join(src, members[0]), join(dup, 'sub', members[0]))
  rmSync(join(HERE, 'dup.zip'), { force: true })
  execFileSync('python3', ['-m', 'zipfile', '-c', join(HERE, 'dup.zip'), ...members.slice(0, 3), 'sub'], { cwd: dup, stdio: 'pipe' })
  rmSync(stage, { recursive: true, force: true })
}
console.log('fixtures written under', HERE)
