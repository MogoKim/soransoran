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

/**
 * 인덱스 계약 — 🔴 **이름만으로는 부족하다.**
 *
 *    앞선 판은 이름 문자열만 봤다. 그래서 같은 이름으로 **다른 컬럼**에 걸린
 *    인덱스가 통과했다. `HeroBanner_isActive_archivedAt_sortOrder_idx` 라는
 *    이름이 붙어 있어도 실제로 `(sortOrder)` 하나만 덮고 있으면
 *    홈 조회는 그 인덱스를 타지 못한다 — 이름은 맞는데 느려진다.
 *
 * 🔴 컬럼 **순서**도 계약이다. 복합 인덱스는 앞 컬럼부터 쓰이므로
 *    `(archivedAt, isActive, sortOrder)` 는 같은 세 컬럼이라도 다른 인덱스다.
 *
 * 🔴 PK 를 포함해 4개다. pkey 를 빼고 세면 "인덱스 3개" 가 되어 계약이 어긋난다.
 */
export const EXPECTED_INDEX_SPECS = [
  { name: 'HeroBanner_pkey', columns: ['id'], primary: true, unique: true },
  {
    name: 'HeroBanner_isActive_archivedAt_sortOrder_idx',
    columns: ['isActive', 'archivedAt', 'sortOrder'],
    primary: false,
    unique: false,
  },
  { name: 'HeroBanner_startsAt_idx', columns: ['startsAt'], primary: false, unique: false },
  { name: 'HeroBanner_endsAt_idx', columns: ['endsAt'], primary: false, unique: false },
]

/** 이름만 필요한 자리를 위해 파생한다 — 🔴 목록을 두 벌 적지 않는다. */
export const EXPECTED_INDEXES = EXPECTED_INDEX_SPECS.map((i) => i.name)

/**
 * SQL 이 `CREATE INDEX` 로 직접 만드는 것 — PK 는 제약(PRIMARY KEY)이 대신 만든다.
 * 🔴 그래서 SQL 계약에서 세는 수(3)와 DB 에서 보이는 수(4)가 다르다.
 */
export const SQL_CREATE_INDEX_SPECS = EXPECTED_INDEX_SPECS.filter((i) => !i.primary)

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

    if (!Array.isArray(input.indexes)) return '테이블은 있는데 인덱스를 읽지 못했다'
    for (const i of input.indexes) {
      if (i === null || typeof i !== 'object' || typeof i.name !== 'string' || !Array.isArray(i.columns)) {
        // 🔴 이름 문자열만 넘어오면 여기서 걸린다. 컬럼을 못 보는 관측은 관측이 아니다.
        return '인덱스 metadata 의 모양이 아니다 — 이름·컬럼·primary·unique 가 필요하다'
      }
    }

    if (!Array.isArray(input.foreignKeys)) return '테이블은 있는데 FK 를 읽지 못했다'

    /**
     * 🔴 **행 수는 반드시 0 이상의 정수다** (2026-09-14 정정).
     *
     *    앞선 판은 `rowCount !== null` 일 때만 정수인지 봤다. 그래서
     *    `rowCount: null` 이 **관측 실패가 아니라 "검사 생략"** 으로 흘러
     *    `APPLIED_AND_VALID` · exit 0 이 나왔다 — 실측으로 재현했다.
     *    COUNT 를 못 읽었는데 "빈 테이블이 맞다" 고 말한 셈이다.
     *
     *    테이블이 있으면 COUNT 는 언제나 읽힌다. 안 읽혔으면 권한이나 연결 문제다.
     */
    if (!Number.isInteger(input.rowCount) || input.rowCount < 0) {
      return `행 수를 읽지 못했다 (${String(input.rowCount)}) — 테이블이 있으면 0 이상의 정수여야 한다`
    }
  }

  return null
}

/**
 * 🔴 **보호 테이블의 행 수를 읽었는가** (결함 D).
 *
 *    CLI 의 `counts()` 는 테이블이 없으면 null 을 넣었다. 그러면 적용 전후가
 *    **둘 다 null** 이라 "변하지 않았다" 로 통과한다 — 실제로는 그 테이블을
 *    한 번도 못 본 것이다. 보호하겠다고 적어 둔 목록이 보호를 하지 않는다.
 *
 *    없어야 할 테이블이 아니다. `User` · `Post` 는 반드시 있다.
 *    없다면 다른 DB 를 보고 있거나 권한이 없는 것이고, 둘 다 진행하면 안 되는 상황이다.
 *
 * @param {Record<string, number|null|undefined>} counts
 * @returns {{ ok: boolean, reason: string }}
 */
export function judgeProtectedCounts(counts) {
  if (counts === null || typeof counts !== 'object') {
    return { ok: false, reason: '보호 테이블 행 수를 읽지 못했다' }
  }
  const missing = PROTECTED_TABLES.filter((t) => !(t in counts))
  if (missing.length > 0) {
    return { ok: false, reason: `보호 테이블이 관측에서 빠졌다: ${missing.join(', ')}` }
  }
  const unreadable = PROTECTED_TABLES.filter(
    (t) => !Number.isInteger(counts[t]) || Number(counts[t]) < 0,
  )
  if (unreadable.length > 0) {
    return {
      ok: false,
      reason: `보호 테이블의 행 수가 정수가 아니다: ${unreadable.map((t) => `${t}=${String(counts[t])}`).join(', ')}`,
    }
  }
  return { ok: true, reason: `보호 테이블 ${PROTECTED_TABLES.length}개 전부 행 수를 읽었다` }
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

  // ── 인덱스 4개 (PK 포함) — 🔴 이름·컬럼·순서·primary·unique 전부 ──
  for (const spec of EXPECTED_INDEX_SPECS) {
    const got = indexes.find((i) => i.name === spec.name)
    if (got === undefined) {
      findings.push({ code: `INDEX:${spec.name}`, ok: false, detail: `🔴 인덱스 ${spec.name} 이 없다` })
      continue
    }
    const why = []
    if (String(got.table ?? NEW_TABLE) !== NEW_TABLE) why.push(`대상 테이블 ${got.table}`)
    // 🔴 순서까지 본다 — 복합 인덱스는 앞 컬럼부터 쓰인다
    const sameColumns =
      Array.isArray(got.columns) &&
      got.columns.length === spec.columns.length &&
      spec.columns.every((c, i) => got.columns[i] === c)
    if (!sameColumns) why.push(`컬럼 [${(got.columns ?? []).join(', ')}] (기대 [${spec.columns.join(', ')}])`)
    if (Boolean(got.isPrimary) !== spec.primary) why.push(`primary=${Boolean(got.isPrimary)}`)
    if (Boolean(got.isUnique) !== spec.unique) why.push(`unique=${Boolean(got.isUnique)}`)

    findings.push({
      code: `INDEX:${spec.name}`,
      ok: why.length === 0,
      detail:
        why.length === 0
          ? `${spec.name} (${spec.columns.join(', ')})${spec.primary ? ' · PK' : ''}`
          : `🔴 ${spec.name} — ${why.join(' · ')}`,
    })
  }

  const extraIdx = indexes.filter((i) => !EXPECTED_INDEX_SPECS.some((s) => s.name === i.name))
  findings.push({
    code: 'INDEX_SET',
    ok: extraIdx.length === 0,
    detail:
      extraIdx.length === 0
        ? `인덱스 ${EXPECTED_INDEX_SPECS.length}/${EXPECTED_INDEX_SPECS.length} (PK 포함) · 예상 밖 0`
        : `🔴 예상 밖 인덱스: ${extraIdx.map((i) => i.name).join(', ')}`,
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

// ─────────── SQL 계약 (결함 A) ───────────

/**
 * 🔴 **SQL 이 계약 그대로인가** — 구문의 *시작*만 보지 않는다.
 *
 *    앞선 판의 화이트리스트는 `^CREATE TABLE` 인지만 봤다. 그래서
 *    `CREATE TABLE "Evil" (...)` 도, `CREATE INDEX ... ON "User"(...)` 도
 *    통과한다. 파일을 고치는 사람이 한 줄 더 붙여도 아무도 막지 못한다.
 *
 *    여기서는 **무엇이 몇 개 있고 각각 무엇을 가리키는지**까지 못박는다.
 *    실행문 7개 — enum 1 · 테이블 1 · 인덱스 3 · FK 2.
 *
 * 🔴 이 검사는 **DB 에 연결하기 전에** 돈다. 잘못된 SQL 때문에
 *    production 에 접속조차 하지 않게 하려는 것이다.
 *
 * 🔴 순수 함수다 — 파일을 읽지 않고 **읽어 온 문자열**을 받는다.
 *    그래야 fixture 가 가짜 SQL 로 차단 경로를 전부 시험할 수 있다.
 *
 * @param {string} sqlText migration.sql 원문
 * @returns {{ ok: boolean, findings: {code:string, ok:boolean, detail:string}[], summary: string }}
 */
export function judgeMigration0025Sql(sqlText) {
  /** @type {{code:string, ok:boolean, detail:string}[]} */
  const findings = []
  const add = (code, ok, detail) => findings.push({ code, ok, detail })

  if (typeof sqlText !== 'string' || sqlText.trim() === '') {
    return {
      ok: false,
      findings: [{ code: 'SQL', ok: false, detail: '🔴 SQL 을 읽지 못했다' }],
      summary: '🔴 SQL 을 읽지 못했다',
    }
  }

  // 주석을 걷어 내고 공백을 눌러 한 줄로 만든다 — 구문이 여러 줄에 걸쳐 있다
  const body = sqlText
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
  const statements = body
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s !== '')

  add('STATEMENT_COUNT', statements.length === 7,
    statements.length === 7
      ? '실행문 7개'
      : `🔴 실행문이 ${statements.length}개다 (기대 7) — enum 1 · 테이블 1 · 인덱스 3 · FK 2`)

  // ── CREATE TYPE ──
  const types = statements.filter((s) => /^CREATE TYPE\b/i.test(s))
  add('CREATE_TYPE_COUNT', types.length === 1,
    types.length === 1 ? 'CREATE TYPE 1개' : `🔴 CREATE TYPE 이 ${types.length}개다`)
  if (types.length === 1) {
    const m = /^CREATE TYPE "([A-Za-z0-9_]+)" AS ENUM \(([^)]*)\)$/i.exec(types[0])
    if (m === null) {
      add('ENUM_SHAPE', false, `🔴 CREATE TYPE 구문의 모양이 아니다`)
    } else {
      add('ENUM_NAME', m[1] === NEW_ENUM,
        m[1] === NEW_ENUM ? `enum 이름 ${NEW_ENUM}` : `🔴 enum 이름이 ${m[1]} 이다`)
      const labels = m[2].split(',').map((s) => s.trim().replace(/^'|'$/g, ''))
      const same = labels.length === ENUM_LABELS.length && ENUM_LABELS.every((l, i) => labels[i] === l)
      add('ENUM_LABELS', same,
        same ? `enum 라벨 ${ENUM_LABELS.join(' · ')} (순서 일치)`
             : `🔴 enum 라벨이 다르다 — ${labels.join(' · ')}`)
    }
  }

  // ── CREATE TABLE ──
  const tables = statements.filter((s) => /^CREATE TABLE\b/i.test(s))
  add('CREATE_TABLE_COUNT', tables.length === 1,
    tables.length === 1 ? 'CREATE TABLE 1개' : `🔴 CREATE TABLE 이 ${tables.length}개다`)
  const tableNames = tables.map((s) => /^CREATE TABLE "([A-Za-z0-9_]+)"/i.exec(s)?.[1] ?? '?')
  add('CREATE_TABLE_TARGET', tableNames.every((n) => n === NEW_TABLE),
    tableNames.every((n) => n === NEW_TABLE)
      ? `테이블 ${NEW_TABLE} 하나만 만든다`
      : `🔴 다른 테이블을 만든다: ${tableNames.filter((n) => n !== NEW_TABLE).join(', ')}`)

  // ── CREATE INDEX — 🔴 이름·대상·컬럼 순서까지 ──
  const idxStatements = statements.filter((s) => /^CREATE (UNIQUE )?INDEX\b/i.test(s))
  add('CREATE_INDEX_COUNT', idxStatements.length === SQL_CREATE_INDEX_SPECS.length,
    idxStatements.length === SQL_CREATE_INDEX_SPECS.length
      ? `CREATE INDEX ${SQL_CREATE_INDEX_SPECS.length}개 (PK 는 제약이 만든다)`
      : `🔴 CREATE INDEX 가 ${idxStatements.length}개다 (기대 ${SQL_CREATE_INDEX_SPECS.length})`)

  const parsedIdx = idxStatements.map((s) => {
    const m = /^CREATE (UNIQUE )?INDEX "([A-Za-z0-9_]+)" ON "([A-Za-z0-9_]+)" ?\(([^)]*)\)$/i.exec(s)
    if (m === null) return null
    return {
      unique: m[1] !== undefined,
      name: m[2],
      table: m[3],
      columns: m[4].split(',').map((c) => c.trim().replace(/"/g, '')),
    }
  })
  add('INDEX_SHAPE', parsedIdx.every((p) => p !== null),
    parsedIdx.every((p) => p !== null) ? 'CREATE INDEX 구문의 모양이 맞다' : '🔴 읽지 못한 CREATE INDEX 가 있다')

  const badTarget = parsedIdx.filter((p) => p !== null && p.table !== NEW_TABLE)
  add('INDEX_TARGET', badTarget.length === 0,
    badTarget.length === 0
      ? `인덱스 대상이 전부 ${NEW_TABLE}`
      : `🔴 다른 테이블에 인덱스를 만든다: ${badTarget.map((p) => `${p.name}→${p.table}`).join(', ')}`)

  for (const spec of SQL_CREATE_INDEX_SPECS) {
    const got = parsedIdx.find((p) => p !== null && p.name === spec.name)
    if (got === undefined) {
      add(`INDEX_SQL:${spec.name}`, false, `🔴 인덱스 ${spec.name} 을 만들지 않는다`)
      continue
    }
    const sameCols =
      got.columns.length === spec.columns.length && spec.columns.every((c, i) => got.columns[i] === c)
    add(`INDEX_SQL:${spec.name}`, sameCols && got.unique === spec.unique,
      sameCols && got.unique === spec.unique
        ? `${spec.name} (${spec.columns.join(', ')})`
        : `🔴 ${spec.name} — 컬럼 [${got.columns.join(', ')}] (기대 [${spec.columns.join(', ')}])${got.unique !== spec.unique ? ` · unique=${got.unique}` : ''}`)
  }
  const extraIdxSql = parsedIdx.filter(
    (p) => p !== null && !SQL_CREATE_INDEX_SPECS.some((s) => s.name === p.name),
  )
  add('INDEX_SQL_SET', extraIdxSql.length === 0,
    extraIdxSql.length === 0 ? '예상 밖 인덱스 0'
      : `🔴 예상 밖 인덱스를 만든다: ${extraIdxSql.map((p) => p.name).join(', ')}`)

  // ── ALTER TABLE — FK 2개만 ──
  const alters = statements.filter((s) => /^ALTER TABLE\b/i.test(s))
  add('ALTER_COUNT', alters.length === EXPECTED_FOREIGN_KEYS.length,
    alters.length === EXPECTED_FOREIGN_KEYS.length
      ? `ALTER TABLE ${EXPECTED_FOREIGN_KEYS.length}개 (FK 추가)`
      : `🔴 ALTER TABLE 이 ${alters.length}개다 (기대 ${EXPECTED_FOREIGN_KEYS.length})`)

  const parsedFk = alters.map((s) => {
    const m = /^ALTER TABLE "([A-Za-z0-9_]+)" ADD CONSTRAINT "([A-Za-z0-9_]+)" FOREIGN KEY \("([A-Za-z0-9_]+)"\) REFERENCES "([A-Za-z0-9_]+)"\("([A-Za-z0-9_]+)"\) ON DELETE ([A-Z ]+) ON UPDATE ([A-Z]+)$/i.exec(s)
    if (m === null) return null
    return {
      table: m[1], name: m[2], column: m[3],
      referencedTable: m[4], referencedColumn: m[5],
      onDelete: m[6].trim().toUpperCase(), onUpdate: m[7].trim().toUpperCase(),
    }
  })
  add('ALTER_SHAPE', parsedFk.every((p) => p !== null),
    parsedFk.every((p) => p !== null)
      ? 'ALTER TABLE 이 전부 FK 추가다'
      : '🔴 FK 추가가 아닌 ALTER TABLE 이 있다')

  const badAlterTarget = parsedFk.filter((p) => p !== null && p.table !== NEW_TABLE)
  add('ALTER_TARGET', badAlterTarget.length === 0,
    badAlterTarget.length === 0
      ? `ALTER 대상이 ${NEW_TABLE} 뿐`
      : `🔴 다른 테이블을 ALTER 한다: ${badAlterTarget.map((p) => p.table).join(', ')}`)

  for (const spec of EXPECTED_FOREIGN_KEYS) {
    const got = parsedFk.find((p) => p !== null && p.name === spec.name)
    if (got === undefined) {
      add(`FK_SQL:${spec.name}`, false, `🔴 FK ${spec.name} 을 만들지 않는다`)
      continue
    }
    const why = []
    if (got.column !== spec.column) why.push(`컬럼 ${got.column}`)
    if (got.referencedTable !== spec.referencedTable) why.push(`참조 ${got.referencedTable}`)
    if (got.referencedColumn !== spec.referencedColumn) why.push(`참조 컬럼 ${got.referencedColumn}`)
    if (got.onDelete !== 'SET NULL') why.push(`ON DELETE ${got.onDelete}`)
    if (got.onUpdate !== 'CASCADE') why.push(`ON UPDATE ${got.onUpdate}`)
    add(`FK_SQL:${spec.name}`, why.length === 0,
      why.length === 0
        ? `${spec.name} → ${spec.referencedTable}.${spec.referencedColumn} · SET NULL · CASCADE`
        : `🔴 ${spec.name} — ${why.join(' · ')}`)
  }
  const extraFkSql = parsedFk.filter(
    (p) => p !== null && !EXPECTED_FOREIGN_KEYS.some((s) => s.name === p.name),
  )
  add('FK_SQL_SET', extraFkSql.length === 0,
    extraFkSql.length === 0 ? '예상 밖 FK 0'
      : `🔴 예상 밖 FK 를 만든다: ${extraFkSql.map((p) => p.name).join(', ')}`)

  // ── 🔴 그 밖의 구문은 하나도 없어야 한다 ──
  const others = statements.filter(
    (s) => !/^(CREATE TYPE|CREATE TABLE|CREATE (UNIQUE )?INDEX|ALTER TABLE)\b/i.test(s),
  )
  add('NO_OTHER_STATEMENTS', others.length === 0,
    others.length === 0 ? '허용 밖 구문 0'
      : `🔴 허용 밖 구문 ${others.length}건: ${others.map((s) => s.slice(0, 40)).join(' / ')}`)

  // ── 계약에 없는 컬럼 이름 ──
  add('NO_URL_COLUMN', !/"(mobileImageUrl|desktopImageUrl|imageUrl)"/i.test(body),
    !/"(mobileImageUrl|desktopImageUrl|imageUrl)"/i.test(body)
      ? '공개 URL 컬럼 0' : '🔴 공개 이미지 URL 컬럼이 있다 — R2 object key 만 담는다')
  add('NO_POPUP_TYPE', !/"(type|bannerType|campaignId)" /i.test(body),
    !/"(type|bannerType|campaignId)" /i.test(body)
      ? 'popup type · campaignId 0' : '🔴 popup type 또는 campaignId 컬럼이 있다')

  const ok = findings.every((f) => f.ok)
  return {
    ok,
    findings,
    summary: ok
      ? `SQL 계약 일치 — 실행문 7개 (enum 1 · 테이블 1 · 인덱스 ${SQL_CREATE_INDEX_SPECS.length} · FK ${EXPECTED_FOREIGN_KEYS.length})`
      : `🔴 SQL 이 계약과 다르다 — ${findings.filter((f) => !f.ok).map((f) => f.detail).join(' / ')}`,
  }
}
