/**
 * 🔴 **Persona 정확 나이·birth anchor 최종표** (read-only · DB write 0 · 네트워크 0).
 *
 *   Pool 정본 문서의 `ageBand` 만 읽어 **결정적으로** 유도한다.
 *   운영 DB 를 읽지도 쓰지도 않는다 — 이 표는 코드와 문서만으로 재현된다.
 *
 *   npm run persona:birth-anchors
 */
import { readFileSync } from 'node:fs'
import { parsePoolDoc } from '../src/lib/persona-pool-card'
import { exactAgeOf, checkLifeConsistency } from '../src/lib/persona-birth-anchor'

const DOC = 'docs/operations/2026-08-30-persona-pool-design.md'
const TODAY = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)
const doc = parsePoolDoc(readFileSync(DOC, 'utf-8'))

console.log('\n══ Persona birth anchor 최종표 (정본: Pool 카드의 `birthDate` 줄) ══\n')
console.log(`  정본: ${DOC} · 카드 ${doc.cards.length}명 · 오늘(KST) ${TODAY}`)
console.log('  🔴 DB 를 읽지 않았다. 이 표는 문서와 규칙만으로 재현된다.\n')
console.log('  code  ageBand        birthDate     오늘 나이  밴드 안  생활사 모순')
console.log('  ' + '─'.repeat(70))

let ok = 0
let bad = 0
for (const c of doc.cards) {
  const age = exactAgeOf({ birthDate: c.birthDate, ageBand: c.ageBand, onKstDate: TODAY })
  const probs = age.ok
    ? checkLifeConsistency({
      age: age.age, ageBand: c.ageBand,
      childrenAgeBands: c.childrenAgeBands, childrenCount: c.childrenCount,
      maritalStatus: c.maritalStatus, menopauseStatus: c.menopauseStatus,
      parentCare: c.parentCare, workStatus: c.workStatus,
    })
    : []
  const inBand = age.ok ? '✅' : `🔴 ${age.code}`
  const lifeMark = probs.length === 0 ? '없음' : `🔴 ${probs.map((x) => x.axis).join(',')}`
  if (age.ok && probs.length === 0) ok += 1
  else bad += 1
  console.log(`  ${c.code.padEnd(5)} ${String(c.ageBand).padEnd(14)} ${c.birthDate.padEnd(13)}`
    + ` ${(age.ok ? String(age.age) : '-').padStart(8)}  ${inBand.padEnd(8)} ${lifeMark}`)
}
console.log('  ' + '─'.repeat(70))
console.log(`  ✅ ${ok}명 정합 · ${bad > 0 ? `🔴 ${bad}명 문제` : '문제 0명'}\n`)

console.log('🔴 **운영 DB 적용은 하지 않았다.** 이 값은 코드가 그때그때 계산한다 —')
console.log('   `Persona.identity` 에 쓸 필요가 없고, 그래서 migration 도 25명 일괄 write 도 없다.')
console.log('🔴 정본은 **Pool 카드의 `birthDate` 줄 한 곳**이다. 해시로 유도하지 않는다 —')
console.log('   규칙 판이나 ageBand 가 바뀌어도 같은 사람의 생일은 그대로여야 한다.')
console.log('🔴 birth anchor 자체는 글에 나오지 않는다. 나오는 것은 계산된 나이뿐이다.\n')
