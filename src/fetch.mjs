// data.gov.au 에서 필요한 스냅샷 ZIP 만 받아 Hospital/Combined Open XML, Funds XML,
// Product Changes CSV 를 꺼낸다.
// 자원 URL 은 날짜로 못 맞춘다. 73개 중 8개가 어떤 URL 정규식도 깨뜨린다
// (privatehealth-01-aug-2026.zip / privatehealth-05-apr-2026.zip /
//  privatehealth.gov.au-april-2022.zip). resource.name 만 일관된다.
//
// snapshots.json 이 받은 ZIP 과 멤버의 sha256 을 기록한다(trust-on-first-use: 깨끗한
// 클론의 첫 실행이 채운다). 멤버가 전부 있고 해시가 맞으면 "verified" 로 건너뛴다 —
// 이것이 CI 캐시를 믿을 수 있는 근거다. 매니페스트에 있는 ZIP 해시와 다른 것이 내려오면
// 멈춘다(재발행 또는 손상). 추출이 끝나면 ZIP 은 지운다(캐시 절반).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, mkdirSync, existsSync, rmSync, lstatSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA, MANIFEST, MANIFEST_FILE, LIMITS, RISE, XML_RE, CSV_RE, slug, snapshotDir, wantedSnapshots, saveManifest } from './config.mjs'
import { packageShow, resourcesByName, download } from './ckan.mjs'

const MiB = 1 << 20
const KINDS = ['Hospital Open', 'Combined Open', 'Funds']

export function hashFile(path) {
  return new Promise((resolve, reject) => {
    const sha = createHash('sha256'), md5 = createHash('md5')
    let bytes = 0
    createReadStream(path)
      .on('data', (c) => { bytes += c.length; sha.update(c); md5.update(c) })
      .on('end', () => resolve({ bytes, sha256: sha.digest('hex'), md5: md5.digest('hex') }))
      .on('error', reject)
  })
}

// 매니페스트의 멤버들이 디렉터리에 전부 있고 크기·sha256 이 맞는가.
export async function verifySnapshot(name, { manifest = MANIFEST, dataDir = DATA } = {}) {
  const entry = manifest.resources?.[name]
  const members = entry?.members
  if (!members || typeof members !== 'object') return false
  const files = Object.keys(members)
  for (const kind of KINDS) if (!files.some(f => XML_RE.exec(f)?.[1] === kind)) return false
  const dir = snapshotDir(name, dataDir)
  if (!existsSync(dir)) return false
  // 매니페스트에 없는 멤버 모양의 파일이 남아 있으면(지난 판의 다른 스탬프) 다시 추출해 디렉터리를 정리한다
  for (const f of readdirSync(dir)) if ((XML_RE.test(f) || CSV_RE.test(f)) && !Object.hasOwn(members, f)) return false
  for (const f of files) {
    const p = join(dir, f)
    // lstat: 심링크·디렉터리·특수 파일은 멤버가 아니다 (stat/hash 는 링크를 따라가 버린다). 다시 추출해 디렉터리를 지운다.
    const st = lstatSync(p, { throwIfNoEntry: false })
    if (!st || !st.isFile()) return false
    const want = members[f]
    if (!want || st.size !== want.size) return false
    if ((await hashFile(p)).sha256 !== want.sha256) return false
  }
  return true
}

const unzip = (args, maxBuffer = 16 * MiB) => {
  try {
    return execFileSync('unzip', args, { stdio: 'pipe', maxBuffer, encoding: 'utf8' })
  } catch (e) {
    const err = (e.stderr || e.stdout || e.message || '').toString().trim().split('\n')[0]
    throw new Error(`unzip ${args[0]} failed: ${err}`)
  }
}
// unzip 은 멤버 인자를 와일드카드로 해석한다. 정확한 이름을 넘기려면 이스케이프한다.
const literal = (s) => s.replace(/[\\*?[\]]/g, '\\$&')
const base = (s) => { const n = s.replace(/\\/g, '/'); return n.slice(n.lastIndexOf('/') + 1) }

// ZIP 을 검사하고 필요한 멤버만 dir 에 꺼낸다. 반환: { members: { name: { size, sha256 } }, stamp }
export async function extractSnapshot(zip, dir, { limits = LIMITS, log = () => {} } = {}) {
  if (!existsSync(zip)) throw new Error(`${zip}: no such file`)
  const list = unzip(['-Z1', zip]).split('\n').filter(l => l.length > 0)
  if (list.length > limits.entries) throw new Error(`${zip}: ${list.length} entries, limit ${limits.entries}`)

  const byKind = Object.create(null)
  const csvs = []
  for (const full of list) {
    const b = base(full)
    const x = XML_RE.exec(b)
    if (x) (byKind[x[1]] ??= []).push(full)
    else if (CSV_RE.test(b)) csvs.push(full)
  }
  for (const kind of KINDS) {
    const hits = byKind[kind] ?? []
    if (hits.length !== 1) throw new Error(`${zip}: expected exactly one "${kind} DD-Mon-YYYY.xml", found ${hits.length}${hits.length ? ': ' + hits.join(', ') : ''}`)
  }
  if (csvs.length > 1) throw new Error(`${zip}: ${csvs.length} "Product Changes" CSVs, expected at most one`)
  const wanted = [...KINDS.map(k => byKind[k][0]), ...csvs]
  // 멤버 전체 이름이 unzip 인자로 간다. '-' 로 시작하면 unzip 이 옵션으로 읽는다 ("-d<경로>/Funds ….xml" 은 추출 위치를 바꾼다).
  for (const w of wanted) if (w.startsWith('-')) throw new Error(`${zip}: member name ${JSON.stringify(w)} starts with "-" — refusing (unzip would read it as an option)`)
  const stamps = new Set(KINDS.map(k => XML_RE.exec(base(byKind[k][0]))[2]))
  if (stamps.size !== 1) throw new Error(`${zip}: XML members carry different stamps: ${[...stamps].join(', ')}`)
  const stamp = [...stamps][0]

  // 선언된 크기. 실제 크기는 추출 뒤 다시 잰다.
  const declared = new Map()
  let inTable = false
  for (const line of unzip(['-l', zip]).split('\n')) {
    if (/^-{5,}/.test(line)) { if (inTable) break; inTable = true; continue }
    if (!inTable) continue
    const m = /^\s*(\d+)\s+\S+\s+\S+\s{2,}(.*)$/.exec(line)
    if (m) declared.set(m[2], Number(m[1]))
  }
  let total = 0
  for (const w of wanted) {
    const n = declared.get(w)
    if (n === undefined) throw new Error(`${zip}: could not read the declared size of "${w}"`)
    if (n > limits.memberBytes) throw new Error(`${zip}: "${w}" declares ${n} bytes, limit ${limits.memberBytes}`)
    total += n
  }
  if (total > limits.totalBytes) throw new Error(`${zip}: wanted members declare ${total} bytes in total, limit ${limits.totalBytes}`)

  // 디렉터리는 ZIP 에서만 파생된다. 지난 판의 다른 스탬프 파일이 남으면 xmlPath 가 둘을 본다.
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  // -d 는 ZIP 보다 앞에 둔다. unzip 은 첫 -d 만 쓰므로 뒤의 멤버 인자가 옵션처럼 보여도 추출 위치를 못 바꾼다.
  unzip(['-o', '-j', '-d', dir, zip, ...wanted.map(literal)])

  const members = {}
  for (const w of wanted) {
    const b = base(w)
    const p = join(dir, b)
    // lstat 으로 본다: unzip 은 심링크 항목을 심링크로 복원하고, stat/hash/read 는 전부 링크를 따라간다 (/dev/zero 면 영원히 읽는다).
    const st = lstatSync(p, { throwIfNoEntry: false })
    if (!st) throw new Error(`${zip}: "${w}" was not extracted`)
    if (!st.isFile()) { rmSync(dir, { recursive: true, force: true }); throw new Error(`${zip}: "${w}" is not a regular file (symlink or special entry) — refusing`) }
    const size = st.size
    if (size > limits.memberBytes) { rmSync(p, { force: true }); throw new Error(`${zip}: "${w}" is ${size} bytes after extraction, limit ${limits.memberBytes}`) }
    members[b] = { size, sha256: (await hashFile(p)).sha256 }
  }
  log(`  extracted ${wanted.length} members (${(total / 1e6).toFixed(0)} MB)`)
  return { members, stamp }
}

// CKAN resource.hash 는 보통 "" 이고, 있으면 md5 나 "md5:"/"sha256:" 접두가 붙을 수 있다.
function checkCkanHash(name, hash, got) {
  if (typeof hash !== 'string' || hash.trim() === '') return 'none'
  const h = hash.trim().replace(/^(md5|sha256):/i, '').toLowerCase()
  if (/^[0-9a-f]{32}$/.test(h)) {
    if (h !== got.md5) throw new Error(`${name}: CKAN md5 ${h} ≠ downloaded ${got.md5} — download corrupted or resource changed`)
    return 'md5'
  }
  if (/^[0-9a-f]{64}$/.test(h)) {
    if (h !== got.sha256) throw new Error(`${name}: CKAN sha256 ${h} ≠ downloaded ${got.sha256} — download corrupted or resource changed`)
    return 'sha256'
  }
  return `unrecognised (${hash.slice(0, 20)})`
}

export async function fetchAll({
  names = wantedSnapshots(), fetchImpl = fetch, log = console.log,
  manifest = MANIFEST, manifestFile = MANIFEST_FILE, dataDir = DATA,
  limits = LIMITS, hosts = RISE.downloadHosts, allowInsecure = false, keepZip = false,
} = {}) {
  mkdirSync(dataDir, { recursive: true })
  manifest.resources ??= {}
  let byName = null  // 전부 verified 면 네트워크를 전혀 안 쓴다
  for (const name of names) {
    const dir = snapshotDir(name, dataDir)
    if (await verifySnapshot(name, { manifest, dataDir })) { log(`${name}: verified`); continue }

    if (!byName) byName = resourcesByName(await packageShow({ fetchImpl, limits }))
    const res = byName.get(name)
    if (!res) throw new Error(`no resource named "PrivateHealth.gov.au ${name}.zip"`)
    const entry = manifest.resources[name] ?? {}
    const zip = join(dataDir, `${slug(name)}.zip`)

    let got
    if (!existsSync(zip)) {
      log(`${name}: downloading ${Number.isFinite(res.size) ? (res.size / 1e6).toFixed(0) + ' MB' : 'unknown size'} from ${res.url}`)
      got = await download(res.url, zip, { fetchImpl, limits, hosts, allowInsecure, log })
    } else {
      log(`${name}: using ${zip} left by an earlier run`)
      got = await hashFile(zip)
    }
    if (typeof entry.sha256 === 'string' && entry.sha256 !== '' && entry.sha256 !== got.sha256) {
      rmSync(zip, { force: true })
      throw new Error(`${name}: zip sha256 ${got.sha256} differs from snapshots.json (${entry.sha256}) — publisher republished or download corrupted; run \`node src/discover.mjs --refresh "${name}"\` to accept deliberately`)
    }
    let hashMode
    try { hashMode = checkCkanHash(name, res.hash, got) } catch (e) { rmSync(zip, { force: true }); throw e }
    if (Number.isFinite(res.size) && res.size !== got.bytes) log(`${name}: warning — CKAN size ${res.size} ≠ downloaded ${got.bytes} (CKAN size is often stale)`)
    log(`${name}: sha256 ${got.sha256} (CKAN hash: ${hashMode})`)

    const { members, stamp } = await extractSnapshot(zip, dir, { limits, log })
    manifest.resources[name] = {
      id: res.id ?? null, url: res.url, size: Number.isFinite(res.size) ? res.size : null,
      ckanHash: typeof res.hash === 'string' ? res.hash : '', last_modified: res.last_modified ?? null,
      stamp, sha256: got.sha256, members,
    }
    saveManifest(manifest, manifestFile)
    if (!keepZip) rmSync(zip, { force: true })
    log(`${name}: ${Object.keys(members).join(', ')}`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fetchAll().catch(e => { console.error(e.message); process.exit(1) })
}
