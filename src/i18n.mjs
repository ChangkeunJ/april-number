// site/strings.<lang>.json 들을 site/strings.js 의 STR.<lang> 블록으로 굳힌다.
// 런타임에 JSON 을 따로 받지 않으려고 한 파일에 넣는다. 영어 블록은 손으로 관리한다.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import vm from 'node:vm'
const src = readFileSync('site/strings.js', 'utf8')
const head = src.slice(0, src.indexOf('\nSTR.') === -1 ? src.length : src.indexOf('// ---- generated ----') === -1 ? src.length : src.indexOf('// ---- generated ----'))
const ctx = vm.createContext({}); vm.runInContext(head, ctx)
const en = ctx.STR.en
const files = readdirSync('site').filter(f => /^strings\.[a-z]{2}\.json$/.test(f)).sort()
let out = head.trimEnd() + '\n// ---- generated ---- node src/i18n.mjs 가 site/strings.<lang>.json 에서 만든다. 손으로 고치지 말 것.\n'
for (const f of files) {
  const code = f.split('.')[1]
  const j = JSON.parse(readFileSync('site/' + f, 'utf8'))
  const missing = Object.keys(en).filter(k => !(k in j)), extra = Object.keys(j).filter(k => !(k in en))
  if (missing.length || extra.length) throw new Error(`${f}: missing ${missing} extra ${extra}`)
  out += `STR.${code} = ${JSON.stringify(j)}\n`
}
writeFileSync('site/strings.js', out)
console.log('languages:', ['en', ...files.map(f => f.split('.')[1])].join(' '))
