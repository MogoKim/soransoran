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
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  candidatesFor,
  assignCandidates,
  verifyNamePolicy,
  NAME_LENGTH,
} from '../src/lib/persona-nickname-candidates'

const HERE = dirname(fileURLToPath(import.meta.url))
const CANDIDATES_SRC = readFileSync(join(HERE, '../src/lib/persona-nickname-candidates.ts'), 'utf-8')

const D20_CODES = ['P34', 'P35', 'P36', 'P37', 'P38', 'P39', 'P40', 'P41', 'P42', 'P43'] as const

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
    ['들꽃7', '숫자 포함'],
    ['ai봄', '영문 포함'],
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
