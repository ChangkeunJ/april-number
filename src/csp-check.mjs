// site/index.html 의 CSP meta 가 인라인 <script>/<style> 본문의 sha256 과 맞는지 본다.
// 테마 스크립트나 스타일 블록을 한 글자라도 고치면 해시가 바뀐다 — 틀리면 올바른 meta 줄을 찍는다.
// 그리고 CSP 가 막을 것들(style= 속성, on*= 핸들러, javascript:, 외부 리소스)이 없는지도 본다.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const args = process.argv.slice(2)
const site = args.includes('--site') ? args[args.indexOf('--site') + 1] : 'site'
const html = readFileSync(`${site}/index.html`, 'utf8')
const app = readFileSync(`${site}/app.js`, 'utf8')

// 브라우저는 여는 태그 뒤부터 닫는 태그 앞까지의 바이트(UTF-8) 그대로를 해시한다. 앞뒤 줄바꿈 포함.
const h = (s) => 'sha256-' + createHash('sha256').update(s, 'utf8').digest('base64')
const blocks = (tag) => [...html.matchAll(new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'))]
  .filter(m => !/\ssrc\s*=/.test(m[1] ?? '')).map(m => m[2])
const scriptHashes = blocks('script').map(h)
const styleHashes = blocks('style').map(h)

const problems = []
const metaRe = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/
const meta = html.match(metaRe)
if (!meta) problems.push('CSP meta 가 없다')
const policy = Object.fromEntries((meta?.[1] ?? '').split(';').map(s => s.trim()).filter(Boolean)
  .map(s => { const [name, ...v] = s.split(/\s+/); return [name, v] }))
const want = {
  'script-src': ["'self'", ...scriptHashes.map(x => `'${x}'`)],
  'style-src': styleHashes.map(x => `'${x}'`),
}
for (const [dir, vals] of Object.entries(want)) {
  const have = policy[dir] ?? []
  for (const v of vals) if (!have.includes(v)) problems.push(`${dir} 에 ${v} 가 없다`)
  for (const v of have) if (!vals.includes(v)) problems.push(`${dir} 의 ${v} 는 어떤 인라인 블록과도 맞지 않는다`)
  for (const bad of ["'unsafe-inline'", "'unsafe-eval'"]) if (have.includes(bad)) problems.push(`${dir} 에 ${bad}`)
}
for (const dir of ['default-src', 'connect-src', 'base-uri', 'object-src', 'form-action']) if (!policy[dir]) problems.push(`${dir} 가 없다`)
if (policy['report-uri'] || policy['report-to']) problems.push('report-uri/report-to 는 쓰지 않는다 (비콘 없음)')
if (!/<meta name="referrer" content="no-referrer">/.test(html)) problems.push('referrer meta 가 없다')
if (problems.length && meta) {
  // 올바른 meta 줄. 해시만 바뀐 경우 이 줄을 그대로 붙여 넣으면 된다.
  const fixed = { ...policy, ...want }
  const line = `<meta http-equiv="Content-Security-Policy" content="${Object.entries(fixed).map(([k, v]) => [k, ...v].join(' ')).join('; ')}">`
  problems.push(`올바른 meta:\n${line}`)
}

// index.html 본문: 인라인 스타일·핸들러·javascript:·외부 리소스 없음
const body = html.replace(/<style(\s[^>]*)?>[\s\S]*?<\/style>/g, '').replace(/<script(\s[^>]*)?>[\s\S]*?<\/script>/g, '')
if (/\sstyle\s*=\s*["']/i.test(body)) problems.push('index.html 에 style= 속성')
if (/\son[a-z]+\s*=/i.test(body)) problems.push('index.html 에 on*= 핸들러')
if (/javascript:/i.test(html)) problems.push('index.html 에 javascript:')
for (const m of html.matchAll(/\s(src|href)\s*=\s*["']([^"']*)["']/gi)) {
  if (/^(\/\/|[a-z][a-z0-9+.-]*:)/i.test(m[2])) problems.push(`index.html 의 외부 ${m[1]}: ${m[2]}`)
}

// app.js: 인라인 스타일·eval 류·window.__ 전역 없음
for (const [re, why] of [
  [/style\s*=\s*["']/, 'style= 속성'],
  [/setAttribute\(\s*['"]style['"]/, "setAttribute('style')"],
  [/\beval\s*\(/, 'eval()'],
  [/new\s+Function\b/, 'new Function'],
  [/document\.write/, 'document.write'],
  [/window\.__/, 'window.__ 전역'],
  [/javascript:/i, 'javascript:'],
]) if (re.test(app)) problems.push(`app.js 에 ${why}`)

if (problems.length) { console.error('csp-check 실패:\n' + problems.map(p => '  ✗ ' + p).join('\n')); process.exit(1) }
console.log(`csp-check OK — 인라인 script ${scriptHashes.length}개, style ${styleHashes.length}개 해시 일치`)
