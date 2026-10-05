// data.gov.au CKAN API 와 자원 다운로드. fetch.mjs 와 (나중의) discover.mjs 가 같이 쓴다.
// 네트워크를 만지는 코드는 전부 여기 있다: 호스트 allowlist, 리다이렉트 수동 추적,
// 크기·시간 상한, 스트리밍 해시. fetchImpl 을 주입할 수 있어 로컬 서버로 테스트한다.
import { createHash } from 'node:crypto'
import { createWriteStream, renameSync, rmSync } from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { LIMITS, PKG, RISE } from './config.mjs'

export const USER_AGENT = 'april-number (+https://github.com/ChangkeunJ/april-number)'
export const API = 'https://data.gov.au/data/api/3/action/package_show'
// 자원 URL 은 날짜로 못 맞춘다(README "Rebuild"). resource.name 만 일관된다.
export const RESOURCE_RE = /^PrivateHealth\.gov\.au ((?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4})\.zip$/
const REDIRECT = new Set([301, 302, 303, 307, 308])

export function validatePackage(json, pkgId = PKG) {
  const bad = (msg) => { throw new Error(`CKAN package_show: ${msg}`) }
  if (!json || typeof json !== 'object') bad('response is not an object')
  if (json.success !== true) bad(`success=${JSON.stringify(json.success)}`)
  const pkg = json.result
  if (!pkg || typeof pkg !== 'object') bad('no result')
  if (pkg.id !== pkgId) bad(`result.id ${JSON.stringify(pkg.id)} ≠ ${pkgId}`)
  if (!Array.isArray(pkg.resources)) bad('result.resources is not an array')
  for (const r of pkg.resources) {
    if (!r || typeof r.name !== 'string' || typeof r.url !== 'string') bad('a resource lacks a string name or url')
  }
  if (pkg.license_id !== 'cc-by') {
    throw new Error(`licence changed: ${pkg.license_id} — stop and re-read the terms`)
  }
  return pkg
}

export async function packageShow({ fetchImpl = fetch, limits = LIMITS, pkgId = PKG } = {}) {
  const url = `${API}?id=${encodeURIComponent(pkgId)}`
  const r = await fetchImpl(url, {
    signal: AbortSignal.timeout(limits.apiTimeoutMs),
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
  })
  if (!r.ok) throw new Error(`CKAN ${r.status}`)
  return validatePackage(await r.json(), pkgId)
}

export function resourcesByName(pkg) {
  const by = new Map()
  for (const res of pkg.resources) {
    const m = RESOURCE_RE.exec(res.name)
    if (m) by.set(m[1], res)
  }
  return by
}

// https 이고 호스트가 allowlist 항목 자체이거나 그 서브도메인일 때만 true.
// allowInsecure 는 테스트가 로컬 http 서버를 쓸 때 명시적으로만 넘긴다(환경변수 없음).
export function allowedUrl(u, hosts = RISE.downloadHosts, { allowInsecure = false } = {}) {
  let url
  try { url = new URL(String(u)) } catch { return false }
  if (url.username || url.password) return false
  if (url.protocol !== 'https:' && !(allowInsecure && url.protocol === 'http:')) return false
  const h = url.hostname.toLowerCase()
  return hosts.some(a => { a = String(a).toLowerCase(); return h === a || h.endsWith('.' + a) })
}

// 스트리밍 다운로드. dest.part 에 쓰고 성공하면 dest 로 옮긴다. 실패하면 .part 를 지운다.
export async function download(url, dest, { fetchImpl = fetch, limits = LIMITS, hosts = RISE.downloadHosts, allowInsecure = false, log = () => {} } = {}) {
  const part = dest + '.part'
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(new Error(`download of ${url} exceeded ${limits.zipTimeoutMs} ms`)), limits.zipTimeoutMs)
  let idle = null
  const kick = () => {
    clearTimeout(idle)
    idle = setTimeout(() => ac.abort(new Error(`no data for ${limits.idleMs} ms from ${url}`)), limits.idleMs)
  }
  try {
    let u = String(url), res
    for (let hop = 0; ; hop++) {
      if (!allowedUrl(u, hosts, { allowInsecure })) {
        throw new Error(`refusing ${u}: not https on an allowlisted host (${hosts.join(', ')})`)
      }
      kick()
      res = await fetchImpl(u, { redirect: 'manual', signal: ac.signal, headers: { 'user-agent': USER_AGENT } })
      if (REDIRECT.has(res.status)) {
        const loc = res.headers.get('location')
        if (!loc) throw new Error(`${u} → ${res.status} without a Location header`)
        if (hop + 1 > limits.redirects) throw new Error(`more than ${limits.redirects} redirects starting at ${url}`)
        try { await res.body?.cancel() } catch {}
        u = new URL(loc, u).href
        log(`  redirect → ${u}`)
        continue
      }
      if (!res.ok) throw new Error(`${u} → HTTP ${res.status}`)
      if (!res.body) throw new Error(`${u} → empty body`)
      break
    }
    const sha = createHash('sha256'), md5 = createHash('md5')
    let bytes = 0
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        bytes += chunk.length
        if (bytes > limits.zipBytes) {
          const e = new Error(`${u} exceeds ${limits.zipBytes} bytes`)
          ac.abort(e)
          return cb(e)
        }
        sha.update(chunk); md5.update(chunk)
        kick()
        cb(null, chunk)
      },
    })
    kick()
    await pipeline(Readable.fromWeb(res.body), counter, createWriteStream(part, { flags: 'w' }))
    renameSync(part, dest)
    return { bytes, sha256: sha.digest('hex'), md5: md5.digest('hex'), url: u }
  } catch (e) {
    rmSync(part, { force: true })
    throw (ac.signal.aborted && ac.signal.reason instanceof Error) ? ac.signal.reason : e
  } finally {
    clearTimeout(timer); clearTimeout(idle)
  }
}
