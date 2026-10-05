// 상품 파일 하나를 끝까지 파싱해 SchemaVersion 분포와 필드 요약을 본다.
//   node src/probe.mjs [path]     기본값: 이번 4월 병원 파일
import { parseFile } from './parse.mjs'
import { RISE, xmlPath } from './config.mjs'

const path = process.argv[2] ?? xmlPath(RISE.after, 'Hospital')
const t = Date.now()
const rows = []
const { count, declared } = await parseFile(path, r => rows.push(r))
const ms = Date.now() - t
console.log(`${path}\n${count} rows in ${(ms / 1000).toFixed(1)}s (header declared ${declared})`)
const versions = Object.create(null)
for (const r of rows) { const v = r.schema ?? 'null'; versions[v] = (versions[v] || 0) + 1 }
console.log(`  SchemaVersion:        ${Object.entries(versions).map(([v, n]) => `${v}×${n}`).join(', ')}`)
const nn = (f) => rows.filter(f).length
console.log(`  corporate:            ${nn(r => r.corporate)}`)
console.log(`  restricted (OAW):     ${nn(r => r.restricted)}`)
console.log(`  distinct coverVector: ${new Set(rows.map(r => r.cover)).size}`)
console.log(`  distinct funds:       ${new Set(rows.map(r => r.fund)).size}`)
console.log(`  distinct names:       ${new Set(rows.map(r => r.name)).size}`)
console.log(`  null premium:         ${nn(r => !Number.isFinite(r.premium))}`)
console.log(`  null who / cover:     ${nn(r => !r.who)} / ${nn(r => !r.cover)}`)
if (rows[0]) console.log(`  sample:`, JSON.stringify({ ...rows[0], cover: (rows[0].cover ?? '').slice(0, 40) + '…' }).slice(0, 420))
const bad = rows.filter(r => r.schema !== '3.1').length
if (bad) throw new Error(`SchemaVersion drift: ${bad} rows not 3.1`)
