/**
 * TS 데이터 파일 리터럴 판독 — **sliceLiteral · evalLiteral 의 정의는 여기 한 곳이다** (S1 C3 · 2026-11-09).
 *
 * 앞판: 같은 두 함수가 `lib/magazine-load.mjs` · `magazine-qa.mjs` · `magazine-packet.mjs` 에 세 벌 있었다.
 *       본문은 세 벌 모두 같았다(이 파일은 그 본문을 그대로 옮겼다 — 동작 변경 0).
 *       load 는 같은 이름으로 다시 내보낸다(기존 import 경로 유지).
 *
 * 🔴 import 시점 부작용 0 — `node:vm` 말고 아무것도 import 하지 않는다.
 *    `magazine-load.mjs` 를 거치지 않는다: load 는 적재 순간 drafts 폴더 주입을 검사해 막히면 exit 2 로 끝난다.
 *    QA · packet 은 앞판에서 load 를 import 하지 않았으므로 그 검사를 받지 않았다 — 여기가 load 를 부르면 그 동작이 바뀐다.
 * 사본이 다시 생기는지는 `scripts/magazine-vnext-boundary-check.mjs`(R4)가 본다.
 */
import { runInNewContext } from 'node:vm'

/**
 * 객체·배열 리터럴을 문자열에서 통째로 떼어낸다.
 * 문자열 안의 괄호와 주석 안의 괄호를 세지 않는다 — 그래서 정규식이 아니라 스캐너다.
 */
export function sliceLiteral(source, fromIndex, open, close) {
  const start = source.indexOf(open, fromIndex)
  if (start === -1) return null

  let depth = 0
  let quote = null
  let i = start

  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]

    if (quote) {
      if (ch === '\\') i += 1
      else if (ch === quote) quote = null
    } else if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
    } else if (ch === '/' && next === '/') {
      i = source.indexOf('\n', i)
      if (i === -1) break
    } else if (ch === '/' && next === '*') {
      i = source.indexOf('*/', i + 2) + 1
      if (i === 0) break
    } else if (ch === open) {
      depth += 1
    } else if (ch === close) {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
    i += 1
  }
  return null
}

/**
 * 잘라낸 리터럴을 값으로 만든다. 격리된 컨텍스트에서 평가한다.
 *
 * vm.runInNewContext 를 쓰는 이유와 안전한 이유:
 *   대상은 우리 repo 의 순수 데이터 리터럴이고, 새 컨텍스트에는 전역이 하나도 없다.
 *   require · process · fetch · fs 가 없으므로 파일 접근도 네트워크 호출도 불가능하다.
 *   TS 를 JS 로 바꾸려고 빌드 도구를 새로 들이는 것보다 이쪽이 의존성이 적다.
 */
export function evalLiteral(literal, label) {
  try {
    return runInNewContext(`(${literal})`, Object.create(null), { timeout: 1000 })
  } catch (err) {
    throw new Error(`${label} 파싱 실패: ${err.message}`)
  }
}
