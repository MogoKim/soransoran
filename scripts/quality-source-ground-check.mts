#!/usr/bin/env tsx
/**
 * 검수 소재 근거 검사 — 🔴 **네트워크 0 · 실제 provider 0 · DB 0**
 *
 * 🔴 **무엇이 틀렸었나** (2026-09-17 실측).
 *
 *    품질 검수는 초안의 `title`·`body` 만 받으면서
 *    `genericWithoutSourceAngle`(어떤 글을 읽고 썼는지 알 수 없다)을 물었다 —
 *    **비교 대상 없이 비교를 시켰다.** 실측 4건이 전부 0.95~0.98 로 통과했고,
 *    그중 둘은 원문의 얘기가 통째로 사라진 글이었다.
 *
 * 🔴 **이 검사가 증명하는 것과 못 하는 것.**
 *    증명한다  요청에 올바른 근거가 실리는가 · 어느 판정에서 왔는가 ·
 *              나이 검수와 분리됐는가 · 캐시가 근거를 반영하는가
 *    🔴 못 한다 **실제 모델이 의미를 제대로 가르는가.**
 *              가짜 provider 는 정해진 답을 돌려준다 — 판정 정확도의 증거가 아니다.
 *              그것은 유료 실측과 사람 평가로만 확인된다.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  buildQualityPayload, buildQualitySystemPrompt, digest16, groundDigestOf, hasGround,
  type SourceGround,
} from './micro-seed-auto-draft.mjs'
import {
  DRAFT_QUALITY_AXES, MACHINE_AGE_HUMAN_REVIEW_NOTE, QUALITY_HOLD,
} from '../src/lib/micro-seed-auto-draft'
import { DATA_DIR_NAME } from '../src/lib/micro-seed-82cook-thin-adapt'
import { buildQueueSnapshot, queueSnapshotFileName } from '../src/lib/supply-queue-snapshot'
import { writeFakePersonaAsset } from './lib/fake-persona-asset.mjs'

let pass = 0
let fail = 0
const check = (n: string, ok: boolean): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${n}`) } else { fail += 1; console.log(`  🔴 FAIL ${n}`) }
}
console.log('\n══ 검수 소재 근거 검사 (🔴 네트워크 0 · provider 0 · DB 0) ══\n')

const GROUND: SourceGround = {
  sourceTitle: '남편이 집안일 많이 돕나요?',
  sourceAngle: '방송에 나오는 남편과 우리 집 현실의 차이에 대한 하소연',
}

// ─────────────────────────────────────────────────────────
console.log('① 근거 조립 — 🔴 최소만 담고, 모르면 비운다')
// ─────────────────────────────────────────────────────────
{
  const p = JSON.parse(buildQualityPayload({ title: 'T', body: 'B' }, GROUND)) as Record<string, unknown>
  const ref = p.reference as Record<string, unknown> | undefined
  check('🔴 초안 제목·본문은 그대로 간다', p.title === 'T' && p.body === 'B')
  check('🔴 근거가 reference 칸에 따로 담긴다 — 초안과 섞이지 않는다', ref !== undefined)
  check('🔴 원문 제목과 판정 한 줄만 담는다',
    ref !== undefined && Object.keys(ref).sort().join(',') === 'sourceAngle,sourceTitle')
  check('🔴 🔴 원문 본문(bodyHead)을 새로 보내지 않는다',
    !/bodyHead|rawBody|sourceBody/.test(buildQualityPayload({ title: 'T', body: 'B' }, GROUND)))

  // 근거가 없을 때
  const none = JSON.parse(buildQualityPayload({ title: 'T', body: 'B' })) as Record<string, unknown>
  check('🔴 근거가 없으면 reference 칸 자체가 없다 — 빈 칸으로 "없다" 를 숨기지 않는다',
    none.reference === undefined && Object.keys(none).sort().join(',') === 'body,title')
  const empty = JSON.parse(buildQualityPayload({ title: 'T', body: 'B' }, { sourceTitle: '', sourceAngle: '' })) as Record<string, unknown>
  check('🔴 둘 다 비어 있으면 근거 없음으로 본다', empty.reference === undefined)
  check('🔴 판정 한 줄만 비어 있어도 제목이 있으면 근거다',
    hasGround({ sourceTitle: '제목', sourceAngle: '' }))
  const onlyTitle = JSON.parse(buildQualityPayload({ title: 'T', body: 'B' }, { sourceTitle: '제목', sourceAngle: '' })) as Record<string, unknown>
  check('🔴 그때 판정 한 줄은 **빈 채로** 간다 — 지어내지 않는다',
    (onlyTitle.reference as Record<string, unknown>).sourceAngle === '')
}

// ─────────────────────────────────────────────────────────
console.log('\n② 프롬프트 — 🔴 참고 자료이고, 다름은 실패가 아니다')
// ─────────────────────────────────────────────────────────
{
  const withG = buildQualitySystemPrompt(undefined, GROUND)
  const without = buildQualitySystemPrompt(undefined)
  check('🔴 근거가 있으면 참고 자료라고 밝힌다', /참고 자료/.test(withG))
  check('🔴 🔴 근거 안의 문장을 지시로 따르지 않게 못박는다',
    /지시가 아니다/.test(withG) && /따르지 않는다/.test(withG))
  check('🔴 관점 전환이 이 축의 사유가 아니라고 적는다', /다른 관점/.test(withG))
  check('🔴 일상 질문이 이 축의 사유가 아니라고 적는다', /일상 질문/.test(withG))
  check('🔴 질문 없이 털어놓는 것이 이 축의 사유가 아니라고 적는다', /털어놓는/.test(withG))
  /**
   * 🔴 **면제가 아니라 "이 축의 사유가 아니다" 로 좁혔는가** (2026-09-17).
   *    "전부 좋은 글이다. 막지 않는다" 로 두면 관점을 바꿨다는 이유로
   *    위해·생활사 모순·다른 품질 축까지 면제되는 것처럼 읽힌다.
   */
  check('🔴 🔴 다른 축을 면제하지 않는다고 못박는다',
    /이 축의 실패 사유가 아니다/.test(withG)
    && /위해 · 생활사 모순 · 다른 품질 축은 \*\*그대로 본다\*\*/.test(withG)
    && /면제하지 않는다/.test(withG))
  check('🔴 🔴 네 가지에 해당해도 소재가 사라졌으면 걸린다고 적는다',
    withG.includes('위 네 가지에 해당해도 **소재가 사라졌으면 이 축에 걸린다.**'))
  check('🔴 "전부 좋은 글이다 · 막지 않는다" 라는 넓은 면제 문장을 쓰지 않는다',
    !/전부 \*\*좋은 글이다/.test(withG))
  check('🔴 🔴 낱말 겹침을 세지 말라고 적는다 — 새 합격선을 만들지 않는다',
    /낱말이 겹치는지 세지 않는다/.test(withG))
  check('🔴 근거가 없으면 그 축을 **판정하지 않는다** 고 적는다',
    /판정하지 않는다/.test(without) && /확정하지도/.test(without))
  check('🔴 근거 없을 때 참고 자료 문구를 넣지 않는다', !/참고 자료/.test(without))

  // 🔴 새 축·형식 규칙을 만들지 않았다
  check('🔴 품질 축 목록이 그대로다 — 새 축을 만들지 않았다',
    DRAFT_QUALITY_AXES.includes('genericWithoutSourceAngle') && DRAFT_QUALITY_AXES.length === 6)
  check('🔴 그 축은 여전히 **사람에게 넘김**이다 — 버리지 않는다',
    QUALITY_HOLD.includes('genericWithoutSourceAngle'))
  check('🔴 질문 개수·문장 길이·비율을 요구하지 않는다',
    !/물음표|문장 \d개|질문 \d개|비율/.test(withG))
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 캐시 key — 🔴 근거가 달라지면 새 검수, 같으면 재사용')
// ─────────────────────────────────────────────────────────
{
  const a = groundDigestOf(GROUND)
  const b = groundDigestOf({ ...GROUND })
  const c = groundDigestOf({ ...GROUND, sourceAngle: '다른 설명' })
  const d = groundDigestOf(undefined)
  check('🔴 같은 근거는 같은 표식 — 불필요한 재검수를 만들지 않는다', a === b)
  check('🔴 근거가 달라지면 표식이 달라진다 — 옛 판정을 재사용하지 않는다', a !== c)
  check('🔴 근거 없음은 따로 구분된다', d === 'none' && a !== d)
  check('🔴 제목만 달라도 표식이 달라진다',
    groundDigestOf({ ...GROUND, sourceTitle: '다른 제목' }) !== a)

  /**
   * 🔴 **지침이 바뀌면 key 도 바뀌는가** (2026-09-17 추가).
   *
   *    앞판 검사는 근거 **데이터** 변경만 봤다 — `groundDigest` 가 그것을 잡는다.
   *    그런데 key 의 프롬프트 digest 를 `buildQualitySystemPrompt(persona)` 로,
   *    즉 **근거 없는 분기**로 냈다. 그래서 근거 있는 분기의 **문장을 고쳐도**
   *    key 가 그대로였고 옛 판정이 hit 될 수 있었다. 검사가 그것을 못 잡았다.
   */
  const withGround = digest16(buildQualitySystemPrompt(undefined, GROUND))
  const withoutGround = digest16(buildQualitySystemPrompt(undefined))
  check('🔴 🔴 근거 유무로 프롬프트 digest 가 갈린다 — 두 분기가 다른 글이다',
    withGround !== withoutGround)
  check('🔴 🔴 key 의 프롬프트 digest 를 **실제 요청과 같은 인자**로 만든다',
    /const qSystemDigest = digest16\(buildQualitySystemPrompt\(persona, ground\)\)/
      .test(readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')))
  check('🔴 근거를 qSystemDigest 보다 **먼저** 정한다',
    (() => {
      const w = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')
      return w.indexOf('const ground: SourceGround') < w.indexOf('const qSystemDigest')
    })())
  check('🔴 같은 인자면 digest 도 같다 — 불필요한 재검수를 만들지 않는다',
    digest16(buildQualitySystemPrompt(undefined, { ...GROUND })) === withGround)

  // 🔴 payload 와 key 가 **같은 것**을 본다
  const src = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')
  check('🔴 payload 와 key 가 같은 함수(referenceOf)를 본다 — 두 곳에 적지 않는다',
    (src.match(/referenceOf\(ground\)/g) ?? []).length === 2)
  check('🔴 검수 key 에 근거 표식이 들어간다', /\$\{groundDigest\}/.test(src))
  check('🔴 🔴 **생성 key 에는 넣지 않는다** — 생성 입력은 바뀌지 않았다',
    (() => {
      const i = src.indexOf('const genKey =')
      return !src.slice(i, i + 200).includes('groundDigest')
    })())
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 행동 — 🔴 **실제로 나간 요청**을 본다 (가짜 provider · 임시 HOME)')
// ─────────────────────────────────────────────────────────
{
  const root = mkdtempSync(join(tmpdir(), 'qg-'))
  const dd = join(root, DATA_DIR_NAME)
  mkdirSync(dd, { recursive: true })
  symlinkSync(join(process.cwd(), 'docs'), join(root, 'docs'))
  const fakeHome = join(root, 'home')
  mkdirSync(fakeHome, { recursive: true })
  writeFakePersonaAsset({ home: fakeHome })

  const ID = 'QG1'
  const TITLE = '남편이 집안일 많이 돕나요?'
  const ANGLE_OLD = '🔴 옛 판정의 설명 — 이 값이 나가면 안 된다'
  const ANGLE_NEW = '방송 속 남편과 우리 집 현실의 차이에 대한 하소연'
  const meta = (id: string, title: string): string => JSON.stringify({
    sourceArticleId: id, sourceSite: 'navercafe:wgang', title,
    bodyHead: '합성 본문입니다. 시험용으로 지어냈습니다.',
    axis: 'sourceCandidate', lane: 'originalRaw',
  })
  const shadow = (id: string, angle: string): string => JSON.stringify({
    sourceArticleId: id, decision: 'AUTO_SEED', semanticRisks: [], communityAngle: angle,
    ruleVersion: 'auto-judge-v3', promptVersion: 'p', model: 'm', inputHash: 'h',
    provenance: 'machine-shadow',
  })
  writeFileSync(join(dd, 'x.detail.jsonl'), `${meta(ID, TITLE)}\n${meta('QG2', '두 번째 합성 제목')}\n`, 'utf-8')
  // 🔴 **두 파일**을 둔다 — 정렬 순서에서 뒤가 이기는지, 다른 파일이 섞이지 않는지 본다
  writeFileSync(join(dd, 'a-old.shadow.jsonl'), `${shadow(ID, ANGLE_OLD)}\n${shadow('QG2', ANGLE_OLD)}\n`, 'utf-8')
  writeFileSync(join(dd, 'b-new.shadow.jsonl'), `${shadow(ID, ANGLE_NEW)}\n${shadow('QG2', '')}\n`, 'utf-8')

  const bodyLog = join(root, 'bodies.jsonl')
  const run = (
    args: readonly string[], runId: string, opts: { keepCache?: boolean } = {},
  ): { code: number | null; out: string; bodies: Record<string, unknown>[] } => {
    writeFileSync(bodyLog, '', 'utf-8')
    // 🔴 캐시 재사용을 보려면 비우면 안 된다 — 앞판은 늘 비워 스스로 재사용을 없앴다
    if (opts.keepCache !== true) writeFileSync(join(dd, 'auto-draft-cache.json'), '{}', 'utf-8')
    const snapPath = join(dd, queueSnapshotFileName(runId))
    writeFileSync(snapPath, JSON.stringify(buildQueueSnapshot({ runId, takenAt: new Date(), rows: [] })), 'utf-8')
    const r = spawnSync(
      join(process.cwd(), 'node_modules/.bin/tsx'),
      [
        join(process.cwd(), 'scripts/micro-seed-auto-draft.mts'), '--call', '--apply',
        `--queue-snapshot=${snapPath}`, `--run-id=${runId}`, '--require-queue-snapshot', ...args,
      ],
      {
        cwd: root, encoding: 'utf-8',
        env: {
          ...process.env, HOME: fakeHome, ANTHROPIC_API_KEY: 'fixture-fake-key',
          FAKE_PROVIDER_BODY_LOG: bodyLog,
          NODE_OPTIONS: `--import=${join(process.cwd(), 'scripts/lib/fake-provider-hook.mjs')}`,
          // 🔴 시험용 임시 값이다. 운영 예산이 아니다
          SORAN_LLM_DAILY_BUDGET_USD: '1000',
          SORAN_LLM_RESERVE_HEADROOM: '1.5',
          SORAN_LLM_RUN_REQUEST_CAP: '10000',
        },
      },
    )
    const bodies = readFileSync(bodyLog, 'utf-8').split('\n').filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as Record<string, unknown>)
    return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, bodies }
  }
  /** 요청 본문에서 user 메시지(= payload)를 꺼낸다 */
  const payloadsOf = (bodies: Record<string, unknown>[]): Record<string, unknown>[] =>
    bodies.map((b) => {
      const msgs = (b.messages ?? []) as { role?: string; content?: string }[]
      const u = msgs.find((m) => m.role === 'user')
      try { return JSON.parse(String(u?.content ?? '{}')) as Record<string, unknown> } catch { return {} }
    })
  const systemOf = (b: Record<string, unknown>): string => String(b.system ?? '')

  // ⓐ 전체 입력 — 마지막 파일의 판정이 이긴다
  const all = run([], 'QGA')
  const ps = payloadsOf(all.bodies)
  const withRef = ps.filter((p) => p.reference !== undefined)
  check('🔴 [B] 검수 요청이 실제로 나갔다', all.bodies.length > 0)
  check('🔴 [B] 품질 요청에 근거가 실린다', withRef.length > 0)
  check('🔴 [B] 🔴 **마지막 파일의 판정**이 근거가 된다',
    withRef.some((p) => String((p.reference as Record<string, unknown>).sourceAngle) === ANGLE_NEW))
  check('🔴 [B] 🔴 다른 파일의 옛 판정이 섞이지 않는다',
    !withRef.some((p) => String((p.reference as Record<string, unknown>).sourceAngle) === ANGLE_OLD))
  check('🔴 [B] 🔴 마지막 판정의 **빈 설명을 과거 값으로 메우지 않는다** (QG2)',
    !JSON.stringify(ps).includes(ANGLE_OLD))

  /**
   * ⓐ-2 🔴 **같은 근거로 곧바로 다시** — 재사용되어야 한다.
   *    🔴 순서가 중요하다. 사이에 **다른 근거**로 한 회차를 끼우면 그 캐시를 물려받아
   *    miss 가 나고, 그것을 "재사용 안 됨" 으로 오해하게 된다(앞판이 그랬다).
   */
  const reuse = run([], 'QGC', { keepCache: true })
  check('🔴 [B] 🔴 같은 근거면 검수 캐시를 **재사용한다** — 불필요한 재검수를 만들지 않는다',
    reuse.bodies.length === 0)
  check('🔴 [B] 그때 화면이 캐시 적중을 말한다', /cache hit [1-9]/.test(reuse.out))

  // ⓑ 🔴 나이 검수에는 근거가 없다
  /**
   * 🔴 **나이 검수만 고른다.** 앞판은 `/나이|세대/` 로 골라 품질 요청까지 섞였다 —
   *    품질 프롬프트도 Persona 생활사에 나이대를 싣기 때문이다.
   *    나이 프롬프트에만 있는 **첫 줄**을 표지로 쓴다.
   */
  const AGE_MARK = '너는 글 한 편을 읽고 **딱 하나만** 판정한다.'
  const ageBodies = all.bodies.filter((b) => systemOf(b).startsWith(AGE_MARK))
  const qualityBodies = all.bodies.filter((b) => !systemOf(b).startsWith(AGE_MARK))
  check('🔴 [B] 품질 요청과 나이 요청이 갈린다',
    qualityBodies.length > 0 && ageBodies.length > 0
    && qualityBodies.length + ageBodies.length === all.bodies.length)
  const agePayloads = payloadsOf(ageBodies)
  check('🔴 [B] 나이 검수 요청이 있었다', ageBodies.length > 0)
  check('🔴 [B] 🔴 **나이 검수에는 원문 근거가 들어가지 않는다**',
    agePayloads.every((p) => p.reference === undefined))
  check('🔴 [B] 나이 검수는 제목·본문만 받는다',
    agePayloads.every((p) => Object.keys(p).sort().join(',') === 'body,title'))
  check('🔴 [B] 나이 검수 프롬프트에 원문 제목이 없다',
    ageBodies.every((b) => !systemOf(b).includes(TITLE)))

  // ⓒ 제한 입력 — --input 범위만 본다
  const limited = run([`--input=${join(dd, 'a-old.shadow.jsonl')}`], 'QGB')
  const lp = payloadsOf(limited.bodies).filter((p) => p.reference !== undefined)
  check('🔴 [B] 🔴 --input 을 주면 **그 파일의 판정**이 근거가 된다',
    lp.length > 0 && lp.every((p) => String((p.reference as Record<string, unknown>).sourceAngle) === ANGLE_OLD))
  check('🔴 [B] 그때 범위 밖 파일의 판정은 안 쓴다',
    !JSON.stringify(lp).includes(ANGLE_NEW))

  // ⓓ 캐시 — 같은 근거는 재사용, 다르면 새 검수
  /**
   * ⓓ 🔴 **근거만 바꾼다** — 초안도 Persona 도 그대로다. 새 검수를 받아야 한다.
   *    먼저 같은 근거로 캐시를 채운 뒤 바꾼다 — 그래야 바뀐 것이 근거뿐이다.
   */
  run([], 'QGD0')
  writeFileSync(join(dd, 'b-new.shadow.jsonl'),
    `${shadow(ID, '아주 다른 소재 설명으로 바꾼다')}\n${shadow('QG2', '')}\n`, 'utf-8')
  const changed = run([], 'QGD', { keepCache: true })
  check('🔴 [B] 🔴 근거가 달라지면 **새 검수를 받는다** — 옛 판정을 재사용하지 않는다',
    changed.bodies.length > 0
    && payloadsOf(changed.bodies).some((x) => JSON.stringify(x).includes('아주 다른 소재 설명')))

  // ⓔ 기존 계약 유지
  // 🔴 문자열을 다시 적지 않는다 — 정본 상수와 대조한다
  check('🔴 [B] 사람 확인 문구가 그대로 찍힌다',
    all.out.includes(MACHINE_AGE_HUMAN_REVIEW_NOTE))
  check('🔴 [B] 위기·생활사 집계가 그대로 찍힌다',
    /위기 소재로 \*\*부르기 전에\*\* 멈춘 원천/.test(all.out) && /생활사 충돌 재생성/.test(all.out))
  check('🔴 [B] 회차 요청 상한이 그대로 돈다', /실제 provider 요청 \d+회/.test(all.out))
  check('🔴 [B] 장부가 그대로 돈다 — 유료 건수를 센다', /장부 QGA · 유료 \d+건/.test(all.out))
  check('🔴 [B] 입력 파일을 지우지 않았다',
    existsSync(join(dd, 'a-old.shadow.jsonl')) && existsSync(join(dd, 'b-new.shadow.jsonl')))
  if (fail > 0) console.log(`\n  (러너 출력 꼬리)\n${all.out.split('\n').slice(-14).map((l) => `    ${l}`).join('\n')}`)
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 가짜 provider 검사다 — 실제 모델의 의미 판정 정확도는 증명하지 않았다.')
if (fail > 0) process.exit(1)
