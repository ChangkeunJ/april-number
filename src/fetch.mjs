// data.gov.au 에서 필요한 스냅샷 ZIP 만 받아 Hospital/Combined Open XML 을 꺼낸다.
// 자원 URL 은 날짜로 못 맞춘다. 73개 중 8개가 어떤 URL 정규식도 깨뜨린다
// (privatehealth-01-aug-2026.zip / privatehealth-05-apr-2026.zip /
//  privatehealth.gov.au-april-2022.zip). resource.name 만 일관된다.
import { execFileSync } from 'node:child_process'
import { mkdirSync, existsSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const PKG = '8ab10b1f-6eac-423c-abc5-bbffc31b216c'
const DATA = new URL('../data/', import.meta.url).pathname

// 보험료는 4월 인상 사이에 움직이지 않는다(2026-08 vs 2026-04: 공통 상품
// 29,268건 중 가격이 바뀐 게 0건). 그래서 4월 스냅샷과 인상 직전 3월 하나면 된다.
export const WANTED = [
  'April 2022', 'April 2023', 'April 2024', 'April 2025', 'April 2026',
  'March 2026',
]

const slug = (s) => s.toLowerCase().replace(/\s+/g, '-')

async function main() {
  mkdirSync(DATA, { recursive: true })
  const r = await fetch(`https://data.gov.au/data/api/3/action/package_show?id=${PKG}`)
  if (!r.ok) throw new Error(`CKAN ${r.status}`)
  const pkg = (await r.json()).result

  if (pkg.license_id !== 'cc-by') {
    throw new Error(`licence changed: ${pkg.license_id} — stop and re-read the terms`)
  }

  const byName = new Map()
  for (const res of pkg.resources) {
    const m = /^PrivateHealth\.gov\.au (\w+ \d{4})\.zip$/.exec(res.name)
    if (m) byName.set(m[1], res)
  }

  for (const want of WANTED) {
    const res = byName.get(want)
    if (!res) throw new Error(`no resource named "PrivateHealth.gov.au ${want}.zip"`)
    const dir = join(DATA, slug(want))
    if (existsSync(dir) && readdirSync(dir).some(f => f.endsWith('.xml'))) {
      console.log(`${want}: already extracted`)
      continue
    }
    mkdirSync(dir, { recursive: true })
    const zip = join(DATA, `${slug(want)}.zip`)
    if (!existsSync(zip)) {
      process.stdout.write(`${want}: downloading ${(res.size / 1e6).toFixed(0)} MB ... `)
      const b = await fetch(res.url)
      if (!b.ok) throw new Error(`${res.url} → ${b.status}`)
      writeFileSync(zip, Buffer.from(await b.arrayBuffer()))
      console.log('ok')
    }
    // 두 멤버만 꺼낸다. 전체 압축 해제는 연간 1.7 GB 다.
    execFileSync('unzip', ['-o', '-j', zip, 'Hospital Open*.xml', 'Combined Open*.xml', 'Funds*.xml', '-d', dir],
      { stdio: 'pipe' })
    console.log(`${want}: ${readdirSync(dir).join(', ')}`)
  }
}
main().catch(e => { console.error(e.message); process.exit(1) })
