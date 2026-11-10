/**
 * graph control.ts 판독 — **`export const CONTROL` 텍스트 판독의 정의는 여기 한 곳이다** (S1 C5 · 2026-11-10).
 *
 * 판독 프로필 두 개를 **각자의 규칙 그대로** 둔다 — 하나로 합치지 않는다(합치면 legacy 판정이 바뀐다).
 *   parseControlText   legacy builder 프로필(graph-build · research-current · g8). 느슨하다 — 형식을 String 으로 맞춰 읽는다.
 *                      반환: { graphVersion, enabled, enabledClusters, surfaces, killSwitchTripped }
 *   parseGraphControl  엄격 프로필(direct-spec-source). 형식이 다르면 null.
 *                      반환: { graphVersion, enabled, enabledClusters, surfaces, killSwitch: { tripped } }
 * 공유하는 것은 선언 찾기·자르기(controlLiteral)와 eval 예외 처리(evalControl)뿐이다. 필드 검증은 공유하지 않는다 —
 *   getter 호출 순서 · 예외 · 비문자열 입력(Buffer · 배열 · 문자열화 객체) 동작이 두 프로필에서 앞판과 같아야 한다.
 *
 * 앞판: 같은 찾기·자르기·eval 이 `magazine-graph-build.mjs` 와 `magazine-direct-spec-source.mjs` 에 한 벌씩 있었다.
 *       두 파일은 같은 이름을 **같은 함수 그대로** 다시 내보낸다(호환 export · 경계 검사 R11).
 * 🔴 import 시점 부작용 0 — `magazine-literal.mjs` 만 import 한다(`magazine-load.mjs` 의 drafts 주입 차단을 끌어오지 않는다).
 * 🔴 판독 결함(주석 · CONTROLLER · 문자열 안 가짜 선언을 앞에서 읽는다)은 앞판 그대로다 — 고치면 판정이 바뀌므로 별도 결정이다.
 *    편집 helper(`magazine-graph-control-edit.mjs` — 토큰 단위 · 던지는 계약)는 계약이 달라 여기로 합치지 않는다.
 * 사본이 다시 생기는지는 `scripts/magazine-vnext-boundary-check.mjs`(R6 · R11 · R13~R15)가 본다.
 */
import { evalLiteral, sliceLiteral } from './magazine-literal.mjs'

/**
 * CONTROL 선언을 찾아 객체 리터럴을 잘라낸다. 앵커는 `anchorText` 에서, 자르기는 `controlText` 에서 한다 —
 * 엄격 프로필은 앞판처럼 앵커만 문자열로 찾고 자르기는 받은 값 그대로 한다(비문자열 입력 동작 · 오류 문장 보존).
 */
function controlLiteral(anchorText, controlText) {
  const anchor = anchorText.indexOf('export const CONTROL')
  if (anchor === -1) return null
  return sliceLiteral(controlText, controlText.indexOf('=', anchor), '{', '}')
}

/** 잘라낸 리터럴을 격리 평가한다. 실패는 던지지 않고 null — 리터럴이 `{` 로 시작하므로 성공 값은 언제나 객체다 */
function evalControl(literal) {
  let raw
  try { raw = evalLiteral(literal, 'control.ts') } catch { return null }
  return raw
}

/** control.ts 의 CONTROL — 구조 파서. 판독 실패는 null (호출자가 blocker 로 막는다) */
export function parseControlText(text) {
  const src = String(text ?? '')
  const literal = controlLiteral(src, src)
  if (!literal) return null
  const raw = evalControl(literal)
  if (raw === null) return null
  const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  if (!plain(raw) || typeof raw.enabled !== 'boolean' || !Array.isArray(raw.enabledClusters)) return null
  if (!plain(raw.surfaces) || !plain(raw.killSwitch) || typeof raw.killSwitch.tripped !== 'boolean') return null
  return {
    graphVersion: String(raw.graphVersion ?? ''),
    enabled: raw.enabled,
    enabledClusters: [...raw.enabledClusters].map(String),
    surfaces: Object.fromEntries(Object.entries(raw.surfaces).map(([k, v]) => [k, v === true])),
    killSwitchTripped: raw.killSwitch.tripped,
  }
}

/**
 * control.ts 의 `export const CONTROL = {…}` 를 **구조 파서**(sliceLiteral + evalLiteral)로 읽는다.
 * 🔴 정상 TypeScript 리터럴(여러 줄 · 끝 쉼표 · 주석)은 한 줄 판과 같은 값으로 읽고,
 *    파싱 불가 · 필드 누락 · 형식 오류는 **던지지 않고** null 이다 — 호출자가 PRODUCT_BASIS_UNREADABLE 로 막는다.
 */
export function parseGraphControl(controlText) {
  const literal = controlLiteral(String(controlText ?? ''), controlText)
  if (!literal) return null
  const raw = evalControl(literal)
  if (raw === null) return null
  const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  if (!isPlain(raw)) return null
  const { graphVersion, enabled, enabledClusters, surfaces, killSwitch } = raw
  if (typeof graphVersion !== 'string' || !graphVersion.trim()) return null
  if (typeof enabled !== 'boolean') return null
  if (!Array.isArray(enabledClusters) || !enabledClusters.every((c) => typeof c === 'string' && c.trim())) return null
  if (!isPlain(surfaces) || !Object.values(surfaces).every((v) => typeof v === 'boolean')) return null
  if (!isPlain(killSwitch) || typeof killSwitch.tripped !== 'boolean') return null
  // 🔴 격리 컨텍스트의 객체를 이 컨텍스트의 평범한 값으로 옮긴다
  return {
    graphVersion,
    enabled,
    enabledClusters: [...enabledClusters],
    surfaces: Object.fromEntries(Object.entries(surfaces)),
    killSwitch: { tripped: killSwitch.tripped },
  }
}
