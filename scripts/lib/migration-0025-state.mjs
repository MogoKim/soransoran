/**
 * 0025 마이그레이션 **상태 판정** — 🔴 순수 함수. DB·네트워크·파일 IO 없음
 *
 * 🔴 **왜 0024 판정을 재사용하지 않는가.**
 *
 *    0024 는 *이미 있는 테이블에 컬럼을 더하는* 마이그레이션이었다.
 *    그래서 "컬럼이 0개면 관측 실패" 가 성립했다 — 테이블이 없을 리가 없으니까.
 *
 *    0025 는 **테이블 자체를 만든다.** 여기서는 테이블이 없는 것이 오류가 아니라
 *    `NOT_APPLIED` 라는 정상 상태다. 같은 판정을 쓰면 적용 전 상태가 전부
 *    `OBSERVATION_FAILED` 로 잡힌다 — 사람이 봐야 할 것과 아닌 것이 뒤섞인다.
 *
 *    0024 주석이 적어 둔 원칙 그대로다: 가드를 느슨하게 고치지 않고,
 *    **대상을 못박은 판정을 따로** 만든다.
 *
 * 🔴 **이 파일은 아무것도 읽지 않는다.** 넘겨받은 metadata 만 본다.
 *    그래야 네 상태를 production 에 쓰지 않고 전부 시험할 수 있다.
 *
 * 🔴 `.mjs` 인 이유: `node scripts/apply-migration-0025.mjs` 가 tsx 없이 돌아야 한다.
 */

export const MIGRATION_ID = '0025_hero_banner'
export const NEW_TABLE = 'HeroBanner'
export const NEW_ENUM = 'HeroBannerLinkKind'

/**
 * enum 라벨 — 🔴 **순서까지 계약이다.**
 *
 *    Postgres enum 은 정의 순서가 정렬 순서다. 나중에 누가 값을 끼워 넣으면
 *    같은 세 값이라도 `ORDER BY linkKind` 결과가 달라진다.
 *    집합이 아니라 배열로 비교하는 이유다.
 */
export const ENUM_LABELS = ['NONE', 'INTERNAL', 'EXTERNAL']

/**
 * 🔴 **컬럼 16개.** migration.sql 실측이다 (2026-09-14).
 *
 *    앞선 조사 보고서가 "17개" 라고 적었는데 오산이었다. 세어 본 것이 아니라
 *    모델을 눈으로 훑어 적은 숫자였다. 숫자를 틀리면 `--check` 가 늘
 *    "컬럼 누락 1종" 을 말하면서도 **무엇이 빠졌는지는 말하지 못한다** —
 *    0024 가 다른 테이블 컬럼 이름을 베껴 42703 으로 죽었던 것과 같은 종류의 사고다.
 *
 * `dataType` 은 information_schema.columns.data_type 값이다.
 * `defaultContains` 는 column_default 에 **들어 있어야 하는 조각**이다 —
 * Postgres 가 `'NONE'::"HeroBannerLinkKind"` 처럼 캐스팅을 붙여 돌려주기 때문에
 * 통째로 비교하지 않는다. null 이면 "default 가 없어야 한다" 는 뜻이다.
 */
export const EXPECTED_COLUMNS = [
  { name: 'id', dataType: 'text', nullable: false, defaultContains: null },
  { name: 'name', dataType: 'text', nullable: false, defaultContains: null },
  { name: 'alt', dataType: 'text', nullable: false, defaultContains: null },
  { name: 'mobileImageKey', dataType: 'text', nullable: true, defaultContains: null },
  { name: 'desktopImageKey', dataType: 'text', nullable: true, defaultContains: null },
  {
    name: 'linkKind',
    dataType: 'USER-DEFINED',
    udtName: NEW_ENUM,
    nullable: false,
    defaultContains: 'NONE',
  },
  { name: 'linkUrl', dataType: 'text', nullable: true, defaultContains: null },
  { name: 'sortOrder', dataType: 'integer', nullable: false, defaultContains: null },
  { name: 'isActive', dataType: 'boolean', nullable: false, defaultContains: 'false' },
  { name: 'startsAt', dataType: 'timestamp without time zone', nullable: true, defaultContains: null },
  { name: 'endsAt', dataType: 'timestamp without time zone', nullable: true, defaultContains: null },
  { name: 'archivedAt', dataType: 'timestamp without time zone', nullable: true, defaultContains: null },
  { name: 'createdByUserId', dataType: 'text', nullable: true, defaultContains: null },
  { name: 'updatedByUserId', dataType: 'text', nullable: true, defaultContains: null },
  {
    name: 'createdAt',
    dataType: 'timestamp without time zone',
    nullable: false,
    defaultContains: 'CURRENT_TIMESTAMP',
  },
  { name: 'updatedAt', dataType: 'timestamp without time zone', nullable: false, defaultContains: null },
]

/** 🔴 PK 를 포함해 4개다. pkey 를 빼고 세면 "인덱스 3개" 가 되어 계약이 어긋난다. */
export const EXPECTED_INDEXES = [
  'HeroBanner_pkey',
  'HeroBanner_isActive_archivedAt_sortOrder_idx',
  'HeroBanner_startsAt_idx',
  'HeroBanner_endsAt_idx',
]

/**
 * FK 2개 — 🔴 **삭제·갱신 동작까지 계약이다.**
 *
 *    `confdeltype='n'` = ON DELETE SET NULL — 사람이 떠나도 배너는 남는다.
 *    누가 이것을 CASCADE 로 바꾸면 **운영자 탈퇴가 배너를 지운다.**
 *    이름만 보고 "FK 2개 있음" 으로 끝내면 그 사고를 잡지 못한다.
 */
export const EXPECTED_FOREIGN_KEYS = [
  {
    name: 'HeroBanner_createdByUserId_fkey',
    column: 'createdByUserId',
    referencedTable: 'User',
    referencedColumn: 'id',
    onDelete: 'n',
    onUpdate: 'c',
  },
  {
    name: 'HeroBanner_updatedByUserId_fkey',
    column: 'updatedByUserId',
    referencedTable: 'User',
    referencedColumn: 'id',
    onDelete: 'n',
    onUpdate: 'c',
  },
]

/** 🔴 이 테이블들의 row count 는 변하면 안 된다 */
export const PROTECTED_TABLES = [
  'User',
  'Post',
  'Comment',
  'Persona',
  'MicroSeedRawContent',
  'MicroSeedCandidate',
  'PersonaApprovalQueue',
  'OriginalPostApprovalQueue',
  'HomeExposureOverride',
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
 * @typedef {{ column_name: string, data_type: string, udt_name?: string,
 *             is_nullable: string, column_default: string|null }} ColumnMeta
 * @typedef {{ conname: string, column: string, referencedTable: string,
 *             referencedColumn: string, confdeltype: string, confupdtype: string }} FkMeta
 * @typedef {{ code: string, ok: boolean, detail: string }} Finding
 * @typedef {{
 *   state: 'NOT_APPLIED'|'APPLIED_AND_VALID'|'PARTIAL_OR_INVALID'|'OBSERVATION_FAILED',
 *   findings: Finding[],
 *   summary: string,
 *   exitCode: number,
 * }} MigrationVerdict
 */

/**
 * 🔴 관측 자체가 성립했는가.
 *
 *    성립하지 않으면 그 뒤 판정은 전부 뜻이 없다.
 *    **"없다" 와 "못 읽었다" 는 다르다** — 전자는 null, 후자는 모양이 틀린 값이다.
 */
function judgeObservation(input) {
  if (input === null || typeof input !== 'object') return '관측값이 없다'

  // 테이블: 이름이거나 null(없음). 다른 이름이면 엉뚱한 것을 본 것이다.
  if (input.table !== null && input.table !== NEW_TABLE) {
    return `다른 테이블의 metadata 다 — ${String(input.table)} (기대 ${NEW_TABLE})`
  }
  if (input.enumLabels !== null && !Array.isArray(input.enumLabels)) {
    return 'enum 라벨을 읽지 못했다'
  }
  if (input.columns !== null && !Array.isArray(input.columns)) {
    return '컬럼 metadata 를 읽지 못했다'
  }
  if (input.indexes !== null && !Array.isArray(input.indexes)) {
    return '인덱스 metadata 를 읽지 못했다'
  }
  if (input.foreignKeys !== null && !Array.isArray(input.foreignKeys)) {
    return 'FK metadata 를 읽지 못했다'
  }

  // 🔴 테이블이 있다고 했으면 컬럼도 읽혔어야 한다. 안 읽혔으면 권한 문제다.
  if (input.table === NEW_TABLE) {
    if (!Array.isArray(input.columns)) return '테이블은 있는데 컬럼을 읽지 못했다 — 권한을 확인한다'
    if (input.columns.length === 0) return '테이블은 있는데 컬럼이 0개다 — 권한이 없다'
    for (const c of input.columns) {
      if (c === null || typeof c !== 'object' || typeof c.column_name !== 'string') {
        return '컬럼 metadata 의 모양이 아니다'
      }
    }
    if (input.rowCount !== null && !Number.isInteger(input.rowCount)) {
      return '행 수를 읽지 못했다'
    }
  }

  return null
}

function verdictOf(state, findings, summary, exitCode) {
  return { state, findings, summary, exitCode }
}

/**
 * 🔴 **metadata 만 보고 상태를 정한다.**
 *
 * @param {{
 *   table: string|null,
 *   enumLabels: string[]|null,
 *   columns: ColumnMeta[]|null,
 *   indexes: string[]|null,
 *   foreignKeys: FkMeta[]|null,
 *   rowCount: number|null,
 * }} input
 * @returns {MigrationVerdict}
 */
export function judgeMigration0025State(input) {
  const bad = judgeObservation(input)
  if (bad !== null) {
    return verdictOf(
      'OBSERVATION_FAILED',
      [{ code: 'OBSERVATION', ok: false, detail: bad }],
      `🔴 관측 실패 — ${bad}`,
      1,
    )
  }

  const hasEnum = Array.isArray(input.enumLabels)
  const hasTable = input.table === NEW_TABLE

  /**
   * 🔴 **둘 다 없을 때만 미적용이다.**
   *
   *    enum 만 있거나 테이블만 있으면 `PARTIAL_OR_INVALID` 다.
   *    "아직 안 했네" 로 뭉개면 `--apply` 가 그 위에 다시 CREATE 를 시도하고,
   *    이미 있는 enum 때문에 트랜잭션이 통째로 깨진다.
   *    반대로 "이미 적용됨" 으로 뭉개면 반쪽짜리 스키마를 정상이라고 말하게 된다.
   */
  if (!hasEnum && !hasTable) {
    return verdictOf(
      'NOT_APPLIED',
      [
        { code: 'ENUM', ok: true, detail: `enum ${NEW_ENUM} 없음 (미적용)` },
        { code: 'TABLE', ok: true, detail: `테이블 ${NEW_TABLE} 없음 (미적용)` },
      ],
      `미적용 — ${MIGRATION_ID} 의 enum 1개·테이블 1개가 아직 없다`,
      // 🔴 controlled exit 1 — "확인했더니 아직 아니다" 도 통과가 아니다
      1,
    )
  }

  /** @type {Finding[]} */
  const findings = []

  // ── enum ──
  if (!hasEnum) {
    findings.push({ code: 'ENUM', ok: false, detail: `🔴 enum ${NEW_ENUM} 이 없다` })
  } else {
    const same =
      input.enumLabels.length === ENUM_LABELS.length &&
      ENUM_LABELS.every((label, i) => input.enumLabels[i] === label)
    findings.push({
      code: 'ENUM',
      ok: same,
      detail: same
        ? `enum ${NEW_ENUM} — ${ENUM_LABELS.join(' · ')} (순서 일치)`
        : `🔴 enum 값이 다르다 — ${input.enumLabels.join(' · ')} (기대 ${ENUM_LABELS.join(' · ')})`,
    })
  }

  // ── 테이블 ──
  findings.push({
    code: 'TABLE',
    ok: hasTable,
    detail: hasTable ? `테이블 ${NEW_TABLE} 있음` : `🔴 테이블 ${NEW_TABLE} 이 없다`,
  })

  if (!hasTable) {
    const why = findings.filter((f) => !f.ok).map((f) => f.detail)
    return verdictOf(
      'PARTIAL_OR_INVALID',
      findings,
      `🔴 일부만 적용됐다 — ${why.join(' / ')}`,
      1,
    )
  }

  const columns = input.columns ?? []
  const indexes = input.indexes ?? []
  const foreignKeys = input.foreignKeys ?? []
  const names = columns.map((c) => c.column_name)

  // ── 컬럼 16개 ──
  const missing = EXPECTED_COLUMNS.filter((c) => !names.includes(c.name)).map((c) => c.name)
  const extra = names.filter((n) => !EXPECTED_COLUMNS.some((c) => c.name === n))
  findings.push({
    code: 'COLUMN_SET',
    ok: missing.length === 0 && extra.length === 0,
    detail:
      missing.length === 0 && extra.length === 0
        ? `컬럼 ${EXPECTED_COLUMNS.length}/${EXPECTED_COLUMNS.length}`
        : `🔴 컬럼 불일치 — 누락 [${missing.join(', ') || '없음'}] · 예상 밖 [${extra.join(', ') || '없음'}]`,
  })

  // ── 컬럼 모양 ──
  for (const spec of EXPECTED_COLUMNS) {
    const got = columns.find((c) => c.column_name === spec.name)
    if (got === undefined) continue

    const typeOk =
      String(got.data_type) === spec.dataType &&
      (spec.udtName === undefined || String(got.udt_name ?? '') === spec.udtName)
    const nullableOk = (String(got.is_nullable) === 'YES') === spec.nullable
    const rawDefault = got.column_default === null || got.column_default === undefined
      ? null
      : String(got.column_default)
    const defaultOk =
      spec.defaultContains === null
        ? rawDefault === null
        : rawDefault !== null && rawDefault.includes(spec.defaultContains)

    const ok = typeOk && nullableOk && defaultOk
    const why = []
    if (!typeOk) why.push(`타입 ${got.data_type}${got.udt_name ? `/${got.udt_name}` : ''} (기대 ${spec.dataType}${spec.udtName ? `/${spec.udtName}` : ''})`)
    if (!nullableOk) why.push(`nullable ${got.is_nullable} (기대 ${spec.nullable ? 'YES' : 'NO'})`)
    if (!defaultOk) why.push(`default ${rawDefault ?? '없음'} (기대 ${spec.defaultContains ?? '없음'})`)

    findings.push({
      code: `COLUMN:${spec.name}`,
      ok,
      detail: ok ? `${spec.name} 모양 일치` : `🔴 ${spec.name} — ${why.join(' · ')}`,
    })
  }

  // ── 인덱스 4개 (PK 포함) ──
  const missingIdx = EXPECTED_INDEXES.filter((i) => !indexes.includes(i))
  findings.push({
    code: 'INDEXES',
    ok: missingIdx.length === 0,
    detail:
      missingIdx.length === 0
        ? `인덱스 ${EXPECTED_INDEXES.length}/${EXPECTED_INDEXES.length} (PK 포함)`
        : `🔴 인덱스 누락 ${missingIdx.length}종: ${missingIdx.join(', ')}`,
  })

  // ── FK 2개 · 참조 대상과 삭제 동작까지 ──
  for (const spec of EXPECTED_FOREIGN_KEYS) {
    const got = foreignKeys.find((f) => f.conname === spec.name)
    if (got === undefined) {
      findings.push({ code: `FK:${spec.name}`, ok: false, detail: `🔴 FK ${spec.name} 이 없다` })
      continue
    }
    const why = []
    if (String(got.column) !== spec.column) why.push(`컬럼 ${got.column}`)
    if (String(got.referencedTable) !== spec.referencedTable) why.push(`참조 테이블 ${got.referencedTable}`)
    if (String(got.referencedColumn) !== spec.referencedColumn) why.push(`참조 컬럼 ${got.referencedColumn}`)
    if (String(got.confdeltype) !== spec.onDelete) why.push(`ON DELETE ${got.confdeltype} (기대 SET NULL)`)
    if (String(got.confupdtype) !== spec.onUpdate) why.push(`ON UPDATE ${got.confupdtype} (기대 CASCADE)`)

    findings.push({
      code: `FK:${spec.name}`,
      ok: why.length === 0,
      detail:
        why.length === 0
          ? `${spec.name} → ${spec.referencedTable}.${spec.referencedColumn} · SET NULL · CASCADE`
          : `🔴 ${spec.name} — ${why.join(' · ')}`,
    })
  }

  const extraFk = foreignKeys.filter((f) => !EXPECTED_FOREIGN_KEYS.some((s) => s.name === f.conname))
  findings.push({
    code: 'FK_SET',
    ok: extraFk.length === 0,
    detail:
      extraFk.length === 0
        ? `FK ${EXPECTED_FOREIGN_KEYS.length}개 · 예상 밖 0`
        : `🔴 예상 밖 FK: ${extraFk.map((f) => f.conname).join(', ')}`,
  })

  // ── 빈 테이블로 만들어졌는가 ──
  if (input.rowCount !== null) {
    findings.push({
      code: 'ROW_COUNT',
      ok: input.rowCount === 0,
      detail:
        input.rowCount === 0
          ? `${NEW_TABLE} 0행 (빈 테이블)`
          : `🔴 ${NEW_TABLE} 에 ${input.rowCount}행이 있다 — 이 마이그레이션은 행을 만들지 않는다`,
    })
  }

  if (findings.every((f) => f.ok)) {
    return verdictOf(
      'APPLIED_AND_VALID',
      findings,
      `적용 완료 — enum 1 · 테이블 1 · 컬럼 ${EXPECTED_COLUMNS.length} · 인덱스 ${EXPECTED_INDEXES.length} · FK ${EXPECTED_FOREIGN_KEYS.length} · 0행`,
      0,
    )
  }

  const why = findings.filter((f) => !f.ok).map((f) => f.detail)
  return verdictOf(
    'PARTIAL_OR_INVALID',
    findings,
    `🔴 일부만 적용됐거나 모양이 다르다 — ${why.join(' / ')}`,
    1,
  )
}
