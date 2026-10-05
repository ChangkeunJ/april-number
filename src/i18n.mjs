// site/strings.<lang>.json 들을 site/strings.js 의 STR.<lang> 블록으로 굳힌다.
// 런타임에 JSON 을 따로 받지 않으려고 한 파일에 넣는다. 영어 블록은 손으로 관리한다.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import vm from 'node:vm'
import { checkStrings } from './strings-check.mjs'
const src = readFileSync('site/strings.js', 'utf8')
const head = src.slice(0, src.indexOf('\nSTR.') === -1 ? src.length : src.indexOf('// ---- generated ----') === -1 ? src.length : src.indexOf('// ---- generated ----'))
const ctx = vm.createContext({}); vm.runInContext(head, ctx)
const en = ctx.STR.en
const files = readdirSync('site').filter(f => /^strings\.[a-z]{2}\.json$/.test(f)).sort()
let out = head.trimEnd() + '\n// ---- generated ---- node src/i18n.mjs 가 site/strings.<lang>.json 에서 만든다. 손으로 고치지 말 것.\n'
const STR = { en }
for (const f of files) {
  const code = f.split('.')[1]
  const j = JSON.parse(readFileSync('site/' + f, 'utf8'))
  STR[code] = j
  out += `STR.${code} = ${JSON.stringify(j)}\n`
}
// 키·자리표시자·HTML 태그·href 가 영어와 어긋나면 쓰지 않고 던진다.
checkStrings(STR)
writeFileSync('site/strings.js', out)
console.log('languages:', Object.keys(STR).join(' '))
