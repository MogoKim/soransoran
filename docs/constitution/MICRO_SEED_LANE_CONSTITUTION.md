# Micro Seed Lane / Voice Engine Constitution

> 소란소란 커뮤니티 초기 공급 정본. **구현서가 아니라 운영 헌법이다.**
>
> 이후 schema · sitemap · JSON-LD · Google Sheet · 댓글 · 페르소나 · Voice Vault 작업을 하는
> 구현자는 이 문서를 기준으로 삼는다. 이 문서와 코드가 어긋나면 코드를 고친다.

**문서 버전** v1.0 (소란소란 정본)
**작성일** 2026-08-24
**작성 주체** Codex [3] Voice Engine Master
**적용 대상** 소란소란 Micro Seed Lane · 댓글 활성화 · Persona OS · Voice Vault
**전신** 우나어 repo의 초안 v0.3 — 소란소란 코드 실측 기준으로 **재구성**했다. 초안은 참조용으로만 남는다.

---

## 0. 이 문서를 읽는 법

| 표기 | 의미 |
|---|---|
| **계약(C-n)** | 구현자가 반드시 지켜야 하는 규칙. 위반은 리뷰에서 반려한다 |
| **정책** | 되돌리지 않기로 확정된 결정. 재논의 대상이 아니다 |
| **TODO** | 아직 정해지지 않은 것. 구현 전에 창업자·Codex[3]이 정한다 |
| 🟢 | 소란소란 코드에 이미 있거나 자연 충족 |
| 🟡 | 부분 충족 · 조건부 |
| 🔴 | 미구현 · 위험 |

### 소란소란 현재 코드 기준선 (2026-08-24 실측)

이 문서의 모든 판단은 아래 실측 위에 서 있다.

```
BoardType      MENOPAUSE(갱년기톡, /community/menopause)
               FREE(자유게시판, /community/free)
               MAGAZINE(/magazine) · BEST(/best)
PostStatus     PUBLISHED · HIDDEN · DELETED          ← SEO_ONLY 없음
AuthorSource   USER · SYSTEM                          ← Post·Comment 양쪽 컬럼

없는 것 (그리고 없는 편이 나은 것)
  Post.slug · trendingScore · promotionLevel · hotPromotedAt · publishAt
  topic hub · related posts · search · 공개 posts API · notification · activity feed
  Google Sheet 연동 · GitHub Actions workflows · Vercel cron

있는 것
  robots.ts        SORAN_ALLOW_INDEXING 미설정 시 전 사이트 disallow
  sitemap.ts       status:'PUBLISHED' + COMMUNITY_BOARDS. /best 의도적 제외
  best/page.tsx    robots: { index:false, follow:true }
  JSON-LD          매거진 상세에만 존재. 커뮤니티 상세는 0건
  queries/posts.ts UserBlock 필터를 실제로 적용 (우나어는 저장만 했다)
  migrations       0001_init · 0002_magazine_click
```

**이 기준선의 의미**: 제외해야 할 SEO/discovery 표면 15면 중 **현재 존재하는 것은 5면뿐**이다.
나머지는 아직 만들어지지 않았다. **지금이 게이트를 가장 싸게 심을 수 있는 시점이다.**

> ⚠️ **커뮤니티 목록·상세는 제외 대상이 아니다.** Micro Seed는 자유게시판·갱년기톡에
> **보여야 한다.** 제외 대상은 검색·색인·추천 표면이다. 자세한 구분은 §4·§7.

---

## 1. 목적과 North Star 연결

### 1-1. Micro Seed는 무엇을 위해 존재하는가

**커뮤니티 생활감과 활성화를 위해서다. SEO를 위해서가 아니다.**

빈 게시판은 사람을 돌려보낸다. 긴 글만 있는 커뮤니티는 가짜처럼 보인다.
실제 커뮤니티에는 짧은 글이 다수이고, 그 아래에 대화가 붙는다.
Micro Seed는 **그 대화가 붙을 자리를 먼저 만드는 레인**이다.

### 1-2. North Star 체인에서의 위치

```
검색 유입 → 매거진 공감 → 커뮤니티 클릭 → 글/댓글 작성 → 재방문
   1           2              3              4            5
   └── 매거진 (Codex[1]) ──┘   └────── Voice Engine (Codex[3]) ──────┘
```

**Micro Seed는 3→4 구간에만 기여한다.** 1·2 구간(검색 유입·매거진)에는 기여하지 않으며,
기여하도록 설계해서도 안 된다. 그것이 정책 8~10(영구 noindex)의 이유다.

### 1-3. 담당 범위

| 영역 | 담당 |
|---|---|
| 커뮤니티 글 · 댓글 · 페르소나 · Voice Vault · Micro Seed | **Voice Engine (Codex[3])** |
| 매거진 콘텐츠 생성 · 운영 · 전략 · SEO | **Codex[1]** — Voice Engine 범위 **밖** |

**Voice Engine은 매거진을 만들지 않는다.** 단 §11의 공용 표면은 함께 고려한다.

### 1-4. 성공을 무엇으로 판정하는가

Micro Seed의 단일 판정 지표는 **체인 3→4 전환율** — 커뮤니티에 진입한 실회원 세션 중
글 또는 댓글을 남긴 비율(봇 제외)이다.

**생성량 · 페르소나 수 · voice variation 수는 전부 하위 진단 지표다.**
"댓글이 많이 생성됐다"를 성과로 삼는 순간 우나어의 실패를 반복한다.

---

## 2. 확정 정책

재논의하지 않는다.

| # | 정책 |
|---|---|
| 1 | Micro Seed Lane을 채택한다 |
| 2 | 발행 보드는 **자유게시판(FREE) + 갱년기톡(MENOPAUSE)** 두 곳뿐이다 |
| 3 | 좋은 원문의 **1순위 신호는 댓글 수**다 |
| 4 | source는 **82cook + 네이버 카페**다 |
| 5 | 후보는 **Google Sheet에 HOLD로** 쌓는다 |
| 6 | **창업자가 제목/게시판/상태를 보고 PENDING으로 바꾼 것만** 예약 발행한다 |
| 7 | **본문 + 일부 원문 댓글 그대로 사용**을 허용한다 |
| 8 | Micro Seed 글은 **영구 noindex/internal**이다 |
| 9 | sitemap · JSON-LD · topic hub · 검색 대표글 · best/trending · related · 공개 API에서 **제외**한다 |
| 10 | **index 전환은 영구 금지**다 |
| 11 | **semantic slug 금지.** CUID URL을 쓴다 |
| 12 | 우나어 legacy는 **직접 발행 소스가 아니라** Voice Vault 학습/분석 자산이다 |
| 13 | **매거진은 Voice Engine 범위 밖**이다 |
| 14 | **댓글이 핵심이다.** 원문 댓글은 부속물이 아니라 반응 지도와 활성화 패턴의 핵심 자산이다 |
| 15 | Micro Seed의 목적은 **SEO가 아니라 커뮤니티 생활감/활성화**다 |

### 2-0. 🔴 노출 개념을 오해하지 말 것

정책 8~10의 "영구 noindex/internal"은 **검색엔진과 추천 표면에 대한 것**이다.
**커뮤니티 안에서 사람에게 보이지 않는다는 뜻이 아니다.**

```
✅ 보인다   자유게시판 목록 · 갱년기톡 목록 · 커뮤니티 상세 페이지
            회원이 클릭해서 읽고 댓글을 달 수 있다. 그것이 이 레인의 목적이다.

🚫 안 보인다 sitemap · JSON-LD · search · best · trending · topic hub
            related · 공개 API · OG image · notification · activity feed

⚠️ 상세는 접근 가능하되 meta robots 는 noindex 다.
   "접근 가능"과 "색인 가능"은 다른 축이다.
```

**목록·상세에서 빼면 Micro Seed는 존재 이유가 없다.**
커뮤니티 생활감을 만드는 것이 목적이고(정책 15), 아무도 못 보는 글은 생활감을 만들지 못한다.

### 2-1. Micro Seed가 아닌 것

- 🚫 저품질 자동화가 아니다. **창업자 승인형 internal seed lane**이다
- 🚫 검색 자산이 아니다. sitemap에 넣을 수 없는 것이 결함이 아니라 **설계**다
- 🚫 "많이 만들고 나중에 가린다"가 아니다. **처음부터 noindex로 확정**되고 발행된다
- 🚫 index 글의 예비군이 아니다. 좋은 글을 발견해도 승격하지 않는다. 필요하면 **별도 레인에서 새로 만든다**

### 2-2. "짧은 글 대량 발행 금지" 원칙과의 관계

기존 운영 원칙에는 *"짧은 글 대량 발행 금지"* · *"sitemap에 넣을 수 없는 글은 만들지 않는다"* ·
*"noindex 될 글을 대량 생산하지 않는다"* 가 있다.

**그 세 원칙은 검색 자산 레인(index 글)에 적용된다.** Micro Seed는 검색 자산 레인이 아니다.

세 원칙이 겨눈 실패는 **"많이 만들고 나중에 noindex로 가린다"** 였다.
Micro Seed는 반대로 **사전 선언**이며, **일일 cap이 있는 소량 레인**이다.
cap 없이 도는 순간 이 헌법을 위반한 것이며, 판정은 cap 소진율 로그로 한다.

---

## 3. Pre-M0 Safety Contract

> 정책 문장이 아니라 **구현자가 지켜야 하는 계약**이다. 각 조항은 위반 시 감지 가능해야 한다.

### C-1. 불변 플래그 계약

```
Micro Seed 글은 생성 시점에 아래 3개가 확정되고, 이후 어떤 경로로도 변경되지 않는다.

    isMicroSeed           = true
    permanentNoindex      = true
    indexPromotionBlocked = true
```

**구현 의무 — 일반 운영 경로**
- 이 세 필드에 `UPDATE`를 수행하는 **애플리케이션 코드 경로**를 만들지 않는다
- admin 편집 기능이 생겨도 세 필드는 폼에 포함하지 않는다
- 관리자 감사 편집은 허용하되 **플래그 훼손은 금지**한다

**예외 — one-off repair / migration**

불변은 "물리적으로 불가능"이 아니라 **"일반 경로로는 바뀌지 않는다"** 는 뜻이다.
데이터 오류를 고쳐야 할 때가 온다. 아래를 모두 충족하면 가능하다.

```
① 창업자 명시 승인
② 일회성 스크립트 또는 migration (앱 런타임 경로 아님)
③ dry-run 선행 — 대상 건수·before/after 를 먼저 보고
④ 감사 로그 기록 — 무엇을·왜·누가·언제·몇 건
⑤ 실행 후 §7 차단표 재검증
```

🚫 **금지**: 승인 없는 일괄 UPDATE · 앱 서버에서 실행되는 경로 · 감사 로그 없는 변경.

**위반 감지**: 애플리케이션 코드(`src/**`)에서 세 필드를 `SET` 하는 구문이 발견되면 리뷰 반려.
one-off 스크립트는 이 검사 대상이 아니되 위 5조건을 지킨다.

### C-2. 단일 판정 계약

```
Post 를 읽어 화면·검색·추천에 내보내는 모든 경로는
아래 3축 판정 함수 중 "해당하는 하나" 를 유일한 입력으로 사용한다.

    isCommunityVisible(post)    커뮤니티 목록·상세에 보여도 되는가
    isSearchIndexable(post)     sitemap·meta robots·canonical·JSON-LD·OG 에 들어가도 되는가
    isDiscoveryEligible(post)   best·trending·related·search·topic hub·public API·
                                notification·activity feed 에 들어가도 되는가
```

**금지**: `status` · `boardType` · `source` · `isMicroSeed` 를 **직접 비교**해 노출 여부를 판단하는 코드.

**근거(우나어 실측)**: 판정이 세 곳으로 갈라졌다 — 상세 metadata의 하드코딩 문자열 비교 /
sitemap의 Prisma where 조각 / 별도 noindex 모듈. **셋이 서로 다른 입력을 받아** 동기화가 깨졌다.
제외 조각(`EXCLUDE_*`) 호출 지점은 **49곳 / 9파일**로 확산됐다.

### C-3. 기본값 역전 계약

```
새로 만드는 SEO·discovery 표면의 기본값은 "제외" 다.
Micro Seed 를 포함하려면 명시적으로 허용해야 한다.

  대상  sitemap · meta robots · canonical · JSON-LD · OG
        best · trending · related · search · topic hub
        public API · notification · activity feed

  🚫 커뮤니티 목록·상세는 이 계약의 대상이 아니다.
     거기서는 Micro Seed 가 "보이는 것" 이 기본값이다.
```

**이유**: 열거형 화이트리스트는 표면이 늘 때마다 누락된다.
§7 표는 **고정된 전부가 아니다.** 새 SEO·discovery 경로가 생기면 기본 제외 대상이다.

### C-4. write-path 차단 계약

```
indexPromotionBlocked === true 이면 아래 진입 즉시 return 한다.

    승격 계산 · trendingScore 갱신 · best/trending 후보 편입
    notification 생성 · activity feed 기록
```

**이유**: read 표면 차단과 write 경로 차단은 **다른 축**이다.
우나어는 승격 시각 필드가 영구 불변이라 한 번 승격되면 **사후 복구가 불가능**했다.
**사전 차단만이 유효하다.**

**보조 규칙**: 비정규화 카운터(댓글 수 · 좋아요 수 · 조회수)는 화면 표시를 위해 **정상 갱신**하되,
**승격 · 추천 · 등급 산정의 입력에서는 제외**한다.

### C-5. slug 계약

```
Micro Seed 는 semantic slug 를 만들지 않는다. URL 은 CUID 다.
소란소란 Post 에는 현재 slug 컬럼이 없다 — 이 상태를 유지한다.
slug 를 도입하려면 Micro Seed 제외 조건을 "같은 PR" 에 포함한다.
```

**이유**: 전역 unique slug 구조에서는 internal 글도 slug 공간을 점유한다.
원문 제목 기반 slug가 검색용 index 글의 좋은 slug를 선점할 수 있다.

### C-6. Sheet 단일 방향 계약

```
자동으로 PENDING 이 되는 코드 경로를 만들지 않는다.
알 수 없는 상태값은 PENDING 이 아니라 HOLD 로 처리한다.
PROCESSING 을 되돌리기 전에 반드시 DB 를 실측한다.
```

**이유(우나어 실측)**: 알 수 없는 상태값을 PENDING으로 자가복구하는 구조였다.
**오타 한 글자가 곧 발행**이었다.

### C-7. 댓글 출처 계약

```
Micro Seed 댓글은 생성 시점에 원문 출처를 Comment 행 "자체" 에 남긴다.
실행 큐·임시 테이블을 감사 근거로 삼지 않는다.
```

**이유(우나어 실측)**: 원문 댓글↔봇 댓글 연결이 실행 큐에만 있었고 그 큐가 TTL로 삭제됐다.
발행 60시간 후에는 **어느 원문 댓글에서 왔는지 영구히 알 수 없다.**

### C-8. 공용 표면 선점 계약

```
아래는 매거진 트랙(Codex[1])과 물리적으로 공유한다.
  prisma/schema.prisma · prisma/migrations
  src/app/sitemap.ts · src/app/robots.ts
  JSON-LD 생성 위치 · PostStatus · publishAt
  src/lib/board-registry.ts · src/lib/queries/posts.ts · Vercel 배포

이 파일들을 건드리는 PR 은 착수 전에 Codex[1] 과 순서를 합의한다.
```

### C-9. surface check 계약

```
Micro Seed 발행 직후 차단 표면을 실측해 결과를 기록한다.
```

**이유**: 플래그를 세팅한 것과 **실제로 차단된 것은 다르다.**
자동 감시가 없으면 누수는 외부 제보로만 발견된다.

### C-10. 색인 전환 계약

```
SORAN_ALLOW_INDEXING 을 true 로 바꾸기 전에 §7 차단표 전 항목을 재검증한다.
```

**이유**: 현재는 robots가 전 사이트를 막고 있다.
이 전환은 **모든 표면이 동시에 열리는 단일 이벤트**다.
전환 시점 결정은 Codex[1]의 go 판정 사항이며, 사전 통보가 필요하다.

---

## 4. 3축 판정 함수 스펙

### 4-0. 왜 2축이 아니라 3축인가

"보인다 / 안 보인다"는 **하나의 축이 아니다.** 최소 세 개다.

```
커뮤니티에서 사람에게 보이는가   ≠   검색엔진이 색인해도 되는가
                                ≠   추천·모아보기에 올라도 되는가
```

Micro Seed는 **첫째는 true, 둘째는 항상 false, 셋째는 기본 false** 다.
2축(`isIndexable`/`isInternalOnly`)으로 쓰면 `isInternalOnly` 가
"커뮤니티에서도 숨긴다"로 오해되어 **레인의 존재 이유가 사라진다.**

### 4-1. 입력

```ts
type PostVisibilityInput = {
  status: PostStatus          // PUBLISHED | HIDDEN | DELETED
  boardType: BoardType        // MENOPAUSE | FREE | MAGAZINE
  isMicroSeed: boolean
  permanentNoindex: boolean
  discoveryEligible?: boolean // 미지정 시 !isMicroSeed 로 폴백
}
```

🚫 **`source: AuthorSource` 를 입력에 넣지 않는다.**
`SYSTEM` 은 "내부 공급"을 뜻하지만 매거진도 `SYSTEM` 일 수 있다.
판정 축이 섞이면 한 필드가 두 질문에 답하려다 실패한다.

### 4-2. 판정

```ts
/**
 * 커뮤니티 목록·상세에 보여도 되는가
 * → Micro Seed 는 PUBLISHED 이면 true. 여기서 빼면 레인의 목적이 사라진다.
 */
isCommunityVisible(p): boolean
  = p.status === 'PUBLISHED'
  // isMicroSeed 를 보지 않는다. 그것이 이 함수의 핵심이다.

/**
 * sitemap · meta robots · canonical · JSON-LD · OG 에 들어가도 되는가
 * → Micro Seed 는 항상 false (정책 8·10)
 */
isSearchIndexable(p): boolean
  = p.status === 'PUBLISHED'
  && !p.isMicroSeed
  && !p.permanentNoindex

/**
 * best · trending · related · search · topic hub · public API ·
 * notification · activity feed 에 들어가도 되는가
 * → Micro Seed 는 기본 false. 예외는 창업자 승인 사항(TODO-14)
 */
isDiscoveryEligible(p): boolean
  = p.status === 'PUBLISHED'
  && (p.discoveryEligible ?? !p.isMicroSeed)
```

**불변식**

```
isSearchIndexable(p)   === true  →  isCommunityVisible(p) === true
isDiscoveryEligible(p) === true  →  isCommunityVisible(p) === true
그 역은 성립하지 않는다.
```
즉 **커뮤니티 노출이 가장 넓고, 색인·추천이 그 부분집합**이다.

### 4-3. 반드시 사용해야 하는 지점

| 함수 | 소비처 | Micro Seed |
|---|---|---|
| **`isCommunityVisible`** | 커뮤니티 목록 쿼리(`queries/posts.ts`) · 커뮤니티 상세 접근 판정 · admin preview | 🟢 **true — 보인다** |
| **`isSearchIndexable`** | `sitemap.ts` · `generateMetadata`의 `robots` · canonical · JSON-LD 생성 조건 · OG image · `x-robots-tag` | 🔴 **항상 false** |
| **`isDiscoveryEligible`** | best · trending · related · search · topic hub · 공개 API · notification · activity feed | 🔴 **기본 false** |

**커뮤니티 상세는 두 함수를 함께 쓴다** — `isCommunityVisible`(접근 허용) + `isSearchIndexable`(noindex 부여).
**접근 가능과 색인 가능은 다른 축**이며, 이 조합이 Micro Seed 상세의 정확한 상태다.

### 4-4. 함수 없이 각 파일에서 조건을 따로 쓰면 — 우나어 실측 사고

| 사고 | 내용 |
|---|---|
| 판정 3벌 분산 | 상세 metadata / sitemap / 별도 모듈이 서로 다른 입력을 받아 동기화 실패 |
| 제외 조각 확산 | 호출 지점 49곳 / 9파일 |
| 1순위 쿼리 누락 | 관련글 1순위 쿼리에만 제외 조건 미적용 → 조용한 누수 |
| Prisma 3-value logic | `{ not }` 단독이 NULL 행을 제외시켜 필터가 무력화 |
| status enum 배신 | `SEO_ONLY` 가 이름의 약속과 달리 sitemap에 그대로 포함됨(priority 차이뿐) |

### 4-5. 구현 위치 · CI

- 위치 제안: `src/lib/post-visibility.ts` (3축을 한 파일에 둔다 — SEO 전용이 아니므로 `seo/` 하위가 아니다)
- **CI guard**: 판정 함수를 거치지 않고 Post를 select 해 응답에 넣는 신규 경로를 탐지한다.
  표면 목록만 검사하면 부족하다 — **판정 함수 미사용을 잡아야 한다.**
- 소란소란에는 현재 GitHub Actions workflows가 **0개**다. CI guard 도입은 §12 M0의 산출물이다.

---

## 5. 필수 DB 필드 단계

> 이전 감사에서 나온 필드를 **전량 투입하지 않는다.** 단계별로 나눈다.

### 5-0. Pre-M0 와 M0 의 역할 구분

```
Pre-M0   필드를 "확정" 한다.  이름 · 타입 · 기본값 · 불변 여부를 문서로 고정한다.
         🚫 코드 0줄. 스키마 변경 0. migration 0.

M0       확정된 필드를 "구현" 한다.  schema 반영 + migration + 판정 함수 + 표면 적용.
```

Pre-M0에서 필드를 확정하는 이유는, **판정 함수 스펙(§4)과 계약(§3)이 필드 이름에 의존**하기 때문이다.
이름이 흔들리면 계약도 흔들린다.

### 5-1. Pre-M0 확정 · M0 구현 — 게이트 성립 최소 (Post 3필드)

| 필드 | 타입 | 이유 |
|---|---|---|
| `isMicroSeed` | `Boolean @default(false)` | 판정 함수의 필수 입력 |
| `permanentNoindex` | `Boolean @default(false)` | 정책 8 |
| `indexPromotionBlocked` | `Boolean @default(false)` | 정책 9·10 · C-4 |

**이 3개만으로 C-1~C-4가 성립한다.**
`@default(false)` 라서 기존 글·매거진 동작에 영향이 **0** 이다.

> `discoveryEligible` (§4-1 optional 입력)은 M0에서는 만들지 않는다.
> `!isMicroSeed` 폴백으로 충분하며, 예외 허용(TODO-14)이 확정된 뒤에 도입한다.

### 5-2. M1 Google Sheet Founder Gate 필수

**Post**

| 필드 | 이유 |
|---|---|
| `sheetCandidateId String? @unique` | Sheet 역방향 키. **없으면 takedown 절차가 실행 불가** |
| `sourceSite` | `82cook` / `navercafe:{cafeId}` |
| `sourceUrl String? @index` | 원문 역조회 |
| `sourceArticleId` | 원문 글 id |
| `sourceCapturedAt` | 수집 시각 |
| `publishAt DateTime?` | 예약 발행 — **매거진과 공유 여부는 TODO-4** |
| `founderApprovedBy` / `founderApprovedAt` | 승인 주체·시각 |

**Sheet 후보 레코드** (Sheet 컬럼 또는 별도 테이블)

| 필드 | 이유 |
|---|---|
| `candidateId` | 행 고유 id(불변). **행 번호 의존 금지** |
| `status` | §6 8상태 |
| `processingStartedAt` | PROCESSING 진입 시각 — **timeout 판정의 유일한 근거** |
| `processingBy` | worker/run id — 중복 실행 감지 |
| `attemptCount` | 무한 재시도 차단 |
| `scheduledAtKst` | 예약 시각 |
| `holdReason` / `declineReason` | 사후 추적 |

> `processingStartedAt` · `processingBy` · `attemptCount` 는 **Post가 아니라 후보 레코드**에 둔다.
> Post는 발행 결과물이고 후보는 처리 대상이다.

### 5-3. M3 Comment Activation Engine 필수

| 필드 | 이유 |
|---|---|
| `Comment.commentOrigin` | **`AuthorSource`(USER/SYSTEM) 2값으로는 일반 봇 댓글과 Micro Seed 원문 댓글을 구분 못 한다** |
| `Comment.verbatimComment: Boolean` | 원문 그대로 사용 여부 |
| `Comment.sourceCommentHash: String?` | 원문 댓글에 안정 id가 없을 수 있어 **해시가 1차 키** |
| `Comment.sourceCommentIndex: Int?` | 순서. 재수집 시 흔들리므로 hash 병행 |
| `Comment.personaId: String?` | 누가 썼는가 |

### 5-4. 나중에 가능

`verbatimBodyRatio` · `quotableLabel` · `quotableLabelSource` · `commentTypeLabel` ·
`publishedAtSeq` · `titleBefore/After` · `boardBefore/After` · `corpusVersion` ·
`takedownStatus/At` · `capBucket` · `capConsumedAt` · `surfaceCheckedAt` · `surfaceCheckResult`

### 5-5. 🚫 넣으면 과한 것

| 필드 | 이유 |
|---|---|
| `trendingScore` | **아예 만들지 않는 것이 최선의 방어다.** 만들면 "0 고정" 정책을 지켜야 하는 부담이 생긴다 |
| `promotionLevel` · `hotPromotedAt` | 우나어에서 사후 복구 불가 사고의 원인. **승격 개념 자체를 도입하지 않는다** |
| `slug` | 정책 11. 현재 없는 상태를 유지한다 |
| `excludedSurfaces` (Json) | surface check 자동화(M2 이후) 전에는 채울 주체가 없다 |
| `sourceAuthorHash` | Voice Vault(M5) 영역 |

---

## 6. Google Sheet HOLD → PENDING 계약

### 6-1. ID 방향

```
Sheet 행                          DB
─────────────────────────────────────────────────────────
candidateId (불변 UUID)      ─→   Post.sheetCandidateId (@unique, 불변)
postUrl (결과 기록)          ←─   Post.id (CUID)

원칙
  candidateId 는 Sheet 가 발급하고 Post 가 참조한다.
  Post.id 는 DB 가 발급하고 Sheet 가 기록한다.
  양방향 키가 있어야 takedown 시 Sheet·Post 를 함께 전환할 수 있다.
```

`@unique` 제약은 **PROCESSING 복귀 전 DB 실측의 전제**다. 없으면 중복 조회가 모호해진다.

### 6-2. 상태 기계 (8상태)

```
        ┌──────────── collector ─────────────┐
        ▼                                    │
     [HOLD] ◄──────────────────────────┐     │
        │ 창업자 승인                   │     │
        ▼                              │     │
    [PENDING] ──── 예약시각 경과 ───────┘     │  (HOLD 복귀 + reason)
        │
        ▼ worker 획득 (processingStartedAt · processingBy 동시 기록)
   [PROCESSING] ─── timeout ──┐
        │                     │  DB 실측
        │                     ├─ 발행됨  → [PUBLISHED] 또는 [SKIPPED]
        │                     └─ 미발행  → [HOLD]      ← PENDING 아님
        ▼
   [PUBLISHED] / [FAILED] / [SKIPPED]
        │
        ▼ 외부 요청 · 원문 삭제
   [TAKEDOWN]

   [DECLINED] ← 창업자 반려 (HOLD 에서만 진입)
```

| 상태 | 의미 | 진입 조건 |
|---|---|---|
| `HOLD` | **기본값.** 후보 보관 | collector 적재 · 알 수 없는 값 · PROCESSING timeout(미발행) · 예약 경과 |
| `PENDING` | 창업자 발행 승인 | **사람만** 설정 가능. 자동 경로 없음 |
| `PROCESSING` | 작업 중 | worker 획득 |
| `PUBLISHED` | 발행 완료 | **DB 발행 성공 확인 후에만** |
| `FAILED` | 발행 실패 | 사유 기록 필수 |
| `SKIPPED` | 중복 · 이미 발행됨 | DB 실측 결과 |
| `DECLINED` | 창업자 반려 | 사유 기록 필수 |
| `TAKEDOWN` | 삭제/숨김 대상 | Post `HIDDEN` 전환과 **쌍으로** |

### 6-3. PROCESSING timeout 복구

```
조건: now - processingStartedAt > TIMEOUT

동작
  1. sheetCandidateId (또는 sourceUrl) 로 DB 실측
  2. Post 존재 → Sheet 를 PUBLISHED 또는 SKIPPED 로 정정   ← 이중 발행 방지
  3. Post 부재 → HOLD 복귀 + attemptCount++ + reason 기록
  4. attemptCount >= N → FAILED 로 고정 (무한 루프 차단)
```

🔴 **실측 없이 HOLD로 되돌리면 사고가 난다**

```
DB 발행 성공 → Sheet 갱신 실패 → timeout → HOLD 복귀
→ 창업자가 "아직 발행 안 됐네" 하고 재승인 → 이중 발행
```

**즉 timeout 복구 장치 자체가 실측 없이는 사고의 원인이 된다.**

### 6-4. 창업자 실수 방어

| 실수 | 방어 |
|---|---|
| 상태값 오타 | **알 수 없는 값 → HOLD** (C-6) |
| 행 정렬 · 삽입 · 삭제 | **행 번호가 아닌 `candidateId` 로 상태 갱신** |
| 게시판 오기입 | `board` 컬럼 화이트리스트(`free` / `menopause`)만 허용. 불일치 시 HOLD 유지 |
| 제목 비움 | 필수 필드 검증 실패 시 HOLD 유지 + 사유 |
| 되돌리기 | `PUBLISHED` 외 모든 전이는 가역. `statusHistory {from,to,at,by,reason}` 기록 |

### 6-5. 대량 승인 cap

| 층 | 성격 | 위치 | 변경 |
|---|---|---|---|
| **hard cap** | 절대 상한. 어떤 설정으로도 넘지 못함 | **코드 상수** | 코드 변경 + 창업자 승인 |
| **soft cap** | 일상 운영값 (hard cap 이하) | 설정 | 창업자 조정 가능 |
| **burst guard** | 1회 실행당 상한 | 코드 상수 | — |
| **first-run guard** | 최초 발행은 1건만 | 코드 상수 | — |
| **candidate ingest cap** | Sheet 폭증 방지 | 설정 | 넉넉하게 |

**승인 원자성**: 다중 승인은 all-or-nothing. 하나라도 문제가 있으면 큐를 건드리지 않는다.

### 6-6. TAKEDOWN 흐름

**적용 대상은 발행물이다. Raw Vault 자산이 아니다.**

```
1. sourceUrl 또는 sourceArticleId 로 역조회
2. 연결된 Post 와 Comment 확인
3. Post.status → HIDDEN  +  Sheet.status → TAKEDOWN   ← 쌍으로
4. 캐시 무효화
5. sitemap · search · 공개 표면 재확인
6. 감사 로그 기록
```

**역방향 조회 인덱스 2개가 성립 조건**: `Post.sourceUrl @index` · `Post.sheetCandidateId @unique`.

#### 🔴 발행물 처리와 Vault 보존은 별개 정책이다

```
발행물 (Post · Comment)      TAKEDOWN 흐름의 대상. 숨김 또는 삭제.
Raw Vault (원문 보관)         이 흐름이 자동으로 건드리지 않는다.
```

**Vault 자산을 자동 파기하지 않는다.** 이유는 셋이다.

1. Vault는 **분석·감사·학습 자산**이지 발행물이 아니다(§10)
2. 발행물을 숨긴 뒤에도 **"무엇을 왜 숨겼는지" 감사하려면 원본 참조가 필요**하다
3. 자동 파기는 **되돌릴 수 없다.** 판단 없이 실행할 성질이 아니다

**Vault 파기가 필요한 경우** — 아래를 별도로 밟는다.

```
① 창업자 판단 (외부 요청 · 보존기간 만료 · retentionUntil 도래)
② 파기 범위 명시 (해당 원문만 / 해당 source 전체 / 기간)
③ dry-run 으로 대상 건수 확인
④ 실행 + 감사 로그
⑤ Derived Vault 파생물 처리 여부 별도 판단
   (패턴·통계는 원문이 아니므로 함께 지울 필요가 없을 수 있다)
```

**TAKEDOWN 시 Vault 쪽에 남기는 것**: `deletedDetectedAt` 또는 takedown 표식만 기록하고
**보관 자체는 유지**한다. 파기 여부는 위 절차로 별도 결정한다.

> 원문 삭제("펑") 감지도 마찬가지다. **감지는 표식이지 파기 트리거가 아니다.**

---

## 7. 표면별 노출 정책표

> **차단표가 아니라 노출 정책표다.** 표면마다 Micro Seed를 **보여야 하는 곳**과
> **빼야 하는 곳**이 나뉜다. §4의 3축이 각 행의 판정 기준이다.

### 7-A. 🟢 노출 허용 — Micro Seed가 보여야 하는 표면

| # | 표면 | 소란소란 현재 | 정책 | 게이트 위치 | 함수 |
|---|---|---|---|---|---|
| 1 | **community list** (자유게시판·갱년기톡) | 🟢 존재 (`queries/posts.ts` 4곳) | 🟢 **노출.** Micro Seed도 목록에 뜬다 | 쿼리 `where`(`status:'PUBLISHED'` 유지) | `isCommunityVisible` |
| 2 | **community detail** | 🟢 존재 · 🔴 `robots` 메타 미설정 | 🟢 **접근 허용** + 🔴 **meta robots noindex** + JSON-LD 제외 + OG 제외 | `generateMetadata`(robots) · 접근 판정 | `isCommunityVisible` + `isSearchIndexable` |
| 3 | **admin preview** | 🟡 `/admin/reports` 만 | 🟢 **노출 허용.** 운영자는 봐야 한다 | — | 🔴 **플래그 훼손 금지**(C-1) |

**Micro Seed 표시 정책 (목록)** — TODO-17

```
① 아무 표시 없이 일반 글처럼 (기본 추천)
② 은은한 라벨 (예: 소재 출처 표기)
③ 회원 필터 제공 (숨기기 옵션)

권고: ① 로 시작. 라벨은 "봇 글"임을 광고하는 셈이라 생활감 목적과 충돌한다.
     다만 이 판단은 창업자 결정 사항이다.
```

### 7-B. 🔴 제외 — SEO / 색인 표면 (`isSearchIndexable` = false)

| # | 표면 | 소란소란 현재 | 게이트 위치 |
|---|---|---|---|
| 4 | **sitemap** | 🟢 존재 · 🔴 Micro Seed 필터 없음 | `getPublishedPosts()` where |
| 5 | **meta robots** | 🔴 커뮤니티에 미설정 | `generateMetadata` → `noindex, nofollow` |
| 6 | **canonical** | 🟡 layout 기본만 | `generateMetadata` |
| 7 | **JSON-LD** | 🟡 매거진에만 존재. 커뮤니티 0건 | 커뮤니티 확장 시 **생성 조건** |
| 8 | **OG image** | 🟢 루트 1개, Post 무관 | Post 단위 도입 시 |
| 9 | **x-robots-tag** | 🔴 미사용 | API · 비HTML 응답 헤더 |
| 10 | **robots.txt** | 🟢 존재 (현재 전 사이트 차단) | 글 단위 판정 불가 — **보조 수단** |

### 7-C. 🔴 제외 — Discovery / 추천 표면 (`isDiscoveryEligible` = false)

| # | 표면 | 소란소란 현재 | 게이트 위치 |
|---|---|---|---|
| 11 | **best** | 🟢 `robots:index:false` · 모아보기 로직 미존재 | 로직 도입 시 쿼리 |
| 12 | **trending** | 🔴 미존재 · 필드도 없음 | **도입 시 게이트** (또는 도입 안 함) |
| 13 | **topic hub** | 🔴 미존재 | **도입 시 게이트** |
| 14 | **related posts** | 🔴 커뮤니티 미존재 | **도입 시 게이트** (TODO-14) |
| 15 | **search** | 🔴 미존재 | **도입 시 게이트** |
| 16 | **public API** | 🟢 `/api/` 에 auth · 매거진 CTA뿐 | **도입 시 게이트 + x-robots-tag** |
| 17 | **notification** | 🔴 미존재 | **도입 시 write-path 차단**(C-4) |
| 18 | **activity feed** | 🔴 미존재 | **도입 시 게이트** |

### 7-D. 요약

```
노출 허용    3면  (community list · detail · admin preview)
SEO 제외     7면  (sitemap · meta robots · canonical · JSON-LD · OG · x-robots-tag · robots.txt)
Discovery 제외 8면  (best · trending · topic hub · related · search · public API ·
                    notification · activity feed)
────────────────────────────────────────────────────────────
제외 대상 15면 중 현재 존재하는 것은 5면
  sitemap · robots.txt · best · public API · (JSON-LD는 매거진에만)
나머지 10면은 미존재 → C-3(기본값 역전)이 자동 커버하도록 설계한다.
```

**robots.txt 만으로 충분하다고 결론내지 않는다.**

| 노출 축 | robots `/api/` 차단이 막는가 |
|---|---|
| 검색엔진 크롤 | 🟢 막는다 (준수하는 크롤러 한정) |
| 직접 URL 접근 | 🔴 못 막는다 |
| 외부 링크 · 스크래핑 · 아카이브 | 🔴 못 막는다 |
| 내부 클라이언트 fetch | 🔴 대상 아님 |
| 비준수 봇 | 🔴 못 막는다 |

**계층별 역할**

```
1) DB flag        isMicroSeed · permanentNoindex (불변)   ← 단일 진실
2) route filter   best · related · search · topic hub 쿼리 제외
                  ⚠️ 커뮤니티 목록·상세는 제외 대상이 아니다
3) API filter     공개 API 응답 제외                       ← robots 로 대체 불가
4) meta robots    상세 페이지 noindex, nofollow            ← 색인 방지 (접근은 허용)
5) x-robots-tag   API · 비HTML 응답용 헤더                 ← meta 못 붙는 곳
6) robots.txt     크롤 예산 절약 보조                      ← 단독으로는 불충분
```

---

## 8. 댓글 엔진 원칙

### 8-1. 댓글이 핵심인 이유

댓글 많은 원문은 이미 아래를 증명한다.

- 사람들이 반응할 주제다
- 공감 또는 온건한 의견 차이가 있다
- 질문 · 경험 · 조언이 붙을 수 있다
- 커뮤니티 안에서 다시 살아날 가능성이 있다

**그래서 좋은 원문 판단의 1순위 신호가 댓글 수다.**

다만 댓글 수만으로 발행하지 않는다. 댓글 수는 **정렬 신호**이고,
발행 전에는 결정론 필터(위험 · source · 보드 적합성 · 원문 접근 가능성)를 통과해야 한다.

### 8-2. 원문 댓글의 위치

**원문 댓글은 부속물이 아니라 반응 지도다.**
사람들이 **어디에** 반응했는지를 보여주는 유일한 사전 증거다.

```
Micro Seed 댓글 흐름 = 원문 댓글 일부 그대로  +  페르소나 보완 댓글
```

원문 댓글이 채우지 못한 반응 유형을 페르소나가 보완한다.

**초기 원문 댓글 사용 상한: 1~3개 권장** (TODO-6에서 확정)

### 8-3. 댓글 유형

```
공감 · 내 경험 · 질문 · 걱정 · 조언 · 약한 반대
```

좋은 댓글 흐름은 한 유형만 반복하지 않는다.
**"다들 똑같이 공감만 하는 댓글"은 티가 난다.**

### 8-4. 재료 없는 댓글 금지

```
원문 댓글이 없거나 사용 가능한 댓글이 너무 적으면 댓글을 만들지 않는다.
제목만 보고 만드는 댓글은 금지한다.
```

### 8-5. Micro Seed 댓글이 제외되어야 하는 경로

```
🔴 제외   JSON-LD comment[] · OG · search · related · best · trending
          notification · activity feed · 공개 API

🟢 노출   커뮤니티 상세 페이지의 댓글 영역
          → Micro Seed 댓글은 상세에서 "보여야" 한다.
            반응 지도를 재현해 대화가 붙게 하는 것이 목적이다.
```

🔴 **JSON-LD 위험이 가장 크다.** 우나어는 커뮤니티 상세 구조화 데이터에
**댓글 본문 최대 10개**를 그대로 실었다. 소란소란 커뮤니티 상세에는 현재 JSON-LD가 없다 —
**추가되는 시점이 최대 위험 시점**이며, 그 PR에 Micro Seed 제외 조건이 함께 들어가야 한다.

### 8-6. `commentOrigin` 은 `AuthorSource` 와 분리한다 (추천안)

```
AuthorSource   "사람이 썼나"          USER · SYSTEM
commentOrigin  "어느 레인에서 왔나"   MEMBER · PERSONA · MICRO_SEED_VERBATIM
```

**분리하는 이유**: 두 질문은 다른 축이다.
한 필드가 두 질문에 답하게 하면 우나어의 실패를 반복한다 —
그쪽은 하나의 분류 필드에 "주제"와 "욕망"을 섞었고, 결과적으로 **DB의 97%가 NULL**이 됐다.

### 8-7. 실회원 댓글과 North Star

**Micro Seed 원글 자체는 North Star의 "글 작성"으로 세지 않는다.**
`source: SYSTEM` 으로 구분 가능하다.

**그 글에 실회원이 단 댓글은 North Star에 포함하되 `microSeedAssisted` 로 분리 집계한다.**

```
totalParticipants      전체 참여자
organicParticipants    Micro Seed 무관 (= 진짜 자생)
microSeedAssisted      Micro Seed 글 경유
건전성 지표(역지표)     microSeedAssisted / total   ← 오르면 경고
```

**이유**: 전면 포함하면 Micro Seed 증량이 North Star를 밀어 올려 **봇 증량 유혹**이 생긴다.
전면 제외하면 **실제 사람의 진짜 참여를 지운다.**
분리 집계는 왜곡을 감지하면서 실참여를 보존하고, **Micro Seed의 효과 자체를 측정**할 수 있게 한다.

### 8-8. bot / real member / guest 분리

| 축 | 소란소란 현재 |
|---|---|
| **bot vs real member** | 🟢 `AuthorSource(USER/SYSTEM)` 가 `Post` · `Comment` 양쪽 컬럼에 존재. **우나어의 이메일 도메인 휴리스틱 3벌 문제를 원천 해결** |
| **guest** | 🔴 개념 없음. `Comment.authorId` 가 필수라 비회원 참여 구조가 없다 |
| **KPI 집계** | 🔴 집계 모델 없음. North Star 산출 구조 미구현 |

guest 도입 여부는 TODO-7.

---

## 9. 페르소나 / 봇 정체성 원칙

### 9-1. 30명에서 시작한다

**초기에는 30명 deep persona로 시작한다.**

### 9-2. 10,000의 의미

**목표는 active bot 10,000명이 아니라 voice variation 10,000개다.**

계정 수는 비용(운영 부담 · 탐지 위험 · KPI 오염)을 선형으로 늘리지만 가치를 늘리지 않는다.
**같은 말투 10,000명의 다양성은 1이다.**

늘려야 하는 것은 **말투 축의 조합 수**다 — 어미 × 문장 길이 × 이모지 정책 ×
맞춤법 습관 × 호칭 × 생애단계. 계정 30개로도 조합 수백 개가 나온다.

### 9-3. 페르소나 필수 속성

| 속성 | 예시 |
|---|---|
| `ageBand` | 40대 후반 · 50대 초반 · 50대 후반 · 60대 초반 |
| `lifeState` | 자녀 독립 · 남편 은퇴 · 재취업 고민 · 갱년기 진행 |
| `boardAffinity` | 자유게시판 중심 · 갱년기톡 중심 |
| `writingLength` | 짧은 잡담형 · 질문형 · 긴 사연형 |
| `commentHabit` | 공감 먼저 · 경험 공유 · 조심스러운 조언 |
| `endings` | 말끝 습관 |
| `typoPattern` | 드물게 나타나는 오타 · 띄어쓰기 습관 |
| `emojiPattern` | 거의 안 씀 · 가끔 씀 |
| `noGo` | **절대 하지 않는 말** |
| `memory` | 과거에 쓴 글 · 댓글의 연속성 |

### 9-4. 누적 정체성

**같은 페르소나는 글/댓글의 누적 정체성을 가져야 한다.**
중요한 것은 "많은 봇"이 아니라 **"서로 다른 사람이 쓴 것처럼 보이는 일관성"** 이다.

### 9-5. 후속 모델 필요성

```
Persona           id · displayName · userId(@unique → User)
                  ageBand · lifeState · boardAffinity · writingLength
                  commentHabit · endings · typoPattern · emojiPattern · noGo
                  isActive · dailyCap · createdAt · retiredAt

PersonaMemory     personaId · postId/commentId · topicTags · at
                  → §9-3 `memory` 의 구현체

VoiceVariation    personaId · endingUsed · lengthBand · emojiUsed · hookType
                  → 문장 지문 중복률 산출 근거
```

### 9-6. 🚫 우나어 교훈 — TS 상수 배열 금지

**페르소나를 코드 상수 배열로 두지 않는다.**

우나어는 페르소나를 TS 배열에 두었고, 정의가 다섯 곳으로 흩어져
SSoT 통합에 **PR 7단계**를 소모했다. 225명 규모에서 이미 그 비용이었다.
**처음부터 DB 모델로 둔다.**

### 9-7. 역지표 — 문장 지문 중복률

```
최근 발행물 전체에서 상위 빈출 n-gram 의 점유율.
오르면 "같은 봇이 쓴 티" 가 난다는 뜻이다.
```

우나어에는 이 지표가 없어 **225명의 실효 다양성을 아무도 모른다.**

---

## 10. Voice Vault 원칙

### 10-1. 우나어 legacy의 위치

**우나어 legacy는 Micro Seed 직접 발행 소스가 아니다.** (정책 12)

역할은 다음이다.

- 실제 4050/5060 여성 커뮤니티 말투 분석
- 갱년기 · 사는 이야기 소재 구조 분석
- 댓글 많은 글의 반응 패턴 분석
- 우나어 실패 사례 분석 (Risk Dataset)
- Voice Corpus · Derived Vault 구축

**학습 자산이지, 소란소란에 그대로 옮겨 발행하는 자산이 아니다.**

**구현 강제**: `origin` 구분 필드로 `unao_legacy` 를 표시하고,
Micro Seed 후보 쿼리에서 **코드로 배제**한다. 문서 규칙으로만 두지 않는다.

### 10-2. 3계층

| 계층 | 내용 | 발행 직접 사용 |
|---|---|---|
| **Raw Vault** | 원문 제목 · 본문 · 댓글 · URL · 수집 시점 · 출처 · 반응 수치 | 🔒 접근 제한. Micro Seed 승인 경로에서만 제한 사용 |
| **Derived Vault** | 패턴 · 감정 흐름 · 생활 디테일 · 댓글 반응 지도 · 말투 특징 · 위험 라벨 · 인용 적합성 | 🟢 index 글 / Persona / Voice Engine 입력 |
| **Publishing Input** | 발행 가능한 조합 재료만 | 레인별 제한 |

### 10-3. Raw Vault 필수 필드

```
origin (unao_legacy | live)
sourceSite · sourceUrl · sourceArticleId · sourceCapturedAt
lastVerifiedAt · deletedDetectedAt · retentionUntil
rawTitle · rawBody · rawComments[] (+ 개별 id 또는 contentHash)
commentCount · topCommentsCrawledAt · riskFlags
```

🔴 **`deletedDetectedAt` 이 중요하다.** 원문이 삭제("펑")되면 감지할 수단이 있어야 한다.
우나어는 발행 직전 게이트로만 사후 대응했고, 이미 저장된 원문의 삭제는 감지하지 못했다.

### 10-4. Derived Vault 필수 산출

```
생활 디테일 · 감정 흐름 · 고민 구조 · 말투 습관 · 제목 감각
댓글이 달린 포인트 · 댓글 유형 분포 · 댓글 단위 인용 적합성 라벨
갱년기 신호 · target fit · risk labels
본문 길이 밴드 · 글 유형 · 반응 시퀀스
```

### 10-5. Publishing Input 분기

| 레인 | 입력 | 우나어 legacy |
|---|---|---|
| index 커뮤니티 글 | **Derived만** | ⛔ 사용 불가 |
| Micro Seed | Raw 예외 허용 (82cook + 네이버 카페 한정) | ⛔ `origin = unao_legacy` 쿼리 배제 |
| Persona 보완 댓글 | Derived (반응 지도 + 말투 통계) | 🟢 학습 재료 |

### 10-6. 구현 시점

**Voice Vault 구현은 후순위(M5)일 수 있다. 그러나 보존 정책은 Pre-M0에서 확정한다.**
보존하지 않기로 결정하면 되돌릴 수 없기 때문이다.

---

## 11. Codex[1] 충돌 경계

```
┌──────────────────────────────────────────────────────────┐
│ Codex[1] 영역 — Voice Engine 범위 밖                      │
│   매거진 콘텐츠 생성 · 운영 · 전략 · SEO                   │
│   scripts/magazine-*.mjs · scripts/lib/magazine-*.mjs      │
│   drafts/magazine/** · src/app/magazine/**                 │
│   src/lib/magazine.ts · src/content/** · MagazineClick      │
│   /api/go/[slug]/[board]                                    │
│   → Voice Engine 은 매거진을 만들지 않는다                  │
├──────────────────────────────────────────────────────────┤
│ 🔶 공용 표면 — 양쪽이 물리적으로 공유                      │
│   prisma/schema.prisma · prisma/migrations                 │
│   src/app/sitemap.ts · src/app/robots.ts                   │
│   JSON-LD 생성 위치 · PostStatus · publishAt               │
│   src/lib/board-registry.ts · src/lib/queries/posts.ts     │
│   Vercel 배포 · SORAN_ALLOW_INDEXING                       │
│   → Micro Seed 제외 조건이 "함께" 고려되어야 한다          │
├──────────────────────────────────────────────────────────┤
│ Codex[3] 영역 — Voice Engine                               │
│   Micro Seed Lane · 댓글 활성화 엔진 · Persona OS          │
│   Voice Vault · Sheet Founder Gate · indexability 게이트   │
│   자유게시판(FREE) + 갱년기톡(MENOPAUSE) 발행               │
└──────────────────────────────────────────────────────────┘
```

**핵심**: 범위 분리는 **개념**이고 파일은 **하나**다.
매거진을 Voice Engine에 넣자는 뜻이 아니라, 공용 표면에 Micro Seed 제외 조건이 빠지면 누수가 생긴다는 뜻이다.

### 11-1. Codex[3] 이 건드리지 않는 것

```
🚫 scripts/lib/magazine-load.mjs
🚫 scripts/lib/magazine-gate.mjs
🚫 scripts/magazine-*.mjs
🚫 drafts/magazine/**
🚫 src/app/magazine/**  ·  src/lib/magazine.ts  ·  src/content/**
```

### 11-2. 공용 파일 재조율 조건

**2026-08-24 합의**: Codex[1]은 `scripts/**` · `drafts/magazine/**` 중심으로 작업 중이며
공용 파일은 당장 수정 계획이 없다. Codex[3]은 Pre-M0 문서화와 M0 설계를 먼저 진행해도 된다.

🔴 **다만 실제 구현 PR에서 공용 파일을 건드리기 전에 Codex[1]과 재조율한다.**

| 공용 파일 | 주의사항 |
|---|---|
| `prisma/schema.prisma` | Post에 boolean 3개를 `@default(false)` 로 추가. **기존 쿼리·매거진 동작 영향 0** |
| `prisma/migrations/` | 현재 `0001_init` · `0002_magazine_click`. **다음 번호 배정을 먼저 합의** |
| `src/app/sitemap.ts` | 매거진 발행 작업과 순서 조율 |
| `src/app/robots.ts` | `SORAN_ALLOW_INDEXING` 전환은 Codex[1] go 판정 사항 |
| **JSON-LD 위치** | 커뮤니티 상세에 추가할 계획이 생기면 **사전 통보**. Micro Seed 제외 조건이 같은 PR에 필요 |
| `PostStatus` | 상태를 늘릴 계획이 있는지 확인. **이름-동작 불일치는 피한다** |
| `publishAt` | 두 트랙이 같은 예약 발행 필드를 요구 (TODO-4) |
| Vercel 배포 | 동시 배포 금지. 시점 공유 |

---

## 12. 마일스톤

| 마일스톤 | 목적 | 산출물 | 완료 조건 | Codex[1] 충돌 |
|---|---|---|---|---|
| **Pre-M0 Safety Contract** | 구현 전 합의 · **필드 확정** | 이 문서 · §13 결정 · Codex[1] 조율 · Post 3필드 이름/타입 확정 | 계약 승인. **코드 0줄 · schema 0 · migration 0** | 🟢 없음 |
| **M0 Schema & Gate Foundation** | 게이트를 먼저 세운다 | Post 3필드 **구현** · 3축 판정 함수(`isCommunityVisible`/`isSearchIndexable`/`isDiscoveryEligible`) · 현존 표면 적용 · CI guard | Micro Seed 0건 상태에서 **기존 표면 회귀 0** | 🔴 schema · migrations |
| **M1 Google Sheet Founder Gate** | 사람 승인 게이트 | 8상태 기계 · ID 양방향 · timeout 복구 · cap 계층 · `publishAt` | 오타 · 정렬 · 크래시 · 부분실패가 의도치 않은 발행으로 이어지지 않음 | 🟡 `publishAt` |
| **M2 Micro Seed MVP** | 첫 발행 | 본문 발행 · 원문 그대로 사용 · 창업자 승인 · surface check · 첫 1건 제한 | **§12-0 완료 조건** 참조 | 🟢 |
| **M3 Comment Activation Engine** | 댓글 활성화 | `commentOrigin` · 출처 5필드 · 원문 댓글 1~3개 · 반응 지도 | 댓글 출처 **역추적 가능** | 🟡 JSON-LD |
| **M4 Persona OS** | 30명 deep | Persona · PersonaMemory · VoiceVariation | 같은 페르소나의 **연속성 성립** | 🟢 |
| **M5 Voice Vault** | 자산화 | Raw / Derived / Publishing Input 3계층 | 우나어 legacy 학습 자산화 | 🟢 |
| **M6 Voice Engine LLM** | 재창작 | 후보 좁힌 뒤 제한 사용 · 비용 hard stop | 비용 상한 내 동작 | 🟢 |
| **M7 Scale / Cost / QA Automation** | 확장 | cap 상향 · 자동 QA · 비용 원장 | — | 🟡 배포 |

### 12-0. M2 Micro Seed MVP 완료 조건 (상세)

발행 1건으로 아래를 **전부 실측**해야 완료다.

```
🟢 노출되어야 한다
   [ ] 자유게시판 또는 갱년기톡 목록에 정상 노출
   [ ] 커뮤니티 상세 페이지 접근 시 HTTP 200 · 본문 정상 렌더
   [ ] 로그인 회원이 댓글을 달 수 있다

🔴 노출되지 않아야 한다
   [ ] sitemap.xml 에 해당 URL 없음
   [ ] JSON-LD 미생성 (HTML 소스에 application/ld+json 0건)
   [ ] OG image 미생성 또는 generic
   [ ] search 결과 0건            (표면 도입 시)
   [ ] best · trending 미포함      (표면 도입 시)
   [ ] topic hub 미포함            (표면 도입 시)
   [ ] related posts 미포함        (표면 도입 시)
   [ ] 공개 API 응답 미포함        (표면 도입 시)
   [ ] notification · activity feed 미발생 (표면 도입 시)

🔴 메타데이터
   [ ] 상세 페이지 meta robots = noindex (nofollow 여부는 TODO-18)

🔴 감사
   [ ] surface check 결과가 기록됨 (C-9)
   [ ] sheetCandidateId ↔ Post 양방향 조회 성공
```

**"전 표면 미노출"이 완료 조건이 아니다.** 커뮤니티에서 보이는 것이 절반이고,
검색·추천에서 안 보이는 것이 나머지 절반이다.

### 12-1. 왜 M0(게이트)이 먼저인가

제외해야 할 SEO·discovery 표면 15면 중 **현재 존재하는 것은 5면뿐**이다.
`trendingScore` · `promotionLevel` · related · search · topic hub · 공개 posts API가 **아직 없다.**

우나어는 반대 순서였다. 표면을 다 만든 뒤 게이트를 붙였고,
그 사이 이미 수천 페이지가 색인됐다. **게이트를 나중에 붙이면 소급 작업이 생긴다.**

### 12-2. 자동화 개방 순서

```
read-only inventory → dry-run → HOLD append → founder PENDING → 1건 publish → limited publish
```

수집기 · 발행기 · 댓글 엔진 · persona engine은 각각 kill switch를 가진다.

**현재 소란소란에는 GitHub Actions workflows · Vercel cron · Google Sheet 연동이 전부 0개다.**
자동화 계층 신설은 M1의 설계 대상이며, **수동 실행부터 시작한다.**

---

## 13. 창업자 / Codex[3] 결정 필요 사항

### 13-1. 지금 결정 (Pre-M0 종료 조건)

| # | 결정 | 추천안 |
|---|---|---|
| **TODO-1** | `prisma/migrations` 다음 번호 배정 | Codex[1]과 합의 후 확정 |
| **TODO-2** | `commentOrigin` 을 `AuthorSource` 확장으로 갈지 별도 컬럼으로 갈지 | 🟢 **별도 컬럼 추천.** 두 질문은 다른 축이다 (§8-6) |
| **TODO-3** | Micro Seed 글의 실회원 댓글을 North Star에 포함하되 `microSeedAssisted` 로 분리할지 | 🟢 **분리 집계 추천** (§8-7) |
| **TODO-4** | `publishAt` 을 매거진과 공유할지 분리할지 | 🟡 공유가 단순하나 정책 분기가 섞인다. **Codex[1] 협의 필요** |
| **TODO-5** | `trendingScore` 필드를 아예 만들지 않을지 | 🟢 **만들지 않기 추천.** 없으면 지킬 정책도 없다 |
| **TODO-9** | Voice Vault 보존 정책 확정 (구현은 M5라도) | 🟢 지금 확정 추천. 보존하지 않기로 하면 되돌릴 수 없다 |

### 13-2. M0~M1에 결정

| # | 결정 | 추천안 |
|---|---|---|
| **TODO-6** | 원문 댓글 사용 개수 상한 | 초기 **1~3개** |
| **TODO-7** | guest 개념을 지금 넣을지 | 🟡 **나중 추천.** 현재 `Comment.authorId` 필수라 비회원 참여 구조가 없고 Micro Seed와 무관 |
| **TODO-8** | GitHub Actions workflows를 지금 만들지 | 🟡 **수동부터 추천.** 단 **CI guard(C-2 위반 감지)만은 조기 도입** 검토 |
| **TODO-10** | PROCESSING timeout 값 | 운영 주기 기준으로 Codex[1]과 확정 |
| **TODO-11** | 발행 soft cap · candidate ingest cap 초기값 | 운영 중 조정 가능하게 하되 hard cap은 코드 상수 |
| **TODO-12** | takedown SLA | 빠른 숨김 우선. 정확한 시간은 별도 |
| **TODO-13** | `SORAN_ALLOW_INDEXING` 전환 시점 | Codex[1] go 판정. **전환 전 §7 차단표 재검증 필수** (C-10) |
| **TODO-14** | Micro Seed 끼리 related 내부 노출 허용 여부 | 🟢 **초기에는 금지 추천** |
| **TODO-15** | admin 감사 편집 권한 범위 | 허용하되 **플래그 훼손 금지** (C-1) |
| **TODO-16** | 비용 hard stop 임계값 · 차단 단위 | M6 이전 확정 |
| **TODO-17** | 커뮤니티 목록에서 Micro Seed 를 **표시할지** (라벨 · 필터) | 🟢 **표시 없이 시작 추천.** 라벨은 "봇 글"임을 광고하는 셈이라 생활감 목적과 충돌한다 (§7-A) |
| **TODO-18** | Micro Seed 상세 meta robots 를 `noindex, nofollow` 로 할지 `noindex, follow` 로 할지 | 🟡 **`noindex, follow` 검토.** 본문 내부 링크가 있다면 follow 가 나을 수 있다. 외부 링크가 없다면 차이 없음 |

---

## 14. 개정 원칙

- 이 문서는 **소란소란 repo의 정본**이다. 우나어 repo의 초안은 참조용으로만 남는다
- 확정 정책(§2)은 재논의하지 않는다. 개정하려면 창업자 승인이 필요하다
- 계약(§3 C-1~C-10)은 구현 경험으로 보완할 수 있으나, **완화는 창업자 승인 대상**이다
- TODO는 확정되는 대로 본문에 반영하고 목록에서 제거한다

---

## 15. 한 줄 정본

**Micro Seed Lane은 검색 자산이 아니라 소란소란 초기 커뮤니티 생활감을 만드는 창업자 승인형
internal seed lane이며, 댓글 수가 검증한 원문과 일부 원문 댓글을 적극 활용하되,
영구 noindex/internal · 전 표면 차단 · source trace · 댓글 단위 감사 · founder gate ·
Codex[1] 공용 표면 조율을 전제로만 운영한다.**
