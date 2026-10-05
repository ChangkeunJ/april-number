// 번역 표 검사. 영어가 기준이다: 키 집합, {x} 자리표시자, _html 키의 태그와 href 가 언어마다 같아야 하고,
// 어떤 값에도 스크립트·핸들러·javascript: 가 없어야 한다. i18n.mjs 가 쓰기 전에, smoke 가 렌더 전에 부른다.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'

const HOSTILE = [
  [/<script/i, '<script'],
  [/[\s/]on[a-z]+\s*=/i, 'on*= 핸들러'],
  [/javascript:/i, 'javascript:'],
  [/data:text\/html/i, 'data:text/html'],
  [/\sstyle\s*=/i, 'style= 속성 (CSP 가 막는다)'],
]
// _html 문구가 쓸 수 있는 태그별 속성. 그 외 태그에는 속성이 없어야 하고, 속성 이름은 대소문자를 가리지 않는다
// (브라우저는 HREF 도 href 로 읽고, 같은 이름이 둘이면 앞의 것을 쓴다 — 번역이 영어와 다른 곳으로 링크를 보낼 수 있었다).
const TAG_ATTRS = { a: ['href'], span: ['id'] }
// href 는 https 이고 이 호스트(또는 그 서브도메인)여야 한다. 번역이 새 링크를 넣는 길을 막는다.
const HREF_HOSTS = ['data.gov.au', 'creativecommons.org', 'privatehealth.gov.au', 'github.com']
const placeholders = (s) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]))].sort()
const tagNames = (s) => [...s.matchAll(/<\s*\/?\s*([a-zA-Z][a-zA-Z0-9]*)/g)].map(m => m[1].toLowerCase()).sort()
// 여는 태그마다 { tag, attrs: [[name, value]] }. 속성은 name="value" 또는 name='value' 꼴만 인정하고, 그 밖의 = 는 모양 오류다.
const tags = (s) => [...s.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g)].map(m => {
  const rest = m[2]
  const attrs = [...rest.matchAll(/([^\s"'/=<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(a => [a[1].toLowerCase(), a[2] ?? a[3]])
  const equals = (rest.match(/=/g) ?? []).length
  return { tag: m[1].toLowerCase(), rest, attrs, malformed: equals !== attrs.length || /[^\s"'/=<>]+\s*=\s*[^"'\s]/.test(rest) }
})
const hrefs = (s) => [...new Set(tags(s).flatMap(t => t.attrs.filter(([n]) => n === 'href').map(([, v]) => v)))].sort()
const hrefOk = (v) => {
  let u
  try { u = new URL(v) } catch { return false }
  if (u.protocol !== 'https:' || u.username || u.password) return false
  const h = u.hostname.toLowerCase()
  return HREF_HOSTS.some(a => h === a || h.endsWith('.' + a))
}
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

export function checkStrings(STR) {
  const errs = []
  const err = (lang, key, why) => errs.push(`${lang}/${key}: ${why}`)
  if (!STR || typeof STR !== 'object' || !STR.en || typeof STR.en !== 'object') throw new Error('STR.en 이 없다')

  // 값 하나의 자체 검사 (영어 포함, 모든 언어)
  const checkValue = (lang, key, v) => {
    if (typeof v === 'string') {
      for (const [re, why] of HOSTILE) if (re.test(v)) err(lang, key, why)
      // _html 이 아닌 값은 esc() 를 거치므로 꺾쇠가 있으면 번역이 HTML 을 넣은 것이다.
      if (!/_html$/.test(key) && /[<>]/.test(v)) err(lang, key, '_html 키가 아닌데 < 또는 > 가 있다')
      else if (/_html$/.test(key)) {
        for (const { tag, rest, attrs, malformed } of tags(v)) {
          if (malformed) err(lang, key, `<${tag}${rest}>: 속성은 name="value" 꼴이어야 한다`)
          const allowed = TAG_ATTRS[tag] ?? []
          const seen = new Set()
          for (const [name, value] of attrs) {
            if (!allowed.includes(name)) err(lang, key, `<${tag}> 에 허용되지 않은 속성 ${name}= (허용: ${allowed.join(', ') || '없음'})`)
            if (seen.has(name)) err(lang, key, `<${tag}> 에 ${name}= 이 두 번`)
            seen.add(name)
            if (name === 'href' && !hrefOk(value)) err(lang, key, `href ${JSON.stringify(value)} 는 https 이고 ${HREF_HOSTS.join('/')} 중 하나여야 한다`)
          }
        }
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => checkValue(lang, `${key}[${i}]`, x))
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) checkValue(lang, `${key}.${k}`, v[k])
    else if (v == null) err(lang, key, '값이 비었다')
  }
  // 영어와의 비교
  const compare = (lang, key, en, v) => {
    if (Array.isArray(en)) {
      if (!Array.isArray(v)) return err(lang, key, '배열이어야 한다')
      if (v.length !== en.length) return err(lang, key, `길이 ${v.length}, 영어는 ${en.length}`)
      en.forEach((x, i) => compare(lang, `${key}[${i}]`, x, v[i]))
    } else if (en && typeof en === 'object') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return err(lang, key, '객체여야 한다')
      const a = Object.keys(en), b = Object.keys(v)
      for (const k of a) if (!Object.hasOwn(v, k)) err(lang, `${key}.${k}`, '빠진 키')
      for (const k of b) if (!Object.hasOwn(en, k)) err(lang, `${key}.${k}`, '영어에 없는 키')
      for (const k of a) if (Object.hasOwn(v, k)) compare(lang, `${key}.${k}`, en[k], v[k])
    } else if (typeof en === 'string') {
      if (typeof v !== 'string') return err(lang, key, '문자열이어야 한다')
      const pa = placeholders(en), pb = placeholders(v)
      if (!same(pa, pb)) err(lang, key, `자리표시자 불일치 en={${pa}} ${lang}={${pb}}`)
      if (/_html$/.test(key)) {
        const ta = tagNames(en), tb = tagNames(v)
        if (!same(ta, tb)) err(lang, key, `태그 불일치 en=[${ta}] ${lang}=[${tb}]`)
        const ha = hrefs(en), hb = hrefs(v)
        if (!same(ha, hb)) err(lang, key, `href 불일치 en=[${ha}] ${lang}=[${hb}]`)
      }
    } else if (typeof v !== typeof en) err(lang, key, `형이 다르다 (${typeof v}, 영어는 ${typeof en})`)
  }

  for (const lang of Object.keys(STR)) {
    const S = STR[lang]
    if (!S || typeof S !== 'object') { err(lang, '', '객체가 아니다'); continue }
    if (!/^[a-z]{2}$/.test(lang)) err(lang, '', '언어 코드는 소문자 두 글자')
    if (typeof S._locale !== 'string' || !/^[a-z]{2}(-[A-Z]{2})?$/.test(S._locale)) err(lang, '_locale', 'BCP 47 형식이어야 한다')
    if (typeof S._name !== 'string' || !S._name) err(lang, '_name', '표시 이름이 없다')
    for (const k of Object.keys(S)) checkValue(lang, k, S[k])
    if (lang === 'en') continue
    for (const k of Object.keys(STR.en)) if (!Object.hasOwn(S, k)) err(lang, k, '빠진 키')
    for (const k of Object.keys(S)) if (!Object.hasOwn(STR.en, k)) err(lang, k, '영어에 없는 키')
    for (const k of Object.keys(STR.en)) if (Object.hasOwn(S, k) && k !== '_locale' && k !== '_name') compare(lang, k, STR.en[k], S[k])
    if (!Array.isArray(S.bands) || S.bands.length !== 6) err(lang, 'bands', '6개여야 한다')
  }
  if (errs.length) throw new Error(`strings-check 실패 ${errs.length}건:\n` + errs.map(e => '  ✗ ' + e).join('\n'))
  return Object.keys(STR)
}

// strings.js 를 그대로 vm 에 올려 검사한다. strings.js 는 모듈이 아니라 var STR 을 만드는 스크립트다.
export function loadStrings(path = 'site/strings.js') {
  const ctx = vm.createContext({})
  vm.runInContext(readFileSync(path, 'utf8'), ctx)
  return ctx.STR
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const site = args.includes('--site') ? args[args.indexOf('--site') + 1] : 'site'
  const langs = checkStrings(loadStrings(`${site}/strings.js`))
  console.log(`strings-check OK — ${langs.join(' ')}`)
}
