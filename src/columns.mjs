// index.json 의 상품 행 열 번호. site/app.js 의 F 리터럴과 글자 그대로 같아야 한다
// (app.js 는 classic script 라 import 할 수 없어 test-unit.mjs 가 정규식으로 뽑아 대조한다).
export const F = {
  fund: 0, name: 1, state: 2, who: 3, exP: 4, exA: 5, tier: 6, cover: 7, type: 8,
  prem: 9, pct: 10, before: 11, hist: 12, corp: 13, restr: 14, corpTxt: 15,
  url: 16, copay: 17, accom: 18, gap: 19, amb: 20, waiv: 21, waits: 22, sibWho: 23, sibPrem: 24,
}
export const WIDTH = Math.max(...Object.values(F)) + 1
if (WIDTH !== 25) throw new Error(`columns.mjs: WIDTH ${WIDTH} ≠ 25 — F has a gap or a duplicate`)
