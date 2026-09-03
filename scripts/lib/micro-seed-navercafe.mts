/**
 * 네이버 카페 수집 — 순수 함수 · 정책 상수 (PR-S2-b-2)
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-A · §5 · §5-A~D
 *       docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §6-9-F (공급 cron 개방)
 *
 * 🔴 **이 파일은 네트워크를 타지 않는다.** Playwright 도 fetch 도 없다.
 *    문자열을 받아 문자열·객체를 돌려줄 뿐이라 fixture 가 네트워크 없이 전부 검증한다.
 *    브라우저를 여는 것은 collector 하나뿐이다.
 *
 * 🔴 **82cook 과 결정적으로 다른 두 가지**
 *
 *      82cook      fetch() HTTP · 정직한 봇 UA · DELAY_MS 2000 **고정**
 *      네이버      🔴 실제 로그인 세션 · **사람 속도** · randomDelay(base, 0.8, 1.5)
 *
 *    82cook 은 우리가 봇임을 밝히고 읽는다. 그게 맞다.
 *    네이버는 **로그인한 사람으로** 읽는다 — 그러면 pacing 도 사람이어야 한다.
 *
 *    🔴 이것은 **자연화이지 우회가 아니다.**
 *       UA 위장 · IP 로테이션 · 캡차 우회 · robots 무시는 하지 않는다.
 *       하는 것은 "사람이 실제로 읽는 속도" 뿐이다.
 *
 * 🔴 **실패 비용이 다르다.** 82cook 이 막히면 IP 이고 네트워크를 바꾸면 회복된다
 *    (2026-09-03 실측). 네이버가 막히면 **계정**이고 그건 되돌릴 수 없다.
 *    그래서 quota 가 82cook 30 대 네이버 10 이다.
 */
import { createHash } from 'node:crypto'
import { assessCandidate, type QualityAssessment } from './micro-seed-quality.mjs'
import { NAVERCAFE_PREFIX, isNaverCafeSource, slotQuotaOf } from './micro-seed-supply.mjs'

// ─────────────────────────────────────────────────────────
// 카페 설정
// ─────────────────────────────────────────────────────────

export type CafeStage = 'production' | 'core' | 'shadow'

export type CafeConfig = {
  /** 네이버 카페 URL 의 영문 ID — `cafe.naver.com/{cafeId}` */
  cafeId: string
  /** 사람이 읽는 이름. 🔴 판정에 쓰지 않는다 */
  label: string
  /**
   * 🔴 `stage` 는 **얼마나 조심할 것인가**이지 주제가 아니다.
   *    shadow 는 수집은 하되 Original Post 재료로 바로 쓰지 않는다.
   */
  stage: CafeStage
  /**
   * 🔴 **경향 메모일 뿐 고정 라벨이 아니다.**
   *    코드가 이 값을 읽어 판정하지 않는다 — 사람이 카페를 고를 때 보는 메모다.
   *    주제·소재 판정은 **글 단위**로 한다(qualityFlags · Originality Gate).
   *    "이 카페는 갱년기 카페" 로 굳히면 그 카페의 다른 글을 잘못 읽고,
   *    다른 카페의 갱년기 글을 놓친다.
   */
  note: string
}

/**
 * 수집 대상 카페.
 *
 * 🔴 우나어 `agents/cafe/config.ts` 의 **게시판 목록(menuId 57개)을 가져오지 않았다.**
 *    우리는 전체글보기 한 곳만 읽는다 — 게시판을 훑는 것은 요청 수를 몇 배로 늘린다.
 *
 * 🔴 `popular-sync` 를 이식하지 않는다. 우나어는 인기글 전용 슬롯을 3회/day 돌렸지만
 *    소란소란은 그 개념을 **82cook 수집 슬롯**이 대신한다(설계 §4-A).
 */
export const CAFES: readonly CafeConfig[] = [
  {
    cafeId: 'remonterrace',
    label: '레몬테라스',
    stage: 'production',
    note: '4050 여성 핵심 생활권. 갱년기·몸 변화·가정·가족·생활이 섞인다',
  },
  {
    cafeId: 'wgang',
    label: '우아한 갱년기',
    stage: 'production',
    note: '4050 여성 핵심 생활권. 레몬테라스와 같은 축이며 주제가 겹친다',
  },
  {
    cafeId: 'dlxogns01',
    label: '은퇴 후 50년',
    stage: 'core',
    note: '노후·은퇴·돈·건강·미래 불안 비중이 높다',
  },
  {
    cafeId: 'masanmam',
    label: '줌마렐라',
    stage: 'core',
    note: '타겟층 일상·가족·생활 보강',
  },
  {
    cafeId: 'goondae',
    label: '군대카페',
    stage: 'core',
    note: '타겟층 일상·가족·생활 보강',
  },
  {
    cafeId: 'yeowooya',
    label: '여우야',
    stage: 'shadow',
    note: '🔴 뷰티·피부·미용·성형 관심사. 버리는 소스가 아니지만 public 발행 재료로 바로 쓰지 않는다',
  },
]

export function findCafe(cafeId: string): CafeConfig | null {
  return CAFES.find((c) => c.cafeId === cafeId) ?? null
}

/** 🔴 첫 live 는 여기서 시작한다. Raw Vault 에 이미 이 카페 행이 하나 있어 계약이 검증돼 있다 */
export const FIRST_LIVE_CAFE_ID = 'remonterrace'

// ─────────────────────────────────────────────────────────
// sourceSite · URL · articleId
// ─────────────────────────────────────────────────────────

/** `remonterrace` → `navercafe:remonterrace` (PR-S2-b-1 계약) */
export function sourceSiteOf(cafeId: string): string {
  return `${NAVERCAFE_PREFIX}${cafeId}`
}

/** 전체글보기 목록 — 🔴 게시판을 훑지 않는다 */
export const LIST_URL = (cafeId: string, page: number) =>
  `https://cafe.naver.com/${cafeId}?iframe_url=/ArticleList.nhn%3Fsearch.menuid=0%26search.page=${page}`

export const ARTICLE_URL = (cafeId: string, articleId: string) =>
  `https://cafe.naver.com/${cafeId}/${articleId}`

/**
 * 카페 글 URL 에서 articleId 를 뽑는다.
 *
 * 🔴 네이버는 URL 형태가 여러 가지다. 하나만 처리하면 나머지에서 조용히 null 이 되고,
 *    그러면 그 글이 수집에서 사라진다.
 *
 *      https://cafe.naver.com/remonterrace/34783204
 *      https://cafe.naver.com/f-e/cafes/10298136/articles/34783204
 *      /ArticleRead.nhn?clubid=10298136&articleid=34783204
 *      ?articleid=34783204&page=2
 */
export function parseArticleId(url: string): string | null {
  const patterns = [
    /\/articles\/(\d+)/,          // f-e 신형
    /[?&]articleid=(\d+)/i,       // 구형 쿼리
    /cafe\.naver\.com\/[^/?#]+\/(\d+)(?:[/?#]|$)/, // 표준 단축형
  ]
  for (const re of patterns) {
    const m = re.exec(url)
    if (m?.[1]) return m[1]
  }
  return null
}

/** 🔴 82cook 과 같은 함수식을 쓴다. sourceSite 에 cafeId 가 들어 있어 카페 간 충돌이 없다 */
export function computeDedupKey(sourceSite: string, sourceArticleId: string): string {
  const digest = createHash('sha256').update(`${sourceSite}::${sourceArticleId}`, 'utf8').digest('hex')
  return `sha256:${digest}`
}

// ─────────────────────────────────────────────────────────
// pacing — 🔴 사람 속도
// ─────────────────────────────────────────────────────────

/**
 * 우나어 `agents/cafe/crawler.ts` 의 산식을 그대로 쓴다.
 *
 * 🔴 82cook 의 `DELAY_MS = 2000` **고정**과 의도적으로 다르다.
 *    고정 간격은 "우리는 봇입니다" 를 정직하게 밝히는 것이고 82cook 에는 그게 맞다.
 *    네이버는 로그인한 사람으로 읽으므로 사람의 불규칙함이 있어야 한다.
 *
 * 🔴 `rand` 를 주입받는다 — fixture 가 난수 없이 경계를 검증할 수 있어야 한다.
 */
export function randomDelay(baseMs: number, minFactor = 0.8, maxFactor = 1.5, rand: () => number = Math.random): number {
  return Math.floor(baseMs * (minFactor + rand() * (maxFactor - minFactor)))
}

/** 목록 페이지 간 · 상세 글 간 기준 간격 (ms). 🔴 82cook(2000 고정)보다 느리다 */
export const DELAY_LIST_MS = 4000
export const DELAY_ARTICLE_MS = 3000

// ─────────────────────────────────────────────────────────
// quota
// ─────────────────────────────────────────────────────────

/**
 * 한 슬롯에서 여는 상세 수. 🔴 supply 의 소스별 quota 를 그대로 따른다 —
 * 여기서 숫자를 다시 적으면 두 값이 갈라진다.
 */
export function slotQuota(cafeId: string): number {
  return slotQuotaOf(sourceSiteOf(cafeId))
}

/** 🔴 첫 live 기본값 — 1카페 · 목록 1p · 상세 3건. 사람이 눈으로 볼 수 있는 양이다 */
export const FIRST_LIVE_PAGES = 1
export const FIRST_LIVE_ARTICLES = 3

// ─────────────────────────────────────────────────────────
// 세션 · 락 판정 (🔴 순수 함수)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **소란소란 전용 세션만 쓴다.**
 *    우나어 `agents/cafe/storage-state.json` 을 재사용하지 않는다 —
 *    한쪽이 막히면 둘 다 멈추고, 우나어 운영 계정을 이 실험에 노출시키는 셈이다.
 *
 * 🔴 경로는 `.env.local` 의 `SORAN_NAVERCAFE_SESSION_PATH` 로 주입한다.
 *    코드에 계정도 비밀번호도 두지 않는다. 이 파일은 **경로 문자열만** 다룬다.
 */
export const SESSION_PATH_ENV = 'SORAN_NAVERCAFE_SESSION_PATH'
export const KILL_SWITCH_ENV = 'SORAN_NAVERCAFE_COLLECT_ENABLED'

/** 🔴 우나어 세션 경로로 판정되는 형태. 재사용을 코드가 막는다 */
const UNAO_SESSION_HINT = /unao|agents\/cafe\/storage-state\.json/i

export type SessionInput = {
  /** env 로 받은 경로. 없으면 null */
  sessionPath: string | null
  /** 그 경로에 파일이 있는가 — 부르는 쪽이 실측해 넘긴다 */
  exists: boolean
  /** SESSION_HALTED 플래그가 있는가 */
  halted: boolean
}

export type SessionBlockCode = 'NO_SESSION_PATH' | 'SESSION_FILE_MISSING' | 'UNAO_SESSION_REUSE' | 'SESSION_HALTED'
export type SessionVerdict = { ok: true } | { ok: false; code: SessionBlockCode; detail: string }

/**
 * 브라우저를 열어도 되는가.
 *
 * 🔴 순서가 규칙이다. **우나어 세션 재사용을 파일 존재보다 먼저** 본다 —
 *    그 파일은 실제로 존재하므로, 존재 검사를 먼저 하면 통과해 버린다.
 */
export function judgeSession(input: SessionInput): SessionVerdict {
  if (input.halted) {
    return { ok: false, code: 'SESSION_HALTED', detail: '🔴 SESSION_HALTED — 세션을 다시 발급한 뒤 플래그를 지운다' }
  }
  if (input.sessionPath === null || input.sessionPath.trim() === '') {
    return { ok: false, code: 'NO_SESSION_PATH', detail: `${SESSION_PATH_ENV} 가 없다 — 소란소란 전용 세션 경로를 넣는다` }
  }
  if (UNAO_SESSION_HINT.test(input.sessionPath)) {
    return {
      ok: false,
      code: 'UNAO_SESSION_REUSE',
      detail: '🔴 우나어 세션을 재사용하지 않는다 — 한쪽이 막히면 둘 다 멈춘다. 소란소란 전용 계정으로 따로 발급한다',
    }
  }
  if (!input.exists) {
    return { ok: false, code: 'SESSION_FILE_MISSING', detail: `세션 파일이 없다: ${input.sessionPath}` }
  }
  return { ok: true }
}

/**
 * 락파일 판정.
 *
 * 🔴 우나어 실측 근거(2026-07-27): *"main crawl 이 45분을 넘기며 같은 회차가 재시도됐다."*
 *    **락 TTL 은 실행 timeout 보다 길어야 한다** — 짧으면 아직 도는 작업을 죽은 것으로 본다.
 */
export const LOCK_PATH = '/tmp/soransoran-navercafe.lock'
export const RUN_TIMEOUT_MS = 15 * 60 * 1000
export const LOCK_MAX_AGE_MS = 30 * 60 * 1000

export type LockVerdict = { ok: true; reason: 'FREE' | 'STALE' } | { ok: false; heldForMs: number; detail: string }

export function judgeLock(lockMtimeMs: number | null, nowMs: number): LockVerdict {
  if (lockMtimeMs === null) return { ok: true, reason: 'FREE' }
  const held = nowMs - lockMtimeMs
  if (held > LOCK_MAX_AGE_MS) return { ok: true, reason: 'STALE' }
  return {
    ok: false,
    heldForMs: held,
    detail: `다른 실행이 ${Math.round(held / 60_000)}분째 돌고 있다 (락 TTL ${LOCK_MAX_AGE_MS / 60_000}분)`,
  }
}

// ─────────────────────────────────────────────────────────
// 산출물 — 🔴 82cook 과 같은 스키마
// ─────────────────────────────────────────────────────────

/** 🔴 importer 가 두 소스를 같은 코드로 읽어야 하므로 필드가 같아야 한다 */
export type NaverListItem = {
  sourceArticleId: string
  sourceUrl: string
  originalTitle: string
  sourceCommentCount: number
}

export type CollectedCandidate = {
  sourceSite: string
  sourceUrl: string
  sourceArticleId: string
  sourceBoardName: string
  sourceCommentCount: number
  originalTitle: string
  rawBody: string
  sourceCapturedAt: string
  dedupKey: string
  qualityFlags: QualityAssessment['flags']
  qualitySignals: QualityAssessment['signals'] & { stage: QualityAssessment['stage'] }
}

/** 🔴 목록도 상세도 이 함수 하나를 지난다 — 정규화가 두 곳이면 필드가 갈라진다 */
export function buildCollected(
  cafeId: string,
  item: NaverListItem,
  rawBody: string,
  capturedAtIso: string,
): CollectedCandidate {
  const sourceSite = sourceSiteOf(cafeId)
  const a = assessCandidate({
    originalTitle: item.originalTitle,
    rawBody,
    sourceCommentCount: item.sourceCommentCount,
  })
  return {
    sourceSite,
    sourceUrl: item.sourceUrl,
    sourceArticleId: item.sourceArticleId,
    sourceBoardName: '전체글보기',
    sourceCommentCount: item.sourceCommentCount,
    originalTitle: item.originalTitle,
    rawBody,
    sourceCapturedAt: capturedAtIso,
    dedupKey: computeDedupKey(sourceSite, item.sourceArticleId),
    qualityFlags: a.flags,
    qualitySignals: { ...a.signals, stage: a.stage },
  }
}

/** 🔴 산출물이 계약을 지키는지 — collector 가 파일에 쓰기 직전에 부른다 */
export function assertNaverCandidate(row: CollectedCandidate): void {
  if (!isNaverCafeSource(row.sourceSite)) {
    throw new Error(`sourceSite 가 navercafe 형태가 아니다: ${JSON.stringify(row.sourceSite)}`)
  }
  if (!/^\d+$/.test(row.sourceArticleId)) {
    throw new Error(`sourceArticleId 가 숫자가 아니다: ${JSON.stringify(row.sourceArticleId)}`)
  }
  const expect = computeDedupKey(row.sourceSite, row.sourceArticleId)
  if (row.dedupKey !== expect) throw new Error('dedupKey 가 재계산과 다르다')
  if (!row.sourceUrl.startsWith('https://cafe.naver.com/')) {
    throw new Error(`sourceUrl 이 카페 주소가 아니다: ${JSON.stringify(row.sourceUrl)}`)
  }
}
