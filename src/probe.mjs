import { parseFile } from './parse.mjs'
const path = process.argv[2]
const t = Date.now()
const rows = []
const { count, declared } = await parseFile(path, r => rows.push(r))
const ms = Date.now() - t
const bad = rows.filter(r => r.schema !== '3.1').length
console.log(`${count} rows in ${(ms/1000).toFixed(1)}s (header declared ${declared})`)
if (bad) throw new Error(`SchemaVersion drift: ${bad} rows not 3.1`)
const nn = (f) => rows.filter(f).length
console.log(`  corporate:            ${nn(r => r.corporate)}`)
console.log(`  restricted (OAW):     ${nn(r => r.restricted)}`)
console.log(`  distinct coverVector: ${new Set(rows.map(r => r.cover)).size}`)
console.log(`  distinct funds:       ${new Set(rows.map(r => r.fund)).size}`)
console.log(`  distinct names:       ${new Set(rows.map(r => r.name)).size}`)
console.log(`  null premium:         ${nn(r => !Number.isFinite(r.premium))}`)
console.log(`  null who / cover:     ${nn(r => !r.who)} / ${nn(r => !r.cover)}`)
console.log(`  sample:`, JSON.stringify({...rows[0], cover: rows[0].cover.slice(0,40)+'…'}).slice(0,420))
