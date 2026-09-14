/**
 * 0024 마이그레이션 **상태 판정** — 🔴 순수 함수. DB·네트워크·파일 IO 없음
 *
 * 🔴 **왜 함수로 뺐나** (2026-09-09).
 *
 *    `--check` 가 DB 를 직접 읽으면서 그 자리에서 판정까지 했다. 그래서
 *    "적용됨 / 일부만 / 못 읽음" 을 **한 번도 시험해 본 적이 없었다** —
 *    시험하려면 실제로 컬럼을 만들어야 했고, 그건 production 에 쓰는 일이다.
 *
 *    판정을 함수로 빼면 가짜 metadata 로 네 상태를 전부 시험할 수 있다.
 *    CI 는 DB 없이 이 함수만 돌린다 — write 0 · 연결 0.
 *
 * 🔴 **이 파일은 아무것도 읽지 않는다.** 넘겨받은 metadata 만 본다.
 * 🔴 `.mjs` 인 이유: `node scripts/apply-migration-0024.mjs` 가 tsx 없이 돌아야 한다.
 *    `allowJs` 덕에 `.mts` fixture 도 이 파일을 그대로 import 한다.
 */

export const MIGRATION_ID = '0024_persona_comment_provenance'
export const TARGET_TABLE = 'PersonaApprovalQueue'

/** 0024 가 더하는 것 — 🔴 전부 nullable text. FK 는 없다 */
export const NEW_COLUMNS = ['generatedModel', 'canonRunId', 'canonDigest']
export const NEW_INDEX = 'PersonaApprovalQueue_canonRunId_idx'

/**
 * 🔴 **0024 적용 전 `PersonaApprovalQueue` 의 실제 컬럼 22개.**
 *
 *    2026-09-09 `information_schema.columns` 실측이다.
 *
 *    앞선 판은 이 자리에 `sourceRawContentId` · `draftTitle` · `draftBody` ·
 *    `createdPostId` 를 적어 두었다 — **0023(`MicroSeedCandidate`) 스크립트에서
 *    베껴 온 이름들**이고 이 테이블에는 없다. 그래서 `--check` 는
 *    "기존 컬럼 유실 4종" 을 늘 보고했고, 이어서 없는 컬럼을 조회하다
 *    PostgreSQL 42703 으로 **잡히지 않은 채 죽었다.**
 */
export const BASELINE_COLUMNS = [
  'id', 'personaId', 'targetPostId', 'status', 'candidateText', 'editedText',
  'editDiff', 'reactionType', 'gateStatus', 'gateResults', 'aiToneTags',
  'regenCount', 'storyRefs', 'topicTags', 'seedRef', 'dedupKey',
  'declineReason', 'decidedBy', 'decidedAt', 'publishedCommentId',
  'createdAt', 'updatedAt',
]

/**
 * 적용 전에도 있어야 하는 인덱스 — 🔴 0024 가 지우지 않는다.
 *
 * 🔴 **2026-09-10 정정 — 5개 중 3개만 적어 두었다.**
 *    `pg_indexes` 실측은 5개인데 기준선에는 unique 3종만 있었다.
 *    조회용 인덱스 둘(`personaId_createdAt` · `status_createdAt`)이 사라져도
 *    `--check` 는 "기존 인덱스 그대로" 라고 말했다 — 지키지 않는 검사였다.
 *    그 둘이 없으면 Queue 조회와 러너의 결정적 정렬이 통째로 느려진다.
 */
export const BASELINE_INDEXES = [
  'PersonaApprovalQueue_pkey',
  'PersonaApprovalQueue_dedupKey_key',
  'PersonaApprovalQueue_publishedCommentId_key',
  'PersonaApprovalQueue_personaId_createdAt_idx',
  'PersonaApprovalQueue_status_createdAt_idx',
]

/**
 * 🔴 네 상태를 **명시적으로** 나눈다. "실패" 한 낱말로 뭉치면
 *    못 읽은 것과 잘못 적용된 것이 같아 보인다 — 조치가 정반대인데도.
 */
export const MIGRATION_STATES = /** @type {const} */ ([
  'NOT_APPLIED',
  'APPLIED_AND_VALID',
  'PARTIAL_OR_INVALID',
  'OBSERVATION_FAILED',
])

/**
 * @typedef {{ column_name: string, data_type: string, is_nullable: string }} ColumnMeta
 * @typedef {{ code: string, ok: boolean, detail: string }} Finding
 * @typedef {{
 *   state: 'NOT_APPLIED'|'APPLIED_AND_VALID'|'PARTIAL_OR_INVALID'|'OBSERVATION_FAILED',
 *   findings: Finding[],
 *   summary: string,
 *   exitCode: number,
 * }} MigrationVerdict
 */

/** 🔴 관측 자체가 성립했는가 — 성립하지 않으면 그 뒤 판정은 전부 뜻이 없다 */
function judgeObservation(input) {
  if (input === null || typeof input !== 'object') return '관측값이 없다'
  if (input.table !== TARGET_TABLE) {
    return `다른 테이블의 metadata 다 — ${String(input.table)} (기대 ${TARGET_TABLE})`
  }
  if (!Array.isArray(input.columns)) return '컬럼 metadata 를 읽지 못했다'
  if (!Array.isArray(input.indexes)) return '인덱스 metadata 를 읽지 못했다'
  if (input.columns.length === 0) return '컬럼이 0개다 — 테이블이 없거나 권한이 없다'
  for (const c of input.columns) {
    if (c === null || typeof c !== 'object' || typeof c.column_name !== 'string') {
      return '컬럼 metadata 의 모양이 아니다'
    }
  }
  return null
}

/**
 * 🔴 **metadata 만 보고 상태를 정한다.**
 *
 * @param {{ table: string|null, columns: ColumnMeta[]|null, indexes: string[]|null }} input
 * @returns {MigrationVerdict}
 */
export function judgeMigrationState(input) {
  const bad = judgeObservation(input)
  if (bad !== null) {
    return {
      state: 'OBSERVATION_FAILED',
      findings: [{ code: 'OBSERVATION', ok: false, detail: bad }],
      summary: `🔴 관측 실패 — ${bad}`,
      exitCode: 1,
    }
  }

  const names = input.columns.map((c) => c.column_name)
  const indexes = input.indexes
  /** @type {Finding[]} */
  const findings = []

  // ── 기존 컬럼 불변 ──
  const lost = BASELINE_COLUMNS.filter((c) => !names.includes(c))
  findings.push({
    code: 'BASELINE_COLUMNS',
    ok: lost.length === 0,
    detail: lost.length === 0
      ? `기존 컬럼 ${BASELINE_COLUMNS.length}개 그대로`
      : `🔴 기존 컬럼 유실: ${lost.join(', ')}`,
  })
  const lostIdx = BASELINE_INDEXES.filter((i) => !indexes.includes(i))
  findings.push({
    code: 'BASELINE_INDEXES',
    ok: lostIdx.length === 0,
    detail: lostIdx.length === 0
      ? `기존 인덱스 ${BASELINE_INDEXES.length}개 그대로`
      : `🔴 기존 인덱스 유실: ${lostIdx.join(', ')}`,
  })

  // ── 신규 컬럼 ──
  const present = NEW_COLUMNS.filter((c) => names.includes(c))
  const absent = NEW_COLUMNS.filter((c) => !names.includes(c))
  findings.push({
    code: 'NEW_COLUMNS',
    ok: absent.length === 0,
    detail: absent.length === 0
      ? `신규 컬럼 ${NEW_COLUMNS.length}개 있음`
      : `신규 컬럼 없음: ${absent.join(', ')}`,
  })

  // 🔴 nullable 이어야 한다. NOT NULL 이면 기존 행이 막힌다
  for (const name of present) {
    const col = input.columns.find((c) => c.column_name === name)
    const nullable = col.is_nullable === 'YES'
    const isText = String(col.data_type).toLowerCase() === 'text'
    findings.push({
      code: `COLUMN_SHAPE:${name}`,
      ok: nullable && isText,
      detail: !nullable
        ? `🔴 ${name} 이 NOT NULL 이다 — 기존 행이 막힌다`
        : !isText
          ? `🔴 ${name} 의 타입이 text 가 아니다 (${col.data_type})`
          : `${name} nullable text`,
    })
  }

  const hasIndex = indexes.includes(NEW_INDEX)
  findings.push({
    code: 'NEW_INDEX',
    ok: hasIndex,
    detail: hasIndex ? `인덱스 ${NEW_INDEX} 있음` : `인덱스 없음: ${NEW_INDEX}`,
  })

  const baselineOk = lost.length === 0 && lostIdx.length === 0
  const shapeOk = findings
    .filter((f) => f.code.startsWith('COLUMN_SHAPE:'))
    .every((f) => f.ok)

  /**
   * 🔴 **아무것도 없으면 미적용이다.** 그건 오류가 아니라 사실이고,
   *    그 사실 위에서 `--apply` 를 사람이 결정한다.
   */
  if (present.length === 0 && !hasIndex && baselineOk) {
    return {
      state: 'NOT_APPLIED',
      findings,
      summary: `미적용 — ${MIGRATION_ID} 의 컬럼 ${NEW_COLUMNS.length}개·인덱스 1개가 아직 없다`,
      // 🔴 controlled exit 1 — "확인했더니 아직 아니다" 도 통과가 아니다
      exitCode: 1,
    }
  }

  if (present.length === NEW_COLUMNS.length && hasIndex && shapeOk && baselineOk) {
    return {
      state: 'APPLIED_AND_VALID',
      findings,
      summary: `적용 완료 — 컬럼 ${NEW_COLUMNS.length}개(nullable text) + 인덱스 1개 · 기존 스키마 불변`,
      exitCode: 0,
    }
  }

  const why = findings.filter((f) => !f.ok).map((f) => f.detail)
  return {
    state: 'PARTIAL_OR_INVALID',
    findings,
    summary: `🔴 일부만 적용됐거나 모양이 다르다 — ${why.join(' / ')}`,
    exitCode: 1,
  }
}

/**
 * 🔴 **Supabase 프로젝트를 판별하지 못하면 통과시키지 않는다.**
 *
 *    앞선 판은 `hostname` 이 `db.<ref>.supabase.co` 일 때만 대조하고,
 *    아니면 **조용히 통과**시켰다. 실제 `DIRECT_URL` 은 pooler 호스트라
 *    ref 가 늘 `undefined` 였다 — 어느 프로젝트를 보는지 모른 채 돌고 있었다.
 *
 *    pooler 는 사용자 이름에 ref 를 싣는다(`postgres.<ref>`). 둘 다 못 읽으면 실패다.
 *
 * @param {{ hostname: string, username: string }} url
 * @param {string} expectedRef
 * @returns {{ ok: boolean, ref: string|null, reason: string }}
 */
export function judgeProjectRef(url, expectedRef) {
  const fromHost = /db\.([a-z0-9]+)\.supabase\.co$/i.exec(url.hostname ?? '')?.[1] ?? null
  const fromUser = /^postgres\.([a-z0-9]+)$/i.exec(url.username ?? '')?.[1] ?? null
  const ref = fromHost ?? fromUser
  if (ref === null) {
    return {
      ok: false,
      ref: null,
      reason: 'Supabase project ref 를 host 에서도 사용자 이름에서도 읽지 못했다 — 어느 프로젝트인지 모르면 진행하지 않는다(fail-closed)',
    }
  }
  if (ref !== expectedRef) {
    return { ok: false, ref, reason: `예상과 다른 Supabase 프로젝트다 (${ref})` }
  }
  return { ok: true, ref, reason: `프로젝트 확인 — ${ref} (${fromHost === null ? 'pooler 사용자 이름' : 'host'})` }
}

/**
 * 🔴 **적용은 COMMIT 전에 검증한다** (2026-09-10 정정).
 *
 *    앞선 판의 순서는 `BEGIN → SQL → COMMIT → 검증` 이었다.
 *    검증이 실패해도 이미 COMMIT 한 뒤라 **되돌릴 방법이 없었다** —
 *    스크립트는 exit 1 로 끝나지만 DB 는 바뀐 채로 남는다.
 *    "적용 실패" 라고 말하면서 적용해 두는 것은 가장 나쁜 결말이다.
 *
 *    그래서 같은 트랜잭션 안에서 다시 관측하고, 전부 통과할 때만 COMMIT 한다.
 *    하나라도 어긋나거나 **관측 자체가 안 되면** ROLLBACK 이다.
 *
 * 🔴 **성공은 "SQL 이 실행됐다" 가 아니라 "COMMIT 전에 postcondition 이 검증됐다" 다.**
 *
 * 🔴 실행기를 주입받는다 — 가짜 client 로 COMMIT/ROLLBACK 횟수를 셀 수 있어야 한다.
 *    실제 DB 에 쓰지 않고 실패 경로를 전부 시험하는 유일한 방법이다.
 *
 * 🔴 **판정도 주입받는다** (2026-09-14 · 0025 를 위해 더함).
 *    앞선 판은 `judgeMigrationState`(0024 전용)를 본문에서 직접 불렀다.
 *    그래서 다른 마이그레이션은 이 실행기를 쓸 수 없었고,
 *    쓰려면 트랜잭션 제어를 **복제**해야 했다 — 순서가 두 곳이 되는 순간
 *    한쪽만 고쳐지는 날이 온다(운영 정본 §9.5-d3: "트랜잭션 제어는 한 곳에만").
 *
 *    `judge` 를 주지 않으면 예전 그대로 0024 판정을 쓴다.
 *    기존 호출부는 한 글자도 바뀌지 않는다.
 *
 * @param {{
 *   exec: (sql: string, label: string) => Promise<unknown>,
 *   sql: string,
 *   observe: () => Promise<{ table: string|null, columns: unknown, indexes: unknown }>,
 *   countTables: () => Promise<Record<string, number|null>>,
 *   beforeCounts: Record<string, number|null>,
 *   judge?: (observed: unknown) => { state: string, summary: string },
 * }} io
 */
export async function applyWithVerification(io) {
  /** 🔴 무엇을 어떤 차례로 불렀는가 — fixture 가 이것으로 순서를 확인한다 */
  const calls = []
  let committed = 0
  let rolledBack = 0

  const run = async (sql, label) => {
    calls.push(label)
    return io.exec(sql, label)
  }
  /** 🔴 ROLLBACK 자체가 실패해도 그 위에서 죽지 않는다 */
  const rollback = async () => {
    try {
      await run('ROLLBACK', 'ROLLBACK')
      rolledBack += 1
    } catch {
      calls.push('ROLLBACK_FAILED')
    }
  }
  const done = (reason, state) => ({
    ok: false, committed, rolledBack, state: state ?? null, reason, calls,
  })

  try {
    await run('BEGIN', 'BEGIN')
  } catch (e) {
    // 🔴 트랜잭션이 열리지도 않았다. 되돌릴 것이 없다
    calls.push('BEGIN_FAILED')
    return done(`트랜잭션을 열지 못했다 — ${e?.message ?? e}`)
  }

  try {
    await run(io.sql, 'SQL')
  } catch (e) {
    await rollback()
    return done(`SQL 실행 실패 — 되돌렸다: ${e?.message ?? e}`)
  }

  // ── 🔴 같은 트랜잭션 안에서 다시 관측한다 ──
  let after
  let afterCounts
  try {
    calls.push('OBSERVE')
    after = await io.observe()
    calls.push('COUNT')
    afterCounts = await io.countTables()
  } catch (e) {
    // 🔴 관측이 안 되면 "됐는지" 를 말할 수 없다. 말할 수 없으면 되돌린다
    await rollback()
    return done(`검증 관측 실패 — 되돌렸다: ${e?.message ?? e}`, 'OBSERVATION_FAILED')
  }

  // 🔴 주지 않으면 0024 판정이 기본이다 — 기존 호출부의 동작은 그대로다
  const judge = io.judge ?? judgeMigrationState
  const verdict = judge(after)
  if (verdict.state !== 'APPLIED_AND_VALID') {
    await rollback()
    return done(`COMMIT 전 검증 실패 — 되돌렸다: ${verdict.summary}`, verdict.state)
  }

  // 🔴 기존 테이블 row 는 **하나도** 변하면 안 된다. additive 마이그레이션이다
  const keys = new Set([...Object.keys(io.beforeCounts), ...Object.keys(afterCounts)])
  const moved = [...keys].filter((k) => io.beforeCounts[k] !== afterCounts[k])
  if (moved.length > 0) {
    await rollback()
    return done(
      `기존 row 가 변했다 — 되돌렸다: ${moved.map((k) => `${k} ${io.beforeCounts[k]}→${afterCounts[k]}`).join(' · ')}`,
      verdict.state,
    )
  }

  try {
    await run('COMMIT', 'COMMIT')
    committed += 1
  } catch (e) {
    // 🔴 COMMIT 이 실패했으면 성공이 아니다. 여기서 성공으로 보고하면 거짓말이 된다
    await rollback()
    return done(`COMMIT 실패 — ${e?.message ?? e}`, verdict.state)
  }

  return {
    ok: true,
    committed,
    rolledBack,
    state: verdict.state,
    reason: `COMMIT 전 검증 통과 — ${verdict.summary}`,
    calls,
  }
}
