import { parseFile } from './parse.mjs'
export const key = (r) => `${r.code}|${r.state}|${r.who}|${r.exPerson}|${r.exAdmission}`

export async function load(path) {
  const m = new Map()
  await parseFile(path, r => { if (r.status === 'Open') m.set(key(r), r) })
  return m
}
export const pct = (a, b) => (b - a) / a * 100
export function median(xs) {
  const s = [...xs].sort((a, b) => a - b)
  const i = s.length >> 1
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2
}
