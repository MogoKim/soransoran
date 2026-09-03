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

/**
 * 🔴 `excluded` 는 "나쁜 카페" 가 아니라 **이번 라운드에 쓰지 않는다** 는 뜻이다 (PR-S2-b-7).
 *    카페 수를 늘리는 대신 좋은 소스 셋을 깊게 이해하기로 했다 — 창업자 결정.
 */
export type CafeStage = 'production' | 'core' | 'shadow' | 'excluded'

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
  // ── 🔴 아래는 이번 라운드에서 쓰지 않는다 (PR-S2-b-7 · 창업자 결정) ──
  //    "나쁜 소스" 라서가 아니라 **선택과 집중**이다. 카페를 넓히면 각 소스를
  //    얕게밖에 이해하지 못하고, 그 상태로 늘린 수집량은 품질이 따라오지 않는다.
  //    기록을 지우지 않는 이유: 왜 뺐는지가 남아야 나중에 다시 볼 수 있다.
  {
    cafeId: 'dlxogns01',
    label: '은퇴 후 50년',
    stage: 'excluded',
    note: '노후·은퇴·돈·건강 축. 🔴 이번 라운드 제외 — 집중 대상 3소스 밖',
  },
  {
    cafeId: 'masanmam',
    label: '줌마렐라',
    stage: 'excluded',
    note: '타겟층 일상·가족 보강. 🔴 이번 라운드 제외',
  },
  {
    cafeId: 'goondae',
    label: '군대카페',
    stage: 'excluded',
    note: '타겟층 일상·가족 보강. 🔴 이번 라운드 제외',
  },
  {
    cafeId: 'yeowooya',
    label: '여우야',
    stage: 'excluded',
    note: '뷰티·피부·미용·성형 관심사. 🔴 이번 라운드 제외 — 의료·광고 위험이 크고 '
      + 'public 발행 재료로 바로 쓰지 않는다. 필요해지면 shadow 로 되살린다',
  },
]

/** 이번 라운드에 실제로 수집하는 카페 */
export function activeCafes(): CafeConfig[] {
  return CAFES.filter((c) => c.stage !== 'excluded')
}

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
  // ── 🔴 PR-S2-b-4 조사용 메타 — 없으면 넣지 않는다(추측하지 않는다) ──
  /** 게시판명. 목록에서 못 읽으면 생략 → 기본 '전체글보기' */
  sourceBoardName?: string | null
  /** 🔴 화면에 보이는 작성 시각 **문자열 그대로**. 해석은 parsePostedLabel 이 따로 한다 */
  sourcePostedLabel?: string | null
  sourceViewCount?: number | null
  /** 목록 몇 페이지에서 봤나 (1-base) */
  sourcePage?: number | null
  /** 그 페이지 안에서 몇 번째였나 (1-base) */
  sourceRankOnPage?: number | null
  /** 🔴 댓글 수를 실제로 읽었나. 생략하면 "읽었다" 로 본다(기존 호출부 호환) */
  sourceCommentCountRead?: boolean
  // ── PR-S2-b-7 ──
  /** 공지·필독·추천 라벨 텍스트 */
  sourceRowLabel?: string | null
  /** 🔴 고정 슬롯인가 — 자동 상세 fetch 에서 뺀다 */
  sourcePinned?: boolean
  /** 어느 게시판을 긁었나 (menuId). 🔴 sourceSite 계약은 건드리지 않는다 */
  sourceMenuId?: string | null
  /** 게시판 타깃 키 (`remonterrace:jjong`) */
  sourceBoardKey?: string | null
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
  // ── 🔴 PR-S2-b-4 — page depth · time lag · quota 조사용 ──
  //    importer 는 이 키들을 읽지 않는다. DB 컬럼도 만들지 않는다.
  /** 목록에서 이 글을 **본** 시각. 상세를 여는 시각(sourceCapturedAt)보다 앞선다 */
  sourceListedAt: string
  /** 화면 문자열 원형 (예: "15:32" · "2026.09.01.") — 🔴 해석 실패해도 여기는 남는다 */
  sourcePostedLabel: string | null
  /** 위 라벨을 ISO 로 해석한 값. 🔴 확실할 때만 채운다. 모르면 null */
  sourcePostedAt: string | null
  sourcePage: number | null
  sourceRankOnPage: number | null
  sourceViewCount: number | null
  /**
   * 🔴 댓글 수를 **실제로 읽었는가**.
   *
   *    `sourceCommentCount` 는 `number` 여야 한다 — assessCandidate 와 importer 계약이 그렇다.
   *    그래서 못 읽으면 0 으로 떨어지는데, 그러면 "진짜 댓글 0개" 와 구분이 사라진다.
   *    lowEngagement 통계를 낼 때 **이 플래그가 false 인 행은 빼야 한다.**
   */
  sourceCommentCountRead: boolean
  /**
   * 🔴 어느 실행에서 나온 행인가 (PR-S2-b-6).
   *
   *    산출 JSONL 이 append 라 여러 실행이 한 파일에 섞인다. 실행 단위를 구분하지 못하면
   *    "22건 중 100% null" 같은 비율이 통째로 거짓이 된다 — 실제로 한 번 잘못 읽었다.
   */
  sourceRunId: string
  // ── PR-S2-b-7 — 목록 스카우팅 메타 ──
  sourceRowLabel: string | null
  /** 🔴 공지·필독·추천. 자동 상세 fetch 대상이 아니다 */
  sourcePinned: boolean
  sourceMenuId: string | null
  sourceBoardKey: string | null
  /** 🔴 제목 단위 정치·진영 판정. true 면 어느 레인으로도 가지 않는다 */
  sourcePoliticsExcluded: boolean
  /**
   * 🔴 자동 상세 fetch 후보에서 **왜** 빠졌는가 (PR-S2-b-8).
   *
   *    축을 합치지 않는다. `publicFigure` 에는 연예인·방송인이 섞이는데,
   *    지금은 생활 Original 레인이라 함께 빼지만 **Growth 레인이 열리면 갈라야 한다.**
   *    사유를 남기지 않으면 그때 무엇을 되살릴지 알 수 없다.
   */
  sourceExcludeReason: ExcludeReason | null
}

/**
 * ```
 *   politics     정치 · 진영 · 이념 · 정당 · 정치인 · 공직자   → 🔴 어느 레인에도 안 간다
 *   publicFigure 제목의 실명 · 공인 언급                      → 🟡 생활 레인에서만 뺀다
 *   pinned       공지 · 필독 · 추천 고정 슬롯                 → 🟡 자동 경로에서만 뺀다
 * ```
 */
export type ExcludeReason = 'politics' | 'publicFigure' | 'pinned'

// ─────────────────────────────────────────────────────────
// 목록 메타 정규화 (🔴 순수 함수 · PR-S2-b-4)
// ─────────────────────────────────────────────────────────

/** KST 는 DST 가 없다 — 고정 오프셋으로 계산해도 안전하다 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/**
 * 숫자 정규화. `"1,234"` · `"조회 34"` · `"1.2만"` 을 받는다.
 *
 * 🔴 **모르면 0 이 아니라 `null` 이다.** 조사 목적상 "댓글 0개" 와 "댓글 수를 못 읽었다" 는
 *    완전히 다른 사실이다. 0 으로 뭉개면 lowEngagement 통계가 거짓말을 한다.
 */
export function normalizeCount(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : null
  if (typeof raw !== 'string') return null
  const t = raw.replace(/,/g, '').trim()
  if (t === '') return null
  const unit = t.match(/(\d+(?:\.\d+)?)\s*(만|천)/)
  if (unit) {
    const mult = unit[2] === '만' ? 10_000 : 1_000
    return Math.floor(Number(unit[1]) * mult)
  }
  const m = t.match(/\d+/)
  return m ? Number(m[0]) : null
}

/**
 * 네이버 목록의 작성 시각 라벨을 ISO 로 해석한다.
 *
 * 🔴 **확실할 때만 값을 낸다. 애매하면 `null` 이다.**
 *    time lag 를 재려고 만든 필드인데 추측값이 섞이면 그 측정이 통째로 못 쓰게 된다.
 *    해석에 실패해도 원문 라벨(`sourcePostedLabel`)은 남으므로 잃는 것이 없다.
 *
 * 다루는 형태 (네이버 카페 목록 실측 기준)
 * ```
 *   15:32          오늘 그 시각 (KST)
 *   2026.09.01.    그 날짜 00:00 KST
 *   09.01.         올해 그 날짜 — 🔴 미래가 되면 작년으로 본다(연말연시)
 *   2026-09-01     ISO 형태
 *   3시간 전 · 5분 전 · 방금 전
 * ```
 */
export function parsePostedLabel(label: string | null | undefined, now: Date): string | null {
  if (typeof label !== 'string') return null
  const t = label.trim()
  if (t === '') return null

  const iso = (y: number, mo: number, d: number, h: number, mi: number): string =>
    new Date(Date.UTC(y, mo - 1, d, h, mi) - KST_OFFSET_MS).toISOString()

  // 상대 시각
  if (/방금/.test(t)) return now.toISOString()
  const rel = t.match(/^(\d+)\s*(분|시간|일)\s*전$/)
  if (rel) {
    const n = Number(rel[1])
    const ms = rel[2] === '분' ? 60_000 : rel[2] === '시간' ? 3_600_000 : 86_400_000
    return new Date(now.getTime() - n * ms).toISOString()
  }

  // 절대 날짜
  const ymd = t.match(/^(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})\.?$/)
  if (ymd) return iso(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]), 0, 0)

  // 오늘 HH:mm — 🔴 '오늘' 은 KST 기준이다
  const hm = t.match(/^(\d{1,2}):(\d{2})$/)
  if (hm) {
    const h = Number(hm[1]), mi = Number(hm[2])
    if (h > 23 || mi > 59) return null
    const kstNow = new Date(now.getTime() + KST_OFFSET_MS)
    return iso(kstNow.getUTCFullYear(), kstNow.getUTCMonth() + 1, kstNow.getUTCDate(), h, mi)
  }

  // MM.DD. — 연도가 없다. 올해로 보되 미래면 작년이다
  const md = t.match(/^(\d{1,2})[.\-/]\s*(\d{1,2})\.?$/)
  if (md) {
    const kstNow = new Date(now.getTime() + KST_OFFSET_MS)
    const y = kstNow.getUTCFullYear()
    const cand = iso(y, Number(md[1]), Number(md[2]), 0, 0)
    return Date.parse(cand) > now.getTime() ? iso(y - 1, Number(md[1]), Number(md[2]), 0, 0) : cand
  }

  return null
}

/** 🔴 목록도 상세도 이 함수 하나를 지난다 — 정규화가 두 곳이면 필드가 갈라진다 */
export function buildCollected(
  cafeId: string,
  item: NaverListItem,
  rawBody: string,
  capturedAtIso: string,
  /** 🔴 목록에서 이 글을 본 시각. 생략하면 capturedAt 과 같다고 본다 */
  listedAtIso: string = capturedAtIso,
): CollectedCandidate {
  const sourceSite = sourceSiteOf(cafeId)
  const a = assessCandidate({
    originalTitle: item.originalTitle,
    rawBody,
    sourceCommentCount: item.sourceCommentCount,
  })
  const listedAt = new Date(listedAtIso)
  return {
    sourceSite,
    sourceUrl: item.sourceUrl,
    sourceArticleId: item.sourceArticleId,
    // 🔴 기본값을 조용히 씌우지 않는다 (PR-S2-b-8 실측 정정).
    //    개별 게시판 페이지에는 `a.board_name` 셀이 없어 빈 값이 오는데,
    //    앞 코드가 '전체글보기' 로 채워 **쫑알쫑알 225건이 전부 전체글보기로 기록됐다.**
    //    부르는 쪽이 board label 을 넘기면 그것을 쓴다.
    sourceBoardName: item.sourceBoardName?.trim() || '전체글보기',
    sourceCommentCount: item.sourceCommentCount,
    originalTitle: item.originalTitle,
    rawBody,
    sourceCapturedAt: capturedAtIso,
    dedupKey: computeDedupKey(sourceSite, item.sourceArticleId),
    qualityFlags: a.flags,
    qualitySignals: { ...a.signals, stage: a.stage },
    // ── PR-S2-b-4 조사용 메타 ──
    sourceListedAt: listedAtIso,
    sourcePostedLabel: item.sourcePostedLabel?.trim() || null,
    // 🔴 '지금' 이 아니라 **목록을 본 시각** 기준으로 해석한다.
    //    "15:32" 는 목록을 본 날의 15:32 이지 파일을 읽는 날의 15:32 가 아니다.
    sourcePostedAt: parsePostedLabel(item.sourcePostedLabel, Number.isNaN(listedAt.getTime()) ? new Date(capturedAtIso) : listedAt),
    sourcePage: item.sourcePage ?? null,
    sourceRankOnPage: item.sourceRankOnPage ?? null,
    sourceViewCount: item.sourceViewCount ?? null,
    sourceCommentCountRead: item.sourceCommentCountRead ?? true,
    sourceRunId: runIdOf(listedAtIso),
    sourceRowLabel: item.sourceRowLabel?.trim() || null,
    sourcePinned: item.sourcePinned ?? false,
    sourceMenuId: item.sourceMenuId ?? null,
    sourceBoardKey: item.sourceBoardKey ?? null,
    // 🔴 제목 단위로만 판정한다 — 게시판 이름·안내문으로 판정하지 않는다
    sourcePoliticsExcluded: judgePoliticsTitle(item.originalTitle).excluded,
    sourceExcludeReason: judgeExcludeReason({
      politicsExcluded: judgePoliticsTitle(item.originalTitle).excluded,
      pinned: item.sourcePinned ?? false,
      qualityFlags: a.flags,
    }),
  }
}

/**
 * 자동 상세 fetch 후보에서 빼는 **단일 판정**.
 *
 * 🔴 **2026-09-03 실측 문제**: 축이 둘로 갈라져 있었다.
 *    `judgePoliticsTitle` 은 0건인데 `qualityFlags.politicalOrPublicFigure` 는 2건이었고,
 *    그 2건이 `sourcePoliticsExcluded=false` 라 자동 후보에 남을 수 있었다.
 *    "어느 쪽이 최종 차단인가" 를 코드만 보고 답할 수 없으면 언젠가 새어 나간다.
 *
 * 🔴 순서가 규칙이다. **정치를 먼저** 본다 — 정치이면서 실명인 글을
 *    `publicFigure` 로 기록하면 나중에 Growth 로 되살릴 후보처럼 보인다.
 */
export function judgeExcludeReason(input: {
  politicsExcluded: boolean
  pinned: boolean
  qualityFlags: readonly string[]
}): ExcludeReason | null {
  if (input.politicsExcluded || input.qualityFlags.includes('politicalTopicLikely')) return 'politics'
  if (input.qualityFlags.includes('politicalOrPublicFigure')) return 'publicFigure'
  if (input.pinned) return 'pinned'
  return null
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
  // ── PR-S2-b-4 메타 계약 ──
  // 🔴 "값이 있어야 한다" 가 아니라 "추측값이 없어야 한다" 를 본다.
  //    못 읽은 것은 null 이어야 하고, 채워졌다면 해석 가능한 형태여야 한다.
  if (row.sourcePostedAt !== null && Number.isNaN(Date.parse(row.sourcePostedAt))) {
    throw new Error(`sourcePostedAt 이 ISO 가 아니다: ${JSON.stringify(row.sourcePostedAt)}`)
  }
  if (row.sourcePostedAt !== null && row.sourcePostedLabel === null) {
    throw new Error('sourcePostedAt 이 있는데 원문 라벨이 없다 — 근거 없는 시각이다')
  }
  for (const [k, v] of [['sourcePage', row.sourcePage], ['sourceRankOnPage', row.sourceRankOnPage], ['sourceViewCount', row.sourceViewCount]] as const) {
    if (v !== null && (!Number.isFinite(v) || v < 0)) throw new Error(`${k} 가 음수이거나 숫자가 아니다: ${JSON.stringify(v)}`)
  }
  if (Number.isNaN(Date.parse(row.sourceListedAt))) {
    throw new Error(`sourceListedAt 이 ISO 가 아니다: ${JSON.stringify(row.sourceListedAt)}`)
  }
  if (!/^\d{8}-\d{6}$/.test(row.sourceRunId)) {
    throw new Error(`sourceRunId 형식이 아니다: ${JSON.stringify(row.sourceRunId)}`)
  }
}

// ─────────────────────────────────────────────────────────
// 세션 발급 · 브라우저 기동 (🔴 순수 함수 — PR-S2-b-3)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **권장 저장 경로.** repo 상대경로이고 `.gitignore` 가 막는다.
 *    경로에 `unao` 가 없어야 judgeSession 을 통과한다(설계상 그렇게 고른 이름이다).
 */
export const DEFAULT_SESSION_PATH = '.naver-session/soransoran-storage-state.json'

/** 🔴 우나어 세션 경로인가. judgeSession 과 **같은 규칙**을 쓴다 */
export function isUnaoSessionPath(path: string): boolean {
  return UNAO_SESSION_HINT.test(path)
}

/**
 * Playwright 모듈 후보 — 🔴 앞에서부터 시도한다.
 *
 *    이 저장소에는 `playwright-core` 가 이미 devDependency 로 있다(package.json).
 *    `playwright` 만 찾던 코드는 설치돼 있는 것을 두고 "없다" 고 말했다 — PR-S2-b-3 에서 고쳤다.
 */
export const PLAYWRIGHT_SPECS = ['playwright', 'playwright-core'] as const

/**
 * 🔴 **기본은 설치된 Google Chrome 을 쓴다(`channel: 'chrome'`).**
 *
 *    근거(실측 2026-09-03): `playwright-core@1.62.1` 이 기대하는 번들 chromium 은 rev 1234 인데
 *    로컬 캐시에는 1208 · 1217 만 있다. 번들 브라우저를 받으려면 별도 다운로드가 필요하다.
 *    반면 `/Applications/Google Chrome.app` 은 이미 있다 — **다운로드 0바이트로 뜬다.**
 *
 *    `SORAN_BROWSER_CHANNEL=chromium` 을 주면 번들 브라우저를 쓴다(설치돼 있을 때).
 */
export const BROWSER_CHANNEL_ENV = 'SORAN_BROWSER_CHANNEL'
export const DEFAULT_BROWSER_CHANNEL = 'chrome'

export type LaunchOptions = { headless: boolean; channel?: string }

export function browserLaunchOptions(input: { channel?: string | null; headless: boolean }): LaunchOptions {
  const ch = (input.channel ?? '').trim() || DEFAULT_BROWSER_CHANNEL
  // 'chromium' 은 채널이 아니라 번들 브라우저를 뜻한다 — channel 을 넘기지 않는다
  return ch === 'chromium' ? { headless: input.headless } : { headless: input.headless, channel: ch }
}

// ─────────────────────────────────────────────────────────
// .gitignore 보호 판정 (🔴 순수 함수)
// ─────────────────────────────────────────────────────────

/**
 * 세션 파일 경로가 `.gitignore` 로 막혀 있는가.
 *
 * 🔴 **저장 전에 본다.** 저장하고 나서 확인하면 이미 워킹트리에 쿠키가 놓인 뒤다.
 *    full gitignore 문법을 구현하지 않는다 — 디렉터리 규칙과 단순 glob 만 본다.
 *    모르면 "막혀 있다" 가 아니라 **"모른다(false)"** 로 답한다(보수적).
 */
export function isSessionPathIgnored(relPath: string, gitignoreText: string): boolean {
  const path = relPath.replace(/^\.\//, '')
  const base = path.split('/').pop() ?? path
  const rules = gitignoreText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#') && !l.startsWith('!'))

  for (const raw of rules) {
    const rule = raw.replace(/^\//, '')
    if (rule.endsWith('/')) {
      const dir = rule.slice(0, -1)
      if (path === dir || path.startsWith(`${dir}/`)) return true
      continue
    }
    const re = new RegExp(`^${rule.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`)
    if (re.test(path) || re.test(base)) return true
  }
  return false
}

// ─────────────────────────────────────────────────────────
// 쿠키 요약 (🔴 값을 절대 다루지 않는다)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **`value` 필드가 이 타입에 없다.**
 *    타입에 없으면 실수로 출력할 수도 없다 — 이것이 이 타입의 존재 이유다.
 */
export type CookieMeta = { name: string; domain?: string; expires?: number }

export type CookieSummary = {
  total: number
  naverDomain: number
  /** 로그인 유지에 필요한 쿠키의 만료일 (🔴 값이 아니라 이름과 날짜만) */
  auth: { name: string; expiresAt: string | null }[]
  hasAuth: boolean
}

/** 로그인 유지 쿠키 — 이것들이 없으면 세션이 안 잡힌 것이다 */
export const AUTH_COOKIE_NAMES = ['NID_AUT', 'NID_SES'] as const

export function summarizeCookies(cookies: CookieMeta[]): CookieSummary {
  const naverDomain = cookies.filter((c) => (c.domain ?? '').includes('naver.com')).length
  const auth = cookies
    .filter((c) => (AUTH_COOKIE_NAMES as readonly string[]).includes(c.name))
    .map((c) => ({
      name: c.name,
      // -1 · 0 · undefined 는 세션 쿠키(브라우저 닫으면 사라짐)를 뜻한다
      expiresAt: c.expires !== undefined && c.expires > 0 ? new Date(c.expires * 1000).toISOString() : null,
    }))
  return {
    total: cookies.length,
    naverDomain,
    auth,
    hasAuth: AUTH_COOKIE_NAMES.every((n) => auth.some((a) => a.name === n)),
  }
}

// ─────────────────────────────────────────────────────────
// 목록 수집 진단 (🔴 순수 함수 · PR-S2-b-5)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **왜 이 구조가 필요한가 (2026-09-03 실측 사고)**
 *
 *    readList 가 프레임마다 `catch {}` 로 예외를 통째로 삼켰다. 그 결과
 *    "이 프레임에는 목록이 없다" 와 "콜백이 터졌다" 가 **같은 0건**으로 보였고,
 *    22건 → 0건 회귀의 원인을 코드만 보고는 짚을 수 없었다.
 *
 *    실패를 삼키는 코드는 두 번째 실행에서도 같은 자리에서 막힌다.
 *    그래서 프레임마다 **무슨 일이 있었는지**를 남긴다.
 */
export type FrameProbe = {
  /** 🔴 쿼리·해시를 떼고 남긴다 — URL 에 세션 토큰이 실릴 수 있다 */
  frame: string
  /** 링크 셀렉터가 잡은 DOM 노드 수 */
  linkHits: number
  /** 그중 href·title 을 꺼낸 행 수 */
  rows: number
  /** articleId 파싱까지 통과한 최종 항목 수 */
  items: number
  /** 🔴 콜백 예외 메시지. HTML 전문이 아니라 message 만 */
  error: string | null
}

/** 🔴 URL 에서 쿼리·해시를 떼어낸다. 로그에 세션 토큰을 남기지 않는다 */
export function safeFrameLabel(url: string): string {
  const cut = url.split(/[?#]/)[0]
  return cut.length > 120 ? `${cut.slice(0, 117)}…` : cut
}

export type EmptyListCode = 'OK' | 'NO_FRAME' | 'CALLBACK_ERROR' | 'SELECTOR_ZERO' | 'PARSE_ZERO'

/**
 * 목록이 왜 비었는지 **구분해서** 답한다.
 *
 * 🔴 "세션 만료이거나 셀렉터가 바뀌었다" 는 진단이 아니다 — 둘 다일 수도, 둘 다 아닐 수도 있다.
 *    셋을 나눠야 다음에 무엇을 고칠지 정해진다.
 *
 * ```
 *   CALLBACK_ERROR   콜백이 터졌다        → 우리 코드 문제. 셀렉터 문법·DOM API 를 본다
 *   SELECTOR_ZERO    링크가 0개다          → 로그인이 안 됐거나 페이지 구조가 바뀌었다
 *   PARSE_ZERO       링크는 있는데 0건이다  → parseArticleId 가 URL 형태를 못 읽는다
 * ```
 */
export function diagnoseEmptyList(probes: readonly FrameProbe[]): { code: EmptyListCode; detail: string } {
  if (probes.some((p) => p.items > 0)) return { code: 'OK', detail: '' }
  if (probes.length === 0) {
    return { code: 'NO_FRAME', detail: '검사한 프레임이 없다 — 페이지가 뜨지 않았거나 iframe 구조가 바뀌었다' }
  }
  const errs = probes.filter((p) => p.error !== null)
  if (errs.length > 0) {
    return {
      code: 'CALLBACK_ERROR',
      detail: `콜백이 ${errs.length}/${probes.length} 프레임에서 터졌다 — 우리 코드 문제다: ${errs[0].error}`,
    }
  }
  if (probes.every((p) => p.linkHits === 0)) {
    return { code: 'SELECTOR_ZERO', detail: '링크 셀렉터가 0개를 잡았다 — 로그인이 안 됐거나 목록 DOM 이 바뀌었다' }
  }
  const hit = probes.reduce((a, p) => a + p.linkHits, 0)
  return {
    code: 'PARSE_ZERO',
    detail: `링크 ${hit}개를 찾았지만 articleId 를 하나도 못 읽었다 — parseArticleId 가 URL 형태를 놓친다`,
  }
}

/** 사람이 읽는 한 줄 요약 (🔴 HTML 을 담지 않는다) */
export function summarizeProbes(probes: readonly FrameProbe[]): string[] {
  return probes.map(
    (p) =>
      `${p.frame} · 링크 ${p.linkHits} · 행 ${p.rows} · 항목 ${p.items}` +
      (p.error === null ? '' : ` · 🔴 예외: ${p.error}`),
  )
}

/**
 * 락 해제 결과.
 *
 * 🔴 **해제 실패가 원래 에러를 가리면 안 된다.** 수집이 왜 실패했는지가 본론이고
 *    락을 못 지운 것은 곁가지다 — 경고만 내고 원래 예외를 그대로 올린다.
 */
export type LockReleaseVerdict = { released: boolean; warning: string | null }

export function judgeLockRelease(existed: boolean, unlinkError: unknown): LockReleaseVerdict {
  if (!existed) return { released: false, warning: null }
  if (unlinkError === undefined || unlinkError === null) return { released: true, warning: null }
  const msg = unlinkError instanceof Error ? unlinkError.message : String(unlinkError)
  return { released: false, warning: `락파일을 지우지 못했다 (${LOCK_PATH}) — ${msg}. TTL ${LOCK_MAX_AGE_MS / 60_000}분 뒤 자동 해제된다` }
}

// ─────────────────────────────────────────────────────────
// 목록 DOM 셀렉터 — 🔴 2026-09-03 실측으로 확정 (PR-S2-b-6)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **추정하지 않고 실측한 값이다.**
 *
 *    PR-S2-b-4 는 `.td_date` · `.td_view` · `.td_name` 을 **추정으로** 넣었고
 *    셋 다 존재하지 않았다 — 그 결과 메타가 22/22 전부 null 이었다.
 *    아래는 remonterrace 목록 1p 의 실제 DOM 을 읽어 확정한 값이다.
 *
 * ```
 *   tr
 *     td > a.board_name                          게시판명
 *     td > div.board-list > div.inner_list
 *            > a.article                         제목·링크
 *            > a.cmt                             댓글 수 — 🔴 0 이면 **엘리먼트가 없다**
 *     td > div.ArticleBoardWriterInfo ...         작성자 (🔴 수집하지 않는다)
 *     td.td_normal.type_date                     작성시각 "HH:mm" 또는 "YYYY.MM.DD"
 *     td.td_normal.type_readCount                조회수 "1,133"
 * ```
 */
export const LIST_SELECTORS = {
  link: 'a.article, a[href*="articleid"], a[href*="/articles/"]',
  row: 'tr, li, .article-board-item',
  date: 'td.type_date, .td_normal.type_date, td[class*="type_date"]',
  view: 'td.type_readCount, .td_normal.type_readCount, td[class*="type_readCount"]',
  comment: 'a.cmt',
  board: 'a.board_name',
  /** 🔴 공지·필독·추천 라벨 (PR-S2-b-7 실측: em.board-tag > strong.board-tag-txt) */
  label: 'em.board-tag, .board-tag-txt, .board-tag',
} as const

/**
 * 실행 단위 식별자.
 *
 * 🔴 **왜 필요한가**: 산출 JSONL 이 append 라 첫 live(22건)와 두 번째 live(22건)가
 *    한 파일에 44행으로 섞였고, null 비율을 재다가 실제로 한 번 잘못 읽었다.
 *    행마다 어느 실행에서 나온 것인지 알 수 있어야 분석이 성립한다.
 */
export function runIdOf(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) throw new Error(`runIdOf: ISO 가 아니다 — ${iso}`)
  const k = new Date(d.getTime() + KST_OFFSET_MS)
  const p2 = (n: number): string => String(n).padStart(2, '0')
  return `${k.getUTCFullYear()}${p2(k.getUTCMonth() + 1)}${p2(k.getUTCDate())}-${p2(k.getUTCHours())}${p2(k.getUTCMinutes())}${p2(k.getUTCSeconds())}`
}

/** 실행별 산출물 경로 — 🔴 덮어쓰지도 섞이지도 않는다 */
export function runOutputPath(cafeId: string, runId: string, kind: 'detail' | 'list'): string {
  const suffix = kind === 'list' ? '.list' : ''
  return `./.microseed-data/navercafe-${cafeId}-${runId}${suffix}.jsonl`
}

// ─────────────────────────────────────────────────────────
// 게시판 단위 수집 계약 (PR-S2-b-7)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **전체글보기 하나만 보던 것을 게시판 단위로 바꾼다.**
 *
 *    2026-09-03 실측: 레몬테라스 전체글보기는 **시간당 약 225건**이 올라온다.
 *    24시간 전 글에 닿으려면 245페이지가 필요하다 — page depth 전략은 산술적으로 불가능하다.
 *    대신 **게시판을 좁히면 속도가 떨어지고**, 같은 페이지 수로 더 긴 시간을 덮는다.
 *
 * 🔴 여기 적힌 page range 는 **가설이다.** list-only 스카우팅으로 실측한 뒤 고친다.
 */
export type BoardTarget = {
  /** 명령줄에서 부르는 키 — `--board=remonterrace:jjong` */
  key: string
  cafeId: string
  /** 신형 URL 이 쓰는 숫자 카페 ID */
  cafeNo: string
  /** 게시판 menuId. `0` 은 전체글보기 */
  menuId: string
  label: string
  /** 🔴 가설이다. 실측 뒤 고친다 */
  startPage: number
  endPage: number
  /** 사람이 읽는 목적 메모. 🔴 판정에 쓰지 않는다 */
  purpose: string
}

export const BOARD_TARGETS: readonly BoardTarget[] = [
  {
    key: 'remonterrace:jjong',
    cafeId: 'remonterrace',
    cafeNo: '10298136',
    menuId: '23',
    label: '쫑알쫑알 게시판',
    // 🔴 1페이지를 뺀다. 실측상 1p 는 방금 올라온 글이라 반응이 붙을 시간이 없었고,
    //    상단에 인기글·공지 슬롯이 섞여 평균을 흔든다.
    startPage: 2,
    endPage: 16,
    purpose: '생활 · 가정 · 관계 · 일상 핵심 Raw',
  },
  {
    key: 'remonterrace:humor',
    cafeId: 'remonterrace',
    cafeNo: '10298136',
    menuId: '56',
    label: '유머,연예,가십',
    startPage: 1,
    endPage: 1,
    purpose: '유머 · 연예 · 셀럽 — 🔴 Growth 후보. 정치·진영은 여기서도 제외다',
  },
  {
    key: 'wgang:all',
    cafeId: 'wgang',
    cafeNo: '29349320',
    menuId: '0',
    label: '전체글보기',
    startPage: 1,
    endPage: 5,
    purpose: '갱년기 · 몸 · 마음 · 가족 · 중년 생활 Raw',
  },
]

export function findBoard(key: string): BoardTarget | null {
  return BOARD_TARGETS.find((b) => b.key === key) ?? null
}

/** 🔴 신형 URL. 구형 `iframe_url=` 형태와 달리 menuId 를 경로로 받는다 */
export function boardListUrl(t: BoardTarget, page: number): string {
  return `https://cafe.naver.com/f-e/cafes/${t.cafeNo}/menus/${t.menuId}?viewType=L&page=${page}`
}

/** 대상 페이지 목록. 🔴 start > end 면 빈 배열이 아니라 던진다 — 조용한 0건을 만들지 않는다 */
export function pagesOf(t: { startPage: number; endPage: number }): number[] {
  if (!Number.isInteger(t.startPage) || !Number.isInteger(t.endPage)) throw new Error('page range 가 정수가 아니다')
  if (t.startPage < 1) throw new Error(`startPage 가 1 미만이다: ${t.startPage}`)
  if (t.endPage < t.startPage) throw new Error(`endPage(${t.endPage}) 가 startPage(${t.startPage}) 보다 작다`)
  return Array.from({ length: t.endPage - t.startPage + 1 }, (_, i) => t.startPage + i)
}

// ─────────────────────────────────────────────────────────
// 목록 스카우팅 (list-only) — PR-S2-b-7
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **상세에 무조건 들어가지 않는다.**
 *
 *    먼저 목록에서 제목 · 댓글수 · 조회수 · 작성시각 · 게시판 · page · rank · 라벨을 본다.
 *    조건을 넘은 글만 상세 fetch 후보가 된다. Raw Vault 는 창고가 아니다.
 *
 * 🔴 **이번 실행에서 미달이어도 끝이 아니다.** 다음 실행에서 댓글·조회수가 올라
 *    조건을 넘으면 그때 후보가 된다 — 그래서 목록 기록을 전부 남긴다.
 *
 * scout 모드는 상세를 전혀 열지 않으므로 요청이 목록뿐이다.
 * 그래서 detail quota 와 **별개로** 더 많은 페이지를 볼 수 있다.
 */
export const SCOUT_MAX_PAGES = 20
export const DETAIL_MAX_PAGES = 5

export function maxPagesFor(mode: 'scout' | 'detail'): number {
  return mode === 'scout' ? SCOUT_MAX_PAGES : DETAIL_MAX_PAGES
}

// ─────────────────────────────────────────────────────────
// 공지 · 필독 · 추천 라벨 (🔴 순수 함수 · PR-S2-b-7)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **라벨 붙은 행은 자동 상세 fetch 대상이 아니다.**
 *
 *    2026-09-03 실측: 레몬테라스 1p 상단에 2020년 공지 2건(조회 100만대)과
 *    인기글 5건(댓글 109~267)이 고정 슬롯으로 박혀 있었다. 이것들이 섞이면
 *    time lag 평균이 6년으로 튀고 page depth 비교가 통째로 무의미해진다.
 *
 * 🔴 **목록 기록은 남긴다.** 지우는 것이 아니라 자동 경로에서만 뺀다 — 정책 Q-1 과 같다.
 */
export const ROW_LABELS = ['공지', '필독', '추천'] as const
export type RowLabel = (typeof ROW_LABELS)[number]

export type RowLabelVerdict = {
  /** 감지된 라벨. 없으면 null */
  label: RowLabel | null
  /** 🔴 자동 상세 fetch 에서 뺄 것인가 */
  pinned: boolean
  /** 라벨 텍스트는 있는데 아는 라벨이 아니다 — 조용히 넘기지 않는다 */
  unknown: string | null
}

/**
 * 행이 고정 슬롯인지 판정한다.
 *
 * 두 근거를 쓴다. 하나만 보면 놓친다:
 * ```
 *   labelText  em.board-tag 의 텍스트 ("공지" · "필독" · "추천")
 *   rowClass   tr 의 class ("board-notice" 등)
 * ```
 */
export function detectRowLabel(labelText: string | null | undefined, rowClass: string | null | undefined): RowLabelVerdict {
  const t = (labelText ?? '').trim()
  const cls = (rowClass ?? '').trim()
  const byClass = /board-notice|notice|type_required/i.test(cls)

  for (const l of ROW_LABELS) {
    if (t.includes(l)) return { label: l, pinned: true, unknown: null }
  }
  if (byClass) return { label: '공지', pinned: true, unknown: null }
  // 🔴 텍스트가 있는데 아는 라벨이 아니면 그대로 보고한다.
  //    조용히 통과시키면 네이버가 라벨 문구를 바꿨을 때 아무도 모른다.
  if (t !== '') return { label: null, pinned: false, unknown: t }
  return { label: null, pinned: false, unknown: null }
}

// ─────────────────────────────────────────────────────────
// 정치 · 진영 제외 (🔴 순수 함수 · 제목 단위 · PR-S2-b-7)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **정치 · 진영은 public · growth · shadow 어디에도 가지 않는다** (설계 §4-C).
 *
 *    2026-09-03 실측: 제목에 `정치` 가 그대로 든 행을 `politicalTopicLikely` 가 놓쳤다.
 *    기존 정규식이 `정치\\s*성향` · `정치\\s*글` 만 보고 **단독 `정치` 를 안 봤기** 때문이다.
 *
 * 🔴 **판정 단위는 게시글 제목이다.** 게시판 이름·카페 안내문으로 판정하지 않는다 —
 *    게시판 하나가 통째로 정치로 잘못 분류되면 그 게시판의 생활글까지 전부 사라진다.
 *
 * 🔴 **연예 · 방송 · 셀럽은 여기에 넣지 않는다.** 그쪽은 Growth 후보이고 축이 다르다.
 */
const POLITICS_EXCLUDE = [
  /정치/, /진영/, /이념/, /정당/, /선거/,
  /정치인/, /공직자/, /대통령/, /국회/, /의원직/,
  /여당/, /야당/, /좌파/, /우파/, /극우/, /극좌/,
] as const

export type PoliticsVerdict = { excluded: boolean; hit: string | null }

export function judgePoliticsTitle(title: string): PoliticsVerdict {
  const t = (title ?? '').trim()
  for (const re of POLITICS_EXCLUDE) {
    const m = t.match(re)
    if (m) return { excluded: true, hit: m[0] }
  }
  return { excluded: false, hit: null }
}

// ─────────────────────────────────────────────────────────
// 목록 중복 제거 (🔴 순수 함수 · PR-S2-b-8)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **크롤 중에 새 글이 올라오면 같은 글이 두 페이지에 걸린다.**
 *
 *    2026-09-03 실측: `34998995` 가 page 3 rank 15 와 page 4 rank 1 에 나왔다.
 *    225건 중 1건이라 작아 보이지만, threshold 를 백분율로 계산하는 순간
 *    분모가 오염된다. 페이지를 깊게 볼수록 이 확률은 올라간다.
 *
 * 🔴 **먼저 본 것을 남긴다.** 나중 것이 아니라 첫 발견을 남기는 이유:
 *    밀려 내려간 위치(page 4 rank 1)는 크롤 타이밍의 산물이고,
 *    처음 본 위치(page 3 rank 15)가 그 시점의 실제 목록 위치다.
 *
 * 🔴 **버리지 않고 세어서 보고한다.** 조용히 사라지면 중복이 늘어나도 아무도 모른다.
 */
export type DedupeResult<T> = { rows: T[]; duplicates: number; duplicateIds: string[] }

export function dedupeListRows<T extends { sourceSite: string; sourceArticleId: string }>(
  rows: readonly T[],
): DedupeResult<T> {
  const seen = new Map<string, T>()
  const dupes: string[] = []
  for (const r of rows) {
    const key = `${r.sourceSite}|${r.sourceArticleId}`
    if (seen.has(key)) {
      dupes.push(r.sourceArticleId)
      continue
    }
    seen.set(key, r)
  }
  return { rows: [...seen.values()], duplicates: dupes.length, duplicateIds: [...new Set(dupes)] }
}

// ─────────────────────────────────────────────────────────
// threshold 후보 (🔴 확정값이 아니다 · PR-S2-b-8)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **후보일 뿐이다. 코드가 이 값으로 자동 판정하지 않는다.**
 *
 *    2026-09-03 쫑알쫑알 2~16p 225건 **1회 표본**에서 나온 분위수다.
 *    표본이 2.3시간짜리 하나뿐이라 확정하기에는 이르다 —
 *    시간차 재방문으로 여러 회차를 모은 뒤 정한다.
 *
 * ```
 *   댓글 p50=5  p80=12  p90=18       조회 p50=101  p80=250  p90=368
 *   댓글>=10 AND 조회>=300  → 21/225 (9%)
 *   댓글>=15 AND 조회>=300  → 18/225 (8%)
 * ```
 */
export const THRESHOLD_CANDIDATES = [
  { label: 'A', minComments: 10, minViews: 300, observedRate: 0.09 },
  { label: 'B', minComments: 15, minViews: 300, observedRate: 0.08 },
] as const

export function passesThreshold(
  row: { sourceCommentCount: number; sourceViewCount: number | null },
  t: { minComments: number; minViews: number },
): boolean {
  // 🔴 조회수를 못 읽었으면 통과시키지 않는다. 미지값을 0 으로도 무한대로도 보지 않는다
  if (row.sourceViewCount === null) return false
  return row.sourceCommentCount >= t.minComments && row.sourceViewCount >= t.minViews
}
