/**
 * Raw Originality 레인 — 🔴 **판정과 계약만. 발행하지 않는다**
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AF
 *
 * 🔴 **이 파일이 무엇이 아닌지부터.**
 *    발행이 아니다. Raw Vault 적재가 아니다. DB write 가 아니다. LLM 호출이 아니다.
 *    목록 재고에서 **읽을 대상을 고르고**, 읽은 결과를 **사람이 판단할 형태로 줄이는** 규칙일 뿐이다.
 *
 * 🔴 **lane 과 axis 는 다른 말이다 — 섞으면 안 된다.**
 *    `lane === 'originalRaw'` 는 **목록 단계 추정**이다. 제목과 메타만 보고 매긴다.
 *    `axis === 'rawOriginality'` 는 **본문을 읽은 뒤 판정**이다(400자 이상 + 사연 축).
 *    653건은 전자다. 그중 몇 건이 후자가 될지는 **읽어봐야 안다.**
 */
import { safetyFilter, type SafetyResult, type SafetyInput } from './micro-seed-safety-filter.mjs'

/** 목록 단계 레인 — 이 레인의 재고를 연다 */
export const RAW_LANE = 'originalRaw'

/** 상세 판정 축 — 읽은 뒤 이 축이어야 검수 화면에 올라간다 */
export const RAW_AXIS = 'rawOriginality'

/** 🔴 화면에 절대 나오지 않아야 하는 문구. 발행이 아님을 매 산출물에 박는다 */
export const NOT_PUBLISH_NOTE = '발행 아님 · Raw Vault 적재 아님 · 재작성 대상 선별만'

/**
 * 사람이 고르는 세 가지. 🔴 **ADOPT · APPROVE · SEED 를 여기 두지 않는다.**
 *
 * 그 셋은 각각 초안 검수(§4-AB) · SRN 승인(§4-Z) · 소스 승인(§4-AD) 의 말이다.
 * 같은 낱말이 화면마다 다른 뜻이면 사람이 무엇을 누르는지 모르게 된다.
 * 여기서 고르는 것은 하나뿐이다 — **이 사연을 우리 글로 다시 쓸 것인가.**
 */
export const RAW_DECISIONS: readonly (readonly [string, string])[] = [
  ['RAW', '우리 말로 다시 쓴다 — 원문을 옮기는 것이 아니다'],
  ['HOLD', '판단을 미룬다 — 본문이 모자라거나 더 볼 것이 있다'],
  ['DROP', '쓰지 않는다'],
] as const

/**
 * 로컬에 남기는 본문 길이. 🔴 **전문을 저장하지 않는다.**
 *
 * 두 가지 이유가 있고, 둘 다 같은 방향을 가리킨다.
 *
 * ① **원문이 남으면 베끼게 된다.** 이 레인의 목적은 사연을 *우리 말로 다시 쓰는* 것이다.
 *    전문이 화면에 있으면 사람은 반드시 그 문장을 참고한다 — 그게 사람이라서 그렇다.
 *    앞부분만 두면 "무슨 이야기인가" 는 알 수 있고 "어떻게 썼는가" 는 남지 않는다.
 * ② 남의 글 전문을 우리 디스크에 쌓지 않는다. SRN 이 body 를 통째로 저장할 수 있는 것은
 *    그 축이 정의상 100자 미만이기 때문이다(§4-Y ④). 400자 이상에는 같은 논리가 서지 않는다.
 *
 * 🔴 요약하지 않는다 — 요약은 LLM 이고, 이 레인에 LLM 은 없다. 자르기만 한다.
 */
export const BODY_HEAD_CHARS = 300

/** 상세 판정이 rawOriginality 가 되려면 본문이 이만큼은 돼야 한다 (detail-classify 와 같은 값) */
export const RAW_MIN_BODY = 400

/**
 * 연락처·주소·링크를 지운다 — 🔴 **판단에 필요 없고, 남으면 위험한 것들.**
 *
 * 사연 판단에 전화번호가 필요한 적은 없다. 반면 남겨두면 그것이 우리 디스크에 있는
 * 남의 개인정보가 된다. 자르기 전에 지운다 — 잘린 뒤에 지우면 경계에 걸친 것을 놓친다.
 */
export function maskSensitive(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, '[링크]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[메일]')
    .replace(/\b01[016-9][-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, '[연락처]')
    .replace(/\b\d{2,4}[-.\s]\d{3,4}[-.\s]\d{4}\b/g, '[연락처]')
    .replace(/@[A-Za-z0-9_]{2,}/g, '[계정]')
}

export type BodyDigest = {
  /** 마스킹 후 앞부분만. 🔴 전문이 아니다 */
  head: string
  /** 원문 길이 — 자르기 전 값이다. 판정(400자 이상)에 쓴다 */
  length: number
  /** 잘렸는가 */
  truncated: boolean
  /** 문단 수 — 사연인지 목록글인지 가르는 데 쓴다 */
  paragraphs: number
}

/** 본문을 사람이 볼 만큼만 줄인다 — 🔴 마스킹 → 자르기 순서를 지킨다 */
export function digestBody(body: string): BodyDigest {
  const masked = maskSensitive(body)
  const chars = [...masked]
  return {
    head: chars.slice(0, BODY_HEAD_CHARS).join(''),
    length: chars.length,
    truncated: chars.length > BODY_HEAD_CHARS,
    paragraphs: masked.split(/\n\s*\n/).filter((p) => p.trim()).length,
  }
}

/** 목록 재고에서 읽을 대상을 고를 때 필요한 최소 모양 */
export type RawCandidate = {
  sourceArticleId: string
  sourceSite: string
  lane: string
  score: number
  title: string
}

/**
 * 읽을 대상 — 🔴 목록 scout 을 돌리지 않는다. 이미 가진 재고에서만 고른다.
 *
 * 순서: 레인 → 이미 읽음 제외 → 점수순 → cap.
 * 🔴 **cap 은 생산 목표가 아니라 요청 리스크 상한이다** (§4-W ③). 남았다고 더 열지 않는다.
 */
export function selectRawTargets<T extends RawCandidate>(
  rows: readonly T[], cap: number, seen: ReadonlySet<string>,
): T[] {
  return rows
    .filter((r) => r.lane === RAW_LANE)
    .filter((r) => !seen.has(r.sourceArticleId))
    .sort((a, b) => b.score - a.score)
    .slice(0, cap)
}

/**
 * 목록 단계 안전 선별 — 🔴 **읽기 전에 거른다.**
 *
 * 요청 하나하나가 계정 위험이므로, 제목만 봐도 버릴 것은 열지 않는다.
 * 🟡 다만 **생활 사연을 미리 버리지 않는다.** 가족·부부·돈·일은 이 레인의 재료다.
 *    여기서 막는 것은 정치·공인·광고·고정슬롯이지 "무거운 이야기" 가 아니다.
 */
export function prescreen(c: RawCandidate, extra: Partial<SafetyInput> = {}): SafetyResult {
  return safetyFilter({ title: c.title, ...extra })
}

/** 읽기 전 단계에서 확실히 버릴 것만 — hold 는 남긴다(읽어봐야 안다) */
export function blockedBeforeRead(r: SafetyResult): boolean {
  return r.verdict === 'hardExclude' || r.verdict === 'drop'
}

/**
 * 승인 파일 컬럼 — 🔴 **언제나 맨 뒤에만 더한다.**
 *    TSV 를 위치로 읽는 쪽이 있어 중간에 끼우면 조용히 어긋난다.
 * 🔴 `body` 전문 컬럼은 없다. `bodyHead` 뿐이다(BODY_HEAD_CHARS 참조).
 */
export const RAW_COLUMNS: readonly string[] = [
  'decision', 'sourceArticleId', 'sourceSite', 'url', 'score', 'lane', 'axis',
  'bodyLength', 'bodyHead', 'bodyTruncated', 'paragraphs',
  'imageCount', 'commentCount', 'assetAxes', 'safetyVerdict', 'safetyReasons',
  'title', 'memo', 'detailRunId', 'reviewedAt', 'note',
] as const

export type RawDecisionRow = { decision?: string; sourceArticleId?: string }

/** RAW 만 다음 단계로 간다 */
export function rawDecisions<T extends RawDecisionRow>(rows: readonly T[]): T[] {
  return rows.filter((r) => String(r.decision ?? '') === 'RAW')
}

/** HOLD 는 다시 볼 대상 — 🔴 버린 것이 아니다 */
export function heldForReread<T extends RawDecisionRow>(rows: readonly T[]): T[] {
  return rows.filter((r) => String(r.decision ?? '') === 'HOLD')
}
