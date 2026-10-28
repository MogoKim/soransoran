#!/usr/bin/env tsx
/**
 * Persona 닉네임 후보 정책 · 확장 fixture — 🔴 네트워크 · DB · LLM 없음 (2026-10-18)
 *
 * 🔴 **합성 문자열만 쓴다.** 실회원 닉네임 · 크롤 author 를 fixture 에 넣지 않는다.
 *
 * 검사 항목:
 *   ① 자연어 단일 문화 복구 감지 (source scan)
 *   ② 정책 검사기가 AI·운영자·식별 마커를 잡는다
 *   ③ P34-P43 모든 생성 후보가 정책을 통과한다
 *   ④ P34-P43 dry-run — 빈 충돌 집합으로 10개 서로 다른 이름
 *   ⑤ assignCandidates: 전부 막히면 fail-closed
 *   ⑥ assignCandidates: within-cohort 중복 차단
 *   ⑦ isTaken(합성 회원 이름) 이 막으면 대체 배정
 *   ⑧ isTaken(합성 Persona 이름) 이 막으면 대체 배정
 *   ⑨ 결정론: 같은 코드는 같은 후보 순서
 *   ⑩ 기존 P01 코드도 후보를 받는다 (기존 30명 함수 계약 유지)
 *   ⑪ 크롤 작가 대조 신호 부재 확인 · 계약 보고
 *   ⑫ P34-P43 기본 10명 분포 — 갈래 H4·HD2·L2·LD2 · 영문 포함 4 · 숫자 포함 4 · 시적 명사 0 · 반복 리듬 1 ·
 *      길이 3자×1·4자×5·5자×2·7자×2 · 유의어 쌍 0 · 한글+영문 혼합 0
 *   ⑬ 인공어 · 실명형 항목(다사다사 · 소담 · 다솜 · 가온 · 단비)과 거절된 옛 기본 이름이 후보에 없다
 *   ⑭ fixture 표시명 = 빈 충돌 집합 기본 배정 (어긋나면 활성화 mapping 이 다른 이름을 싣는다)
 *   ⑮ live 충돌이 짧은 이름을 다 막아도 쏠린 묶음을 만들지 않는다 — 길이·리듬·갈래·영문·숫자·시적 상한 · 유의어 fail-closed
 *   ⑯ 섞인 형식 정책 — 유효 예(전부 갈래 있음) · 무효 예(숫자만·5연속·허용 밖 문자·4연속·한글+영문 혼합·AI/운영자/브랜드) · rain/mailbox 오탐 없음
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  candidatesFor,
  assignCandidates,
  verifyNamePolicy,
  isRepeatedRhythm,
  nameLaneOf,
  isPoeticName,
  NAME_LENGTH,
} from '../src/lib/persona-nickname-candidates'
import { COHORTS } from '../src/lib/persona-cohort'

const HERE = dirname(fileURLToPath(import.meta.url))
const CANDIDATES_SRC = readFileSync(join(HERE, '../src/lib/persona-nickname-candidates.ts'), 'utf-8')

const D20_CODES = ['P34', 'P35', 'P36', 'P37', 'P38', 'P39', 'P40', 'P41', 'P42', 'P43'] as const
const FIXTURE = JSON.parse(readFileSync(join(HERE, '__fixtures__/persona-expansion-canary.json'), 'utf-8')) as {
  candidates: Array<{ code: string; displayName: string }>
}
/** 🔴 독립 판정용 — 생성기 상수를 빌려 쓰지 않는다(빌리면 상수를 지운 변이를 못 잡는다) */
const SYNONYM_ORACLE: readonly (readonly string[])[] = [
  ['도란도란', '오손도손', '소곤소곤', '조용조용'],
  ['이것저것', '요리조리'],
]
const ARTIFICIAL_OR_REAL_NAME = ['다사다사', '소담', '다솜', '가온', '단비']
/** 🔴 거절된 첫 기본 이름 — 영어 살림·사물 묶음(cloud9bed · teacup03 · porch · sunday) · 지어낸 직업 사실(야근7일차) */
const REJECTED_CODED_NAMES = ['cloud9bed', 'teacup03', 'porch', 'sunday', '야근7일차']
/** 🔴 옛 큐레이션 한글 묶음 — 후보 공간엔 남아 있어도 기본 배정·fixture 에 오르면 안 된다 */
const REJECTED_CURATED_DEFAULTS = ['인절미', '부침개', '따끈따끈', '소곤소곤']

const report: Array<{ ok: boolean; kind: string; name: string; detail: string }> = []
const failures: string[] = []
const ok = (name: string, kind: string, detail: string): void => { report.push({ ok: true, kind, name, detail }) }
const bad = (name: string, kind: string, detail: string): void => {
  report.push({ ok: false, kind, name, detail })
  failures.push(`${name} — ${detail}`)
}

// ─── ① 자연어 단일 문화 복구 감지 (source scan) ─────────────────
{
  // HEAD1 이 옛 자연어 단일 문화(봄,밤,새,들,물,달,별,산,풀,잎,흙,솔,눈,비,꽃,숲,볕,늘,옹,함)로
  // 돌아가지 않았는가 — 일상어 머리가 충분히 있어야 한다
  const EVERYDAY_CHARS = ['글', '책', '차', '집', '밥', '길', '빛', '품', '꿈', '참']
  const m = /const HEAD1[^=]+=\s*\[([\s\S]+?)\]/.exec(CANDIDATES_SRC)
  if (!m) {
    bad('HEAD1 소스 파싱', 'source', '🔴 HEAD1 배열을 소스에서 찾지 못했다')
  } else {
    const head1Chars = (m[1].match(/'([^']+)'/g) ?? []).map((s) => s.replace(/'/g, ''))
    const everydayCount = EVERYDAY_CHARS.filter((c) => head1Chars.includes(c)).length
    if (everydayCount < 4) {
      bad('HEAD1 자연어 단일 문화', 'source',
        `🔴 일상어 머리 ${everydayCount}개 < 최소 4 — 자연어 단일 문화 복구 의심`)
    } else {
      ok('HEAD1 자연어 단일 문화 방지', 'source',
        `일상어 머리 ${everydayCount}/${head1Chars.length}개 (글·책·차 등)`)
    }
  }

  // BODY2 에도 일상어 몸이 있어야 한다
  const EVERYDAY_BODY = ['텃밭', '뜨개', '산책', '단추', '편지', '화분', '찻잔']
  const m2 = /const BODY2[^=]+=\s*\[([\s\S]+?)\]/.exec(CANDIDATES_SRC)
  if (!m2) {
    bad('BODY2 소스 파싱', 'source', '🔴 BODY2 배열을 소스에서 찾지 못했다')
  } else {
    const body2Words = (m2[1].match(/'([^']+)'/g) ?? []).map((s) => s.replace(/'/g, ''))
    const everydayBodyCount = EVERYDAY_BODY.filter((w) => body2Words.includes(w)).length
    if (everydayBodyCount < 4) {
      bad('BODY2 자연어 단일 문화', 'source',
        `🔴 일상어 몸 ${everydayBodyCount}개 < 최소 4 — 자연어 단일 문화 복구 의심`)
    } else {
      ok('BODY2 자연어 단일 문화 방지', 'source',
        `일상어 몸 ${everydayBodyCount}/${body2Words.length}개 (텃밭·뜨개 등)`)
    }
  }
}

// ─── ①-b 길이 다양성 · 반복 리듬 회귀 감지 ─────────────────────
//   canon §4.2 · runbook §2.1 (2026-10-16): 짧은 순우리말은 소수,
//   반복 리듬·구어체 4자 이름이 pool 에 있어야 한다.
{
  // NAME_LENGTH 상한이 4자 이상을 허용하는가
  if (NAME_LENGTH.max < 4) {
    bad('길이 상한 다양성', 'source',
      `🔴 NAME_LENGTH.max=${NAME_LENGTH.max} < 4 — 커뮤니티 스타일 4자 이름 불허`)
  } else {
    ok('길이 상한 다양성', 'source',
      `NAME_LENGTH.max=${NAME_LENGTH.max} ≥ 4 — 반복 리듬·구어체 통과 가능`)
  }

  // D20 후보 pool 에 4자 이름이 충분한가 (단일 길이 복구 방지)
  const cands4 = D20_CODES.flatMap((code) => candidatesFor(code, 40))
    .filter((n) => [...n].length === 4)
  const unique4 = [...new Set(cands4)]
  if (unique4.length < 3) {
    bad('pool 4자 다양성', 'source',
      `🔴 D20 후보 중 4자 이름 ${unique4.length}종 < 3 — 단일 길이 pool 복구 의심`)
  } else {
    ok('pool 4자 다양성', 'source',
      `D20 후보 중 4자 이름 ${unique4.length}종 (${unique4.slice(0, 3).join(' · ')} …)`)
  }

  // 짧은 이름(2~3자)이 전체의 90% 이하인가 (짧은 이름 단일 문화 방지)
  const allCands = D20_CODES.flatMap((code) => candidatesFor(code, 40))
  const shortCount = allCands.filter((n) => [...n].length <= 3).length
  const shortRatio = shortCount / (allCands.length || 1)
  if (shortRatio > 0.9) {
    bad('pool 길이 쏠림', 'source',
      `🔴 2~3자 이름 비율 ${Math.round(shortRatio * 100)}% > 90% — 짧은 이름 단일 문화 의심`)
  } else {
    ok('pool 길이 쏠림 방지', 'source',
      `2~3자 비율 ${Math.round(shortRatio * 100)}% ≤ 90% (4자+ 포함)`)
  }
}

// ─── ② 정책 검사기: AI·운영자·식별·브랜드 마커 ──────────────────
{
  const cases: [string, string][] = [
    ['봇이름', '봇 연상'],
    ['ai봄', 'AI 제품어'],
    ['sunbot', '봇 접미'],
    ['chatgpt', 'AI 제품어'],
    ['운영도우미', '운영자 연상'],
    ['서울들꽃', '지역명'],
    ['52세봄', '나이 표지(살)'],
    ['며느리손', '가족상태'],
    ['암투병봄', '병명'],
    ['시니어봄', '브랜드 금지'],
    ['갱년기카페', '출처 호칭'],
  ]
  const offenders: string[] = []
  for (const [name, label] of cases) {
    if (verifyNamePolicy(name).ok) offenders.push(`${name}(${label})`)
  }
  if (offenders.length) bad('정책 마커 차단', 'policy', `🔴 잡지 못함: ${offenders.join(' / ')}`)
  else ok('정책 마커 차단', 'policy', `${cases.length}종 전부 차단`)
}

// ─── ③ P34-P43 생성 후보 전부 정책 통과 ─────────────────────────
{
  const offenders: string[] = []
  let totalCands = 0
  for (const code of D20_CODES) {
    const cands = candidatesFor(code, 40)
    totalCands += cands.length
    if (cands.length === 0) { offenders.push(`${code}: 후보 0개`); continue }
    for (const n of cands) {
      const v = verifyNamePolicy(n)
      if (!v.ok) offenders.push(`${code}:${n}(${v.problems[0] ?? '?'})`)
    }
  }
  if (offenders.length) bad('생성 후보 정책 통과', 'policy', `🔴 ${offenders.slice(0, 3).join(' / ')}`)
  else ok('생성 후보 정책 통과', 'policy', `P34-P43 · 총 ${totalCands}후보 전부 통과`)
}

// ─── ④ P34-P43 dry-run — 빈 충돌 집합 ──────────────────────────
let dryRunNames: string[] = []
{
  const result = assignCandidates([...D20_CODES], () => false, 40)
  if (!result.ok) {
    bad('P34-P43 dry-run', 'dryrun', `🔴 ok=false — ${result.problems.join(' / ')}`)
  } else if (result.picked.size !== D20_CODES.length) {
    bad('P34-P43 dry-run', 'dryrun', `🔴 배정 ${result.picked.size}개 (${D20_CODES.length}개 필요)`)
  } else {
    dryRunNames = [...result.picked.values()]
    const unique = new Set(dryRunNames)
    if (unique.size !== dryRunNames.length) {
      bad('P34-P43 dry-run 중복', 'dryrun',
        `🔴 중복: ${dryRunNames.filter((n, i) => dryRunNames.indexOf(n) !== i).join(', ')}`)
    } else {
      const lengthViolators = dryRunNames.filter((n) => {
        const l = [...n].length
        return l < NAME_LENGTH.min || l > NAME_LENGTH.max
      })
      if (lengthViolators.length) {
        bad('dry-run 길이 정책', 'dryrun', `🔴 범위 밖: ${lengthViolators.join(', ')}`)
      } else {
        ok('P34-P43 dry-run', 'dryrun',
          `10개 서로 다름 · ${NAME_LENGTH.min}~${NAME_LENGTH.max}자: ${dryRunNames.join(' · ')}`)
      }
    }
  }
}

// ─── ⑤ fail-closed: 전부 막히면 배정 실패 ─────────────────────
{
  const result = assignCandidates(['P34'], () => true, 40)
  if (result.ok) bad('fail-closed', 'safety', '🔴 isTaken 전부인데 ok=true — 열린 채로 넘어갔다')
  else if (!result.problems.length) bad('fail-closed', 'safety', '🔴 ok=false 인데 problems 비었다')
  else ok('fail-closed', 'safety', `ok=false · "${result.problems[0]?.slice(0, 50)}"`)
}

// ─── ⑥ within-cohort 중복 차단 ─────────────────────────────────
{
  const result = assignCandidates(['P34', 'P35'], () => false, 40)
  if (!result.ok) {
    bad('within-cohort 중복 차단', 'safety', `🔴 ${result.problems.join(' / ')}`)
  } else {
    const n34 = result.picked.get('P34')
    const n35 = result.picked.get('P35')
    if (n34 === undefined || n35 === undefined) {
      bad('within-cohort 중복 차단', 'safety', '🔴 배정값 없음')
    } else if (n34 === n35) {
      bad('within-cohort 중복 차단', 'safety', `🔴 P34 · P35 가 같은 이름(${n34})`)
    } else {
      ok('within-cohort 중복 차단', 'safety', 'P34 ≠ P35')
    }
  }
}

// ─── ⑦ 합성 회원 이름 충돌 차단 → 대체 배정 ──────────────────────
{
  const cands34 = candidatesFor('P34', 40)
  const first = cands34[0]
  if (!first) {
    bad('회원 이름 충돌 차단', 'safety', '🔴 P34 후보 0개')
  } else {
    // 합성 이름 하나를 isTaken 으로 막는다 → 다음 후보로 이동해야 한다
    const result = assignCandidates(['P34'], (n) => n === first, 40)
    if (!result.ok) {
      bad('회원 이름 충돌 차단', 'safety', `🔴 대체 후보 없음 (pool=${cands34.length})`)
    } else if (result.picked.get('P34') === first) {
      bad('회원 이름 충돌 차단', 'safety', `🔴 막힌 이름이 그대로 배정됐다`)
    } else {
      ok('회원 이름 충돌 차단', 'safety', `합성 회원명 1개 차단 → 대체 배정 성공`)
    }
  }
}

// ─── ⑧ 합성 Persona 이름 충돌 차단 → 대체 배정 ─────────────────
{
  const cands35 = candidatesFor('P35', 40)
  const first35 = cands35[0]
  if (!first35) {
    bad('Persona 이름 충돌 차단', 'safety', '🔴 P35 후보 0개')
  } else {
    const result = assignCandidates(['P35'], (n) => n === first35, 40)
    if (!result.ok) {
      bad('Persona 이름 충돌 차단', 'safety', `🔴 대체 후보 없음`)
    } else if (result.picked.get('P35') === first35) {
      bad('Persona 이름 충돌 차단', 'safety', `🔴 막힌 이름이 그대로 배정됐다`)
    } else {
      ok('Persona 이름 충돌 차단', 'safety', `합성 Persona명 1개 차단 → 대체 배정 성공`)
    }
  }
}

// ─── ⑨ 결정론: 같은 코드는 같은 후보 순서 ────────────────────────
{
  const a = candidatesFor('P40', 40)
  const b = candidatesFor('P40', 40)
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    bad('결정론', 'determinism', '🔴 같은 코드인데 순서가 달라졌다')
  } else {
    ok('결정론', 'determinism', `P40 두 번 호출 → 동일 (${a.length}개)`)
  }
}

// ─── ⑩ 기존 P01 코드도 후보를 받는다 ────────────────────────────
{
  const cands01 = candidatesFor('P01', 40)
  if (cands01.length === 0) {
    bad('기존 코드 함수 계약', 'compat', '🔴 P01 후보 0개 — 기존 30명 배정 계약이 깨졌다')
  } else {
    const invalid = cands01.filter((n) => !verifyNamePolicy(n).ok)
    if (invalid.length) {
      bad('기존 코드 함수 계약', 'compat', `🔴 P01 후보 중 정책 미통과 ${invalid.length}개`)
    } else {
      ok('기존 코드 함수 계약', 'compat', `P01 후보 ${cands01.length}개 · 전부 유효`)
    }
  }
}

// ─── ⑪ 크롤 작가 대조 신호 부재 확인 ──────────────────────────
//   원천 작가명은 2026-10-01 #641 에서 폐기. hash 재증명 경로도 차단됨.
//   B2_CRAWL_AUTHOR · authorHash 가 후보 파일에 없는 것이 현재 계약이다.
//   누락이 아니라 제거(voice-author-hash-salt-trap.md 참조).
{
  const crawlMarkers = ['B2_CRAWL_AUTHOR', 'authorHash', 'crawlAuthor', 'voiceSource', 'matchAuthorHashes']
  const found = crawlMarkers.filter((s) => CANDIDATES_SRC.includes(s))
  if (found.length) {
    bad('크롤 작가 신호 부재', 'contract',
      `🔴 후보 파일에 크롤 작가 경로 재도입: ${found.join(', ')}`)
  } else {
    ok('크롤 작가 신호 부재', 'contract',
      '크롤 작가 대조 없음 — 원천 폐기(#641) · hash 재증명 불가 · isTaken 콜백만 존재')
  }
}

// ─── ⑫ P34-P43 기본 10명 분포 ──────────────────────────────────
{
  if (COHORTS['wave6-d20-canary'].codes.join() !== D20_CODES.join()) {
    bad('D20 코드 정본', 'dryrun', `🔴 cohort 코드가 P34-P43 과 다르다: ${COHORTS['wave6-d20-canary'].codes.join(',')}`)
  }
  const names = dryRunNames
  const byLen = new Map<number, number>()
  for (const n of names) byLen.set([...n].length, (byLen.get([...n].length) ?? 0) + 1)
  // 🔴 반복 리듬은 한글 네 음절 꼴이다 — 영문 nono(n-o-n-o)는 리듬으로 세지 않는다
  const rhythm = names.filter((n) => /^[가-힣]{4}$/.test(n) && [...n][1] === [...n][3])
  const synPairs = SYNONYM_ORACLE.filter((g) => names.filter((n) => g.includes(n)).length > 1)
  const problems: string[] = []
  if (names.length !== 10 || new Set(names).size !== 10) problems.push(`서로 다른 이름 ${new Set(names).size}/10`)
  const wantLen: Array<[number, number]> = [[3, 1], [4, 5], [5, 2], [7, 2]]
  const lenOk = byLen.size === wantLen.length && wantLen.every(([l, c]) => byLen.get(l) === c)
  if (!lenOk) problems.push(`길이 분포 ${[...byLen.entries()].sort((x, y) => x[0] - y[0]).map(([l, c]) => `${l}자${c}`).join('·')} (3자1·4자5·5자2·7자2 필요)`)
  // 🔴 독립 판정 — 생성기의 nameLaneOf 를 빌리지 않고 정규식으로 센다
  const laneOf = (n: string): string => `${/[가-힣]/.test(n) ? 'H' : ''}${/[A-Za-z]/.test(n) ? 'L' : ''}${/[0-9]/.test(n) ? 'D' : ''}`
  const byLane = new Map<string, number>()
  for (const n of names) byLane.set(laneOf(n), (byLane.get(laneOf(n)) ?? 0) + 1)
  const wantLane: Array<[string, number]> = [['H', 4], ['HD', 2], ['L', 2], ['LD', 2]]
  if (byLane.size !== wantLane.length || !wantLane.every(([l, c]) => byLane.get(l) === c)) {
    problems.push(`갈래 ${[...byLane.entries()].map(([l, c]) => `${l}${c}`).join('·')} (H4·HD2·L2·LD2 필요)`)
  }
  const latinN = names.filter((n) => /[A-Za-z]/.test(n)).length
  const digitN = names.filter((n) => /[0-9]/.test(n)).length
  const poeticN = names.filter((n) => isPoeticName(n)).length
  if (latinN !== 4) problems.push(`영문 포함 ${latinN}/10 (4 필요)`)
  if (digitN !== 4) problems.push(`숫자 포함 ${digitN}/10 (4 필요)`)
  if (poeticN !== 0) problems.push(`시적 명사 ${poeticN}/10 (0 필요)`)
  if (names.some((n) => laneOf(n) === 'HL' || laneOf(n).startsWith('HL'))) problems.push('한글+영문 혼합 이름이 있다')
  if (names.some((n) => nameLaneOf(n) === null || laneOf(n).replace('D', '') !== (nameLaneOf(n) ?? '').replace('D', ''))) problems.push('nameLaneOf 가 형식을 놓친다')
  if (names.some((n) => !verifyNamePolicy(n).ok)) problems.push('정책 미통과 이름이 있다')
  if (rhythm.length !== 1) problems.push(`반복 리듬 ${rhythm.length}/10 (1 필요: ${rhythm.join('·')})`)
  if (rhythm.some((n) => !isRepeatedRhythm(n))) problems.push('isRepeatedRhythm 이 반복 리듬을 놓친다')
  if (synPairs.length) problems.push(`유의어 쌍: ${synPairs.map((g) => names.filter((n) => g.includes(n)).join('+')).join(' / ')}`)
  const dist = [...byLen.entries()].sort((a, b) => a[0] - b[0]).map(([l, c]) => `${l}자 ${c}`).join(' · ')
  if (problems.length) bad('기본 10명 분포', 'dryrun', `🔴 ${problems.join(' / ')}`)
  else {
    const laneDist = wantLane.map(([l]) => `${l} ${byLane.get(l)}`).join(' · ')
    ok('기본 10명 분포', 'dryrun', `${dist} · 갈래 ${laneDist} · 영문 ${latinN} · 숫자 ${digitN} · 시적 ${poeticN} · 반복 리듬 ${rhythm.length}/10 · 유의어 쌍 0`)
  }
}

// ─── ⑬ 인공어 · 실명형 항목 제거 ────────────────────────────────
{
  const seen = new Set<string>()
  for (let n = 1; n <= 999; n += 1) for (const x of candidatesFor(`P${String(n).padStart(2, '0')}`, 10_000)) seen.add(x)
  const gone = [...ARTIFICIAL_OR_REAL_NAME, ...REJECTED_CODED_NAMES]
  const back = gone.filter((n) => seen.has(n))
  if (back.length) bad('인공어·실명형·거절된 이름 제거', 'policy', `🔴 후보에 다시 들어왔다: ${back.join(', ')}`)
  else ok('인공어·실명형·거절된 이름 제거', 'policy', `P01-P999 전 후보 ${seen.size}종에 ${gone.length}개 전부 없음`)
  // 🔴 옛 큐레이션 한글 묶음은 후보 공간엔 남아도 기본 배정·fixture 에는 오르지 않는다
  const fixtureNames = FIXTURE.candidates.map((c) => c.displayName)
  const onDefault = [...REJECTED_CURATED_DEFAULTS, ...REJECTED_CODED_NAMES].filter((n) => dryRunNames.includes(n) || fixtureNames.includes(n))
  if (onDefault.length) bad('거절된 기본 이름', 'contract', `🔴 기본 배정·fixture 에 올랐다: ${onDefault.join(', ')}`)
  else ok('거절된 기본 이름', 'contract', `${REJECTED_CURATED_DEFAULTS.length + REJECTED_CODED_NAMES.length}개 전부 기본 배정·fixture 밖`)
}

// ─── ⑭ fixture 표시명 = 기본 배정 ───────────────────────────────
{
  const fx = new Map(FIXTURE.candidates.map((c) => [c.code, c.displayName]))
  const def = assignCandidates([...D20_CODES], () => false, 40).picked
  const diff = D20_CODES.filter((c) => fx.get(c) !== def.get(c)).map((c) => `${c}: fixture=${fx.get(c) ?? '(없음)'} · 기본=${def.get(c) ?? '(없음)'}`)
  if (FIXTURE.candidates.length !== D20_CODES.length || [...fx.keys()].join() !== D20_CODES.join()) {
    bad('fixture = 기본 배정', 'contract', `🔴 fixture 코드 ${[...fx.keys()].join(',')} ≠ P34-P43`)
  } else if (diff.length) {
    bad('fixture = 기본 배정', 'contract', `🔴 ${diff.length}건 어긋남 — ${diff.join(' / ')}`)
  } else {
    ok('fixture = 기본 배정', 'contract', '10/10 일치 — mapping 은 fixture 에서 뽑는다')
  }
}

// ─── ⑮ live 충돌이 묶음을 쏠리게 하지 못한다 ────────────────────
//   🔴 상한 격리 — 열린 이름 10개를 골라 **상한 하나만** 넘게 한다. 다른 상한을 모두 통과하는 구성이라야
//      그 상한을 지운 변이가 "10명 전원 배정"으로 드러난다.
{
  const only = (open: readonly string[]): ReturnType<typeof assignCandidates> => {
    const set = new Set(open)
    return assignCandidates([...D20_CODES], (n) => !set.has(n), 10_000)
  }
  const countOf = (r: ReturnType<typeof assignCandidates>, f: (n: string) => boolean): number => [...r.picked.values()].filter(f).length
  // 기준선 — 상한을 넘지 않는 열린 10개는 전원 배정된다(위 격리 반례들이 "그냥 후보 부족"으로 실패한 것이 아님을 보인다)
  const base = only(['아무거나', '수다쟁이', '어쩌다보니', '하여튼', '괜찮아8', '일단3번', 'sleepy', 'random', 'again', 'justme9'])
  if (!base.ok) bad('상한 격리 기준선', 'safety', `🔴 상한 안의 10개가 배정되지 않는다: ${base.problems[0] ?? ''}`)
  else ok('상한 격리 기준선', 'safety', '상한 안의 열린 10개 → 10/10 배정')

  // 4·5자만 열리면 한 길이(≤5)를 넘겨 채울 수 없다
  const fourOnly = assignCandidates([...D20_CODES], (n) => [...n].length !== 4, 10_000)
  if (fourOnly.ok) bad('쏠림 fail-closed', 'safety', `🔴 4자만으로 10명을 채웠다: ${[...fourOnly.picked.values()].join('·')}`)
  else ok('쏠림 fail-closed', 'safety', `4자만 열림 → ok=false (${fourOnly.problems.length}명 미배정 · 일부만 만들지 않는다)`)

  // 유의어 — 도란도란 + 오손도손 (리듬 2 · H 4 · 영문 4 · 숫자 3 · 길이 모두 통과)
  const syn = only(['도란도란', '오손도손', '수다쟁이', '어쩌다보니', '괜찮아8', '일단3번', 'sleepy', 'random', 'again', 'justme9'])
  const synNames = [...syn.picked.values()]
  if (syn.ok || (synNames.includes('도란도란') && synNames.includes('오손도손'))) {
    bad('유의어 within-cohort', 'safety', `🔴 유의어 둘을 한 묶음에 넣었다: ${synNames.join('·')}`)
  } else ok('유의어 within-cohort', 'safety', '도란도란+오손도손 동시 배정 거절 → ok=false')

  // 반복 리듬 4개 (H 4 · 길이 4자 4 · 영문 4 · 숫자 3 · 시적 0)
  const rh = only(['따끈따끈', '나풀나풀', '토닥토닥', '두근두근', '괜찮아8', '하루만더2', 'sleepy', 'random', 'again', 'justme9'])
  const rhCount = countOf(rh, (n) => isRepeatedRhythm(n))
  if (rh.ok || rhCount > 3) bad('반복 리듬 상한', 'safety', `🔴 반복 리듬 ${rhCount}개를 한 묶음에 넣었다`)
  else ok('반복 리듬 상한', 'safety', `반복 리듬 4개만 열림 → ${rhCount}개에서 멈추고 ok=false`)

  // 같은 길이(6자) 6개 (HD 2 · L 3 · LD 1 · 나머지 H 4 · 영문 4 · 숫자 3 · 시적 0 · 리듬 0)
  const len6 = only(['오늘은패스2', '안되면말지6', 'anyway', 'sleepy', 'random', 'lazy88', '아무거나', '수다쟁이', '하여튼', '어쩌다보니'])
  const len6Count = countOf(len6, (n) => [...n].length === 6)
  if (len6.ok || len6Count > 5) bad('한 길이 상한', 'safety', `🔴 6자 ${len6Count}/10 을 한 묶음에 넣었다`)
  else ok('한 길이 상한', 'safety', `6자 6개 열림 → ${len6Count}개에서 멈추고 ok=false`)

  // 한 갈래 H 5 (길이·리듬·시적·영문·숫자 모두 통과)
  const laneH5 = only(['어쩌다보니', '그냥저냥', '수다쟁이', '하여튼', '아무거나', '괜찮아8', '일단3번', 'sleepy', 'random', 'justme9'])
  const laneHCount = countOf(laneH5, (n) => nameLaneOf(n) === 'H')
  if (laneH5.ok || laneHCount > 4) bad('한 갈래 상한', 'safety', `🔴 H 갈래 ${laneHCount}/10 을 넣었다`)
  else ok('한 갈래 상한', 'safety', `H 5개 열림 → ${laneHCount}개에서 멈추고 ok=false`)

  // 영문 포함 5 (L 3 + LD 2 · H 4 · HD 1 · 숫자 3)
  const latin5 = only(['sleepy', 'random', 'again', 'justme9', 'kk77', '아무거나', '수다쟁이', '어쩌다보니', '하여튼', '괜찮아8'])
  const latinCount = countOf(latin5, (n) => /[A-Za-z]/.test(n))
  if (latin5.ok || latinCount > 4) bad('영문 포함 상한', 'safety', `🔴 영문 포함 ${latinCount}/10 을 넣었다`)
  else ok('영문 포함 상한', 'safety', `영문 포함 5개 열림 → ${latinCount}개에서 멈추고 ok=false`)

  // 숫자 포함 5 (HD 3 + LD 2 · H 4 · L 1 · 영문 3)
  const digit5 = only(['괜찮아8', '일단3번', '하루만더2', 'justme9', 'kk77', '아무거나', '수다쟁이', '어쩌다보니', '하여튼', 'sleepy'])
  const digitCount = countOf(digit5, (n) => /[0-9]/.test(n))
  if (digit5.ok || digitCount > 4) bad('숫자 포함 상한', 'safety', `🔴 숫자 포함 ${digitCount}/10 을 넣었다`)
  else ok('숫자 포함 상한', 'safety', `숫자 포함 5개 열림 → ${digitCount}개에서 멈추고 ok=false`)

  // 시적 명사 3 (H 4 = 시적 3 + 1 · HD 2 · L 3 · LD 1 · 영문 4 · 숫자 3)
  const poetic3 = only(['텃밭', '일기', '찻잔', '아무거나', '괜찮아8', '일단3번', 'sleepy', 'random', 'again', 'justme9'])
  const poeticCount = countOf(poetic3, (n) => isPoeticName(n))
  if (poetic3.ok || poeticCount > 2) bad('시적 명사 상한', 'safety', `🔴 시적 명사 ${poeticCount}/10 을 넣었다`)
  else ok('시적 명사 상한', 'safety', `시적 명사 3개 열림 → ${poeticCount}개에서 멈추고 ok=false`)
}

// ─── ⑯ 섞인 형식 정책 ───────────────────────────────────────────
{
  const valid = ['커피만3잔', 'justme9', 'm7ood', 'nono', 'Pebble7', 'a2z', '하루2번째', 'rain', 'mailbox', '수국2', '3일째다이어트', '걍그럼']
  const invalid: Array<[string, string]> = [
    ['12', '숫자만'], ['수국12345', '숫자 5연속'], ['수국_2', '허용 밖 문자(밑줄)'], ['수 국', '공백'], ['ａｂ', '전각'],
    ['수국ㅇ', '미완성 자모'], ['수수수수국', '같은 글자 4연속'], ['aaaab', '같은 글자 4연속'], ['가', '1자'],
    ['도란도란도란도란도란도', '11자'], ['aibot', '봇 제품어'], ['chatgpt7', 'AI 제품어'], ['ai', 'AI 토큰'],
    ['운영자7', '운영자'], ['admin3', '운영자'], ['서울봄', '지역'], ['silver2', '브랜드 금지어'], ['레몬7', '출처 호칭'],
    ['푸른sky', '한글+영문 혼합'], ['봄a', '한글+영문 혼합'], ['sky푸른7', '한글+영문(+숫자) 혼합'], ['a수', '한글+영문 혼합'],
  ]
  const wrongValid = valid.filter((n) => !verifyNamePolicy(n).ok).map((n) => `${n}(${verifyNamePolicy(n).problems[0]})`)
  const wrongInvalid = invalid.filter(([n]) => verifyNamePolicy(n).ok).map(([n, why]) => `${n}(${why})`)
  if (wrongValid.length) bad('섞인 형식 — 유효 예', 'policy', `🔴 유효해야 한다: ${wrongValid.join(' / ')}`)
  else ok('섞인 형식 — 유효 예', 'policy', `${valid.length}종 전부 통과 (rain · mailbox 포함)`)
  if (wrongInvalid.length) bad('섞인 형식 — 무효 예', 'policy', `🔴 막혀야 한다: ${wrongInvalid.join(' / ')}`)
  else ok('섞인 형식 — 무효 예', 'policy', `${invalid.length}종 전부 차단`)
  // 🔴 네 갈래가 계약의 전부다 — 정책을 통과한 합성 이름은 갈래가 없을 수 없다(유효 예 전부 + 모든 후보)
  const laneless = [...valid, ...D20_CODES.flatMap((c) => candidatesFor(c, 10_000))].filter((n) => verifyNamePolicy(n).ok && nameLaneOf(n) === null)
  if (laneless.length) bad('유효 이름은 갈래가 있다', 'policy', `🔴 갈래 없는 유효 이름: ${[...new Set(laneless)].slice(0, 3).join(', ')}`)
  else ok('유효 이름은 갈래가 있다', 'policy', '유효 예 · P34-P43 전 후보 모두 H·HD·L·LD 중 하나')
  // 🔴 반복 리듬 판정 — 한글 4음절만. 영문 nono · soso 는 아니다
  const rhythmOk = isRepeatedRhythm('들쑥날쑥') && isRepeatedRhythm('도란도란') && !isRepeatedRhythm('nono') && !isRepeatedRhythm('soso') && !isRepeatedRhythm('이만총총')
  if (!rhythmOk) bad('반복 리듬 판정', 'policy', '🔴 한글 4음절 반복만 리듬이다 (들쑥날쑥 ✓ · nono ✗ · 이만총총 ✗)')
  else ok('반복 리듬 판정', 'policy', '들쑥날쑥 · 도란도란 ✓ · nono · soso · 이만총총 ✗')
  const lanes = [['소소하게', 'H'], ['귤먹는중9', 'HD'], ['pebble', 'L'], ['sun2day', 'LD']] as const
  const wrongLane = lanes.filter(([n, l]) => nameLaneOf(n) !== l).map(([n]) => n)
  if (wrongLane.length || nameLaneOf('봄a') !== null) bad('형식 갈래 판정', 'policy', `🔴 ${wrongLane.join(',')}`)
  else ok('형식 갈래 판정', 'policy', 'H · HD · L · LD 4종 + 한글·영문 혼합은 갈래 없음(정책이 거른다)')
}

// ─── 출력 ────────────────────────────────────────────────────────
console.log('\nPersona 닉네임 후보 정책 · 확장 fixture')
console.log('  🔴 이름은 전부 합성 문자열이다 — 실회원 닉네임 · 크롤 author 를 쓰지 않는다\n')
const label: Record<string, string> = {
  source:      '[소스]  ',
  policy:      '[정책]  ',
  dryrun:      '[건식]  ',
  safety:      '[안전]  ',
  determinism: '[결정론]',
  compat:      '[호환]  ',
  contract:    '[계약]  ',
}
for (const r of report) {
  console.log(`  ${r.ok ? '✅' : '❌'} ${label[r.kind] ?? ''} ${r.name.padEnd(28)} → ${r.detail}`)
}

if (dryRunNames.length === D20_CODES.length) {
  console.log('\n  📋 P34-P43 dry-run 배정 결과 (빈 충돌 집합)')
  for (let i = 0; i < D20_CODES.length; i++) {
    console.log(`     ${D20_CODES[i]} → ${dryRunNames[i] ?? '(없음)'}`)
  }
}

if (failures.length) {
  console.error(`\n❌ fixture ${failures.length}건 실패\n`)
  for (const f of failures) console.error(`  · ${f}`)
  console.error('')
  process.exit(1)
}
console.log(`\n✅ fixture ${report.length}건 전부 기대와 일치\n`)
