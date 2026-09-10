/**
 * 대상 글의 **출처 문맥 판정** — 🔴 순수 함수. DB · 네트워크 · 파일 IO 없음
 *
 * 🔴 **왜 이 파일이 생겼나** (2026-09-09).
 *
 *    Gate ⑨ 는 `sourceIsCafeOperational` 을 **받아서** reject 로 올릴 뿐이고,
 *    스스로 판정하지 않는다(`persona-gate-source-marker.mts` 주석이 그렇게 적어 두었다).
 *    "후보 선별 단계에서 이미 걸러졌어야 한다" 고 했는데 — **그 단계가 없었다.**
 *
 *    대신 대상 materializer 가 `sourceIsCafeOperational: false` 를 **고정**으로 넘겼다.
 *    필드는 채워졌으므로 ⑨ 는 `notRun` 을 면했고, 완비 판정도 통과했다.
 *    그러나 그 `false` 는 관측이 아니라 **주장**이었다 — 카페 공지·광고 글에서
 *    후보를 만들어도 ⑨ 가 올릴 근거를 영영 받지 못한다.
 *
 *    "입력이 있다" 와 "입력이 사실이다" 는 다른 질문이고, 앞선 검사는 앞엣것만 봤다.
 *
 * 🔴 **모르면 `null` 이다.** `false` 로 보정하지 않는다 —
 *    보정한 값은 관문을 열지만 아무것도 지키지 않는다.
 */

import { isExternalSourcedBody, type PostVisibilityInput } from './post-visibility'

/** 🔴 운영이 직접 만드는 면. 회원의 일상 글이 아니다 */
const OPERATIONAL_BOARD_TYPES: readonly string[] = ['MAGAZINE']

/**
 * 🔴 **카페 운영·공지·광고의 표지.**
 *
 *    원문에서 잘라낸 값이 아니라 상수다 — 로그에 남겨도 개인정보가 아니다.
 *    좁게 잡는다: 애매한 것을 여기서 삼키면 ⑨ 가 볼 것이 사라진다.
 */
const OPERATIONAL_MARKS: readonly string[] = [
  '공지', '필독', '안내드립니다', '안내 드립니다', '공지사항',
  '이벤트', '당첨', '경품', '추첨',
  '모집합니다', '모집 합니다', '회원모집', '등업',
  '광고', '협찬', '홍보', '제휴', '체험단',
  '운영자', '운영진', '스탭', '스태프', '회칙',
]

export type SourceContextFacts = {
  /**
   * 🔴 **3축은 정본 함수로만 본다** (헌법 §3 C-2).
   *    축을 여기서 직접 비교하면 판정이 두 곳으로 갈린다 —
   *    `isExternalSourcedBody` 하나가 "외부 원문인가" 를 답한다.
   *    🔴 못 읽었으면 `null` 이다.
   */
  visibility: PostVisibilityInput | null
  /** 어느 공동체에서 왔는가 (`82cook` · `navercafe:...`). 자체 글이면 null */
  sourceSite: string | null
  /** 게시판. 🔴 모르면 null */
  boardType: string | null
  title: string
  body: string
}

export type SourceContextVerdict = {
  /**
   * 🔴 `true` 운영·공지·광고 문맥 / `false` 일상 글 / `null` **판정 불가**
   *    `null` 은 provider 앞에서 막는 근거다. 조용히 `false` 가 되지 않는다.
   */
  operational: boolean | null
  /** 🔴 표지 상수와 게시판 이름만 담는다. 원문 조각을 담지 않는다 */
  reason: string
}

/**
 * 🔴 **판정 재료가 없으면 판정하지 않는다.**
 *
 *    · 게시판을 모른다 → 모른다
 *    · 제목·본문이 둘 다 비었다 → 읽을 것이 없다 → 모른다
 *    · 외부에서 왔는데 어느 공동체인지 모른다 → 그 공동체의 운영 문맥을 알 수 없다 → 모른다
 */
export function judgeSourceContext(f: SourceContextFacts): SourceContextVerdict {
  if (f.boardType === null || f.boardType.trim() === '') {
    return { operational: null, reason: '게시판을 읽지 못했다 — 출처 문맥을 판정할 수 없다' }
  }
  const title = (f.title ?? '').trim()
  const body = (f.body ?? '').trim()
  if (title === '' && body === '') {
    return { operational: null, reason: '제목·본문이 비었다 — 출처 문맥을 판정할 수 없다' }
  }
  if (f.visibility === null) {
    return { operational: null, reason: '노출 축을 읽지 못했다 — 출처 문맥을 판정할 수 없다' }
  }
  const external = isExternalSourcedBody(f.visibility)
  if (external && (f.sourceSite === null || f.sourceSite.trim() === '')) {
    return {
      operational: null,
      reason: '외부에서 왔는데 출처 공동체를 모른다 — 그 공동체의 운영 문맥을 판정할 수 없다',
    }
  }

  // 🔴 운영이 만드는 면은 표지를 찾을 것도 없이 운영 문맥이다
  if (OPERATIONAL_BOARD_TYPES.includes(f.boardType)) {
    return { operational: true, reason: `운영 제작 게시판이다 (${f.boardType})` }
  }

  const text = `${title}\n${body}`
  const hits = OPERATIONAL_MARKS.filter((m) => text.includes(m))
  if (hits.length > 0) {
    return { operational: true, reason: `운영·공지·광고 표지 ${hits.join(' · ')}` }
  }

  return {
    operational: false,
    reason: external
      ? `일상 글이다 — 출처 ${f.sourceSite ?? '?'} · 운영 표지 없음`
      : '일상 글이다 — 자체 게시글 · 운영 표지 없음',
  }
}

/** 🔴 fixture 가 목록을 다시 적지 않게 내보낸다. 값은 상수다 */
export const OPERATIONAL_MARK_SAMPLES: readonly string[] = OPERATIONAL_MARKS
export const OPERATIONAL_BOARDS: readonly string[] = OPERATIONAL_BOARD_TYPES
