# M3 — 새 브랜드 준비 전략 (New Brand Readiness)

> **문서 성격**: 실행 계획이 아니라 **판단 기준 문서 + D-day 준비 문서**다.
> 네이버 회복 실패로 `우리 나이가 어때서`가 생존 불가 판정을 받을 경우,
> 창업자 승인 후 **24시간 안에 새 브랜드 MVP를 개설**할 수 있도록
> 브랜드·제품·코드·인프라·SEO·운영·콘텐츠 정책을 미리 확정해 둔다.
> **갱신 방식**: append/update. 마일스톤이 끝날 때마다 해당 절을 갱신한다.
>
> 최초 작성 2026-08-19 · 근거 M3-0 AS-IS Inventory (read-only 실측)

---

## 0. 현재 판정

**PARTIAL — 전환 가능하나, 그대로 복제하면 같은 문제를 재생산한다.**

코드 자산은 재사용 가치가 충분하다. 그러나 **운영·콘텐츠 구조를 그대로 가져가면
새 브랜드에서도 "퍼온 글 99.4% + 봇 댓글 93.5%" 구조가 반복된다.**
가능한 시나리오는 하나뿐이다 — **핵심 도메인만 재사용하고 운영/크롤러/SEO는 재설계**.

### M3의 최종 목표

M3의 목표는 새 브랜드를 지금 실행하는 것이 아니다.

**목표는 `우리 나이가 어때서`가 네이버에서 회복 불가 판정을 받을 경우,
창업자 승인 후 24시간 안에 새 브랜드 MVP를 개설할 수 있도록 사전에 모든 판단과
절차를 끝내 두는 것이다.**

따라서 M3는 다음을 D-day 전까지 확정해야 한다.

```
브랜드명 후보 · 도메인 후보 기준 · 제품 본질 · MVP 정보구조
코드 이식 범위 · 버릴 레거시 · 새 인프라 생성 순서
SEO 초기 정책 · 콘텐츠 공급 정책 · 봇/페르소나 운영 정책
기존 회원 재가입 안내 · 기존 도메인 비연결 원칙 · 런칭 체크리스트
```

단, 회복 불가 판정 전에는 코드 작성·계정 생성·도메인 구매·인프라 생성은 하지 않는다.

---

## 1. 현재 위기

### 사실 (실측)

| 항목 | 상태 | 근거 |
|---|---|---|
| 네이버 유입 | **붕괴** | 2026-08-12 11:00 KST 이후. 일 1,541 → 7~10 |
| 네이버 색인 | **0** | 08-11 4,600 → 08-13 0 (Search Advisor) |
| 네이버 노출 | **0** | 08-14 이후 0 (08-18 툴팁: 노출 0 · 클릭 0) |
| 네이버 수집 | **극소량 유지** | 08-13 약 3,400 → 08-15 144 → 08-16~08-20 하루 4~14건 수준 |
| 홈페이지 색인 | **미색인** | "문서가 성공적으로 수집됐습니다. 미색인 문서로 검색대상이 아닙니다" |

**기술적 차단은 아니다.** URL 검사 8개 항목이 전부 통과한다 —
`200 OK` · `robots.txt 수집 가능` · `로봇 메타 노출 가능` · `색인 허용 여부: 예`.
그런데 **`색인 완료: 아니오`**다. 우리가 막은 것이 아니라 네이버가 색인하지 않았다.

### 대응은 이미 했다 (merge 완료, 되돌리지 말 것)

- **PR #387** 커뮤니티 soft404 → 404 복원 (`loading.tsx` 제거)
- **PR #388** fallback description 고유화 (duplicate description 재생산 차단)
- **PR #389** magazine/jobs soft404 → 404 복원
- 프로덕션 실측: 네이버가 지적한 soft404 13건 **전부 404 반환 확인**

### 그러나 회복 여부는 미확정이다

```
08-16  네이버 수집량이 하루 10건 안팎으로 축소
08-17  진단 데이터 마지막 갱신
─────────────────────────────────────
08-18  PR #387/#388/#389 배포  ← 네이버 수집량이 극단적으로 축소된 시점
```

**수집량이 하루 10건 안팎으로 축소된 구간에 우리 수정이 들어갔다.** 네이버가 고친 결과를 일부 볼 수는 있으나, 전체 수정분이 반영됐다고 볼 수 없다.
수집 요청은 이미 3회 있었다(08-12 18:37 · 08-13 21:15 · 08-16 07:49). 그럼에도 색인 0이다.

### Google은 보완재가 되지 못한다

```
28일 클릭 85 · 노출 577 · 일평균 클릭 3.3
그중 38클릭(45%)이 "우리 나이가 어때서" 브랜드 검색
색인 6,220 / 미색인 15,796 — 색인률 28%
색인된 6,220개 중 28일간 노출된 URL은 398개(6.4%)
```

**신규 발견 유입은 28일간 47건, 하루 1.7건이다.** Google이 우리를 막은 것이 아니라,
상위에 올릴 이유를 찾지 못하고 있다.

### 결론

서비스 종료까지 고려해야 하는 **생존 위기**다. 회복 여부를 우리가 통제할 수 없는 구간에 있다.

---

## 2. North Star (불변)

> **40대 중반~60대 중반 여성, 특히 50대 여성이 반복 방문하는 커뮤니티.**
> 사용자가 **"나만 그런 게 아니구나"**를 느끼고 댓글과 글을 남기는 공간.

- **타겟 우선순위**: 1순위 50대 여성, 2순위 40대 후반 여성, 3순위 60대 여성.
- **일자리 플랫폼이 아니라 커뮤니티다.** 일자리·돈·노후·일은 커뮤니티 안의 생활 축이다.
- **핵심 주제**: 갱년기, 남편, 자녀, 가족 갈등, 부모 간병, 건강, 노후, 돈, 일, 외로움, 불안, 생활 고민
- **외부글은 트래픽용 복붙이 아니라 대화를 여는 seed다.**
- 금지 표현: 시니어·어르신·노인·실버 → "우리 나이", "우리 또래", "40대 50대 여성", "인생 2막"

### 창업자 확정 원칙 (2026-08-20)

1. 새 브랜드도 본질은 **여성 커뮤니티**다. 범용 커뮤니티나 일자리 플랫폼으로 가지 않는다.
2. 핵심 타겟은 **50대 여성**이다. 40대 후반 여성과 60대 여성은 확장 타겟이다.
3. 새 브랜드명은 `우리 나이`를 직접적으로 반복하기보다 **더 은은한 이름**으로 간다.
4. 시작점은 **갱년기 특화 커뮤니티**다. 처음부터 여러 주제로 넓히지 않고, 갱년기를 공통 주제로 찐팬을 만든 뒤 확장한다.
5. 일자리 독립 구조는 버린다. 돈·노후·사는 이야기·유머·일 관련 이야기는 자유게시판 또는 매거진 안의 주제로 흡수한다.
6. 기존 회원 데이터는 이관하지 않는다. 기존 회원에게는 카카오톡 등으로 새 브랜드 재가입을 유도한다.
7. 기존 도메인에서 새 도메인으로 전체 리다이렉트하지 않는다. 실패한 도메인의 신호를 새 브랜드에 연결하지 않는다.
8. 새 브랜드의 계정·도메인·인프라는 `우리 나이가 어때서`와 최대한 독립적으로 분리한다.

### North Star 대비 현재 성적표 (M3-0 실측)

```
발행 10,644건            BOT 72.8% · SHEET 26.6% · ★ USER 0.6% (62건)
댓글 62,808건            봇 93.5% · ★ 실회원 6.4% (3,996건)
계정 507개               봇 83 · 실회원 424
최근 7일 실회원 글        5건 (일 0.7)
최근 7일 실회원 댓글      446건 (일 63.7)
본문 길이                71.4%가 300자 미만
일 발행량                134건
```

**활발해 보이지만 그 활발함의 대부분을 우리가 만들고 있다.** 이것이 현재 구조의 핵심 문제다.

---

## 3. 새 브랜드를 준비하는 이유

1. **회복 실패 대비.** 네이버 색인·수집이 우리 통제 밖이다. 회복되지 않을 가능성에 보험이 필요하다.
2. **단순 복제가 아니다.** 같은 North Star를 가진 **더 작고 밀도 높은 제품**으로 재시작한다.
3. **자산은 가져가고 부채는 두고 간다.** 코드 자산(커뮤니티 구조·댓글·인증·선별 큐)은 활용하되,
   레거시 운영·비용 비효율·저품질 신호는 가져가지 않는다.

### 도피가 아닌 이유

이 준비는 **"옮기자"가 아니라 "옮길 수 있는가, 옮긴다면 무엇을 버려야 하는가"**를 묻는다.
**네이버가 회복되면 이 문서는 현재 서비스 개선 로드맵으로 그대로 쓰인다.**
봇 비율 93.5%, 회원 글 0.6%, 발행 134건은 새 브랜드로 가든 안 가든 똑같이 고쳐야 할 문제다.
어느 쪽이든 버려지지 않는 작업이다.

---

## 4. 새 브랜드 1차 정보구조

```
홈           인기글
게시판 1      자유게시판
게시판 2      갱년기
SEO 콘텐츠    매거진
```

### 해석 (중요 — 오해 방지)

| 면 | 성격 | 오해하면 안 되는 것 |
|---|---|---|
| **인기글** | 홈/랭킹 **노출면** | 게시판이 아니다. 별도 보드를 만들지 않는다 |
| **자유게시판** | **확장 대화판** | 돈·노후·사는 이야기·유머·일 관련 이야기를 흡수한다 |
| **갱년기** | **초기 차별화 핵심판** | 새 브랜드의 시작점이다. 이 주제로 찐팬을 만든 뒤 확장한다 |
| **매거진** | SEO용 **편집 콘텐츠** | **대량 AI 글 창고가 아니다.** 적게, 길게, 원본으로 |

### 왜 이 구조인가 (근거)

- **매거진의 효율이 검증됐다.** GSC 실측에서 매거진 262건이 노출 82·클릭 5를 만들었다.
  글당 효율이 커뮤니티의 3배다. `guide` 4건은 노출 42로 **글당 노출 10.5 — 전 유형 1위**다.
  → **적은 수의 긴 원본 글이 많은 수의 짧은 글을 이긴다.**
- **갱년기 검색어에 이미 노출되고 있다.** "갱년기 극복법"(53위) · "갱년기 끝나는 나이"(30위) ·
  "갱년기 소변 냄새"(34위). 0에서 시작하는 게 아니다. MENOPAUSE 보드는 140건뿐이라 경쟁 글도 적다.
- **route 수를 줄인다.** 현재 공개 route 33개 → 10개 이내를 목표로 한다.

### M3-2 정정 원칙 (2026-08-20)

M3-2 IA/Product Spec 초안은 방향은 맞지만, 그대로 실행하면 새 브랜드 D-day에
사실 오류와 원칙 불일치가 생긴다. 아래 3개는 문서와 구현 체크리스트에 반드시 반영한다.

| 항목 | 확정 원칙 | 이유 |
|---|---|---|
| **자유게시판 URL** | 고객 URL은 `/community/talk`로 가되, D-day 내부 `BoardType`은 `STORY`를 재사용한다 | Prisma enum에 `TALK`가 없다. `TALK` enum 추가는 migration과 agent/board 분기 검토가 필요해 24시간 오픈에 부적합하다 |
| **갱년기 대표 URL** | 새 브랜드의 검색 대표 URL은 `/community/menopause` 하나로 집중한다 | `/topic/menopause`와 `/community/menopause`를 둘 다 열면 갱년기 대표성이 분산된다 |
| **갱년기 허브 자산** | `src/lib/seo/topic-menopause.ts`의 `MENOPAUSE_SECTIONS`와 `getMenopauseHubSections()`는 버리지 않고 `/community/menopause` 상단 허브로 흡수한다 | 현재 허브 자산은 검색 의도 4축(병원·치료, 감정과 관계, 몸의 변화, 폐경·완경)을 이미 갖고 있다 |
| **봇 댓글 운영** | "30% 이하" 같은 단순 상한이 아니라 정체성·기억·맥락·노출 guard를 핵심 정책으로 둔다 | 창업자 확정 원칙은 활성감이다. 다만 실회원 댓글 KPI는 별도로 분리해 봇 증가를 성장으로 착각하지 않게 한다 |

#### `/community/talk` 구현 메모

새 브랜드는 기존 DB를 이관하지 않는다. 따라서 `STORY`라는 내부 enum 이름이 고객에게 노출되지 않는다면
D-day에는 `STORY`를 자유게시판의 내부 식별자로 재사용하는 것이 가장 빠르고 안전하다.

```
고객 노출: /community/talk · 자유게시판
내부 enum: STORY
주요 변경: board-registry slug/urlPrefix, board display name, 홈/글쓰기/agent 표시명 동기화
금지: D-day에 TALK enum 추가부터 시작하기
```

단, `STORY` 재사용을 "2파일만 바꾸면 끝"으로 오해하면 안 된다. 새 브랜드 신규 repo/DB 기준으로는
migration이 필요 없다는 뜻이고, 실제 제품에서는 홈 섹션, 글쓰기 보드, Sheet 탭명, agent 표시명,
알림/어드민 라벨까지 같은 이름으로 보이는지 최종 체크가 필요하다.

#### 봇 페르소나 정책 메모

현재 자산에는 이미 persona 데이터와 최근 댓글 반복 방지 로직이 있다. 그러나 그것은
"같은 문장 반복 방지"에 가깝고, 새 브랜드에 필요한 것은 **한 명의 실제 회원처럼 보이는 누적 정체성**이다.

D-day 최소 기준:

```
1. 페르소나별 고정 정체성: 나이대, 가족관계, 갱년기 단계, 관심사, 말투
2. 최근 댓글/게시글 기억: 같은 첫 문장·같은 결론·같은 자기소개 반복 금지
3. 갱년기 금지 발화: 의학 단정, 치료 강권, 약품 추천 금지
4. 노출 guard: 같은 화면/같은 글에서 같은 페르소나가 과하게 반복되지 않게 제한
5. 실회원 댓글 KPI 분리: 전체 댓글 수와 실회원 댓글 수를 별도 집계
```

이 정책의 목적은 봇을 숨기는 것이 아니라, 초기 커뮤니티가 비어 보이지 않게 하면서도
50대 여성 사용자가 "사람들이 실제로 이야기하고 있다"고 느끼는 맥락을 만드는 것이다.

#### M3-BOT-1 정정·보강 원칙 (2026-08-20)

Claude의 M3-BOT-1 감사 결과, 봇 자산은 초안에서 본 것보다 훨씬 강하다. 따라서 **전면 폐기/재작성**이 아니라
**자산은 KEEP, 노출 guard·기억·KPI·갱년기 안전 경로는 REWRITE**가 맞다.

확정된 AS-IS:

```
페르소나 원천      agents/seed/persona-data.ts 79명
성별              여성 79명
연령              50대 39명 · 60대 34명 · 45-49세 6명
board 분포         STORY 64 · HUMOR 7 · LIFE2 6 · JOB 2 · MENOPAUSE 0
기억              최근 자기 댓글 3건 + 같은 글 기존 댓글 기반 반복 방지
노출 guard         글당 최대 5개 중심. 사용자 목록 체감 단위 guard는 약함
KPI               일부 대시보드는 실회원 댓글 분리, 일일 KPI는 봇 댓글 포함 경로가 있음
```

중요 정정:

`agents/coo/author-reply-policy.ts`에는 갱년기 의료·성·정신건강 관련 금지 발화/ESCALATE 규칙이 있다.
하지만 이것은 **author reply 경로에 존재하는 안전 자산**이지,
`comment-activator.ts`·`generator.ts` 등 모든 봇 댓글 경로에 자동 적용된다는 뜻이 아니다.
새 브랜드에서는 이 안전 규칙을 **모든 MENOPAUSE 봇 댓글 경로의 공통 guard**로 올려야 한다.

D-day 확정 원칙:

```
1. 첫날 활성 페르소나는 30명으로 확정한다
2. 비중은 50대 19명 · 40대 후반 6명 · 60대 5명으로 확정한다
3. 갱년기 단계는 진행 중 40% · 완경 후 30% · 이전 20% · 미언급 10%로 나눈다
4. 갱년기 보드에도 봇 댓글을 허용한다
5. 글당 봇 댓글은 최대 2개로 시작한다
6. 최근 20개 글 기준 동일 페르소나 노출을 최대 2회로 제한한다
7. 게시 후 10~60분 지연 후 투입한다
8. 실회원 댓글이 붙은 글에는 추가 봇 투입을 멈춘다
9. 페르소나별 일일 노출은 최대 3회로 제한한다
10. 기억 조회는 최소 최근 10건까지 늘리되, DB migration이 필요한 장기 기억 모델은 D+30로 미룬다
11. 전체 댓글 수와 실회원 댓글 수를 반드시 분리 집계한다
```

단, 갱년기 봇 댓글 허용은 **의료·성·정신건강 안전 guard가 모든 MENOPAUSE 봇 댓글 경로에 적용되는 것**을 전제로 한다.
허용 여부는 확정됐지만, 구현 전에 어떤 경로가 MENOPAUSE 댓글을 생성하는지 확인해야 한다.

실회원 KPI는 아래 6개로 분리한다.

```
1. 전체 댓글 수
2. 실회원 댓글 수
3. 실회원 댓글 작성자 수
4. 실회원 재댓글률
5. 봇 댓글 후 실회원 댓글 전환율
6. 글별 첫 실회원 댓글까지 걸린 시간
```

가장 중요한 지표는 **5번, 봇 댓글 후 실회원 댓글 전환율**이다.
봇을 쓰는 유일한 이유는 커뮤니티가 비어 보이지 않게 하면서 실제 사람의 첫 반응을 끌어내는 것이다.
이 지표가 낮으면 봇은 마중물이 아니라 단순 위장 활성이다.

D+30 고도화:

```
PersonaMemory 모델 또는 동등한 저장 구조
사용자별 관계 기억
페르소나 자기 진술 일관성 검증
주제별 반응 이력
멘션/재방문 맥락 인지
```

아직 확정하지 않은 위험:

```
MENOPAUSE 봇 댓글이 실제로 어느 실행 경로에서 생성됐는지
그 경로에 author-reply-policy의 안전 규칙이 적용되는지
persona-data 79명과 DB 봇 계정 83개의 불일치 4명이 무엇인지
curator-personas / persona-matcher / reply-chain 경로가 새 브랜드 D-day에 필요한지
```

따라서 구현 전에 반드시 **MENOPAUSE 봇 댓글 생성 경로 read-only 감사**를 먼저 해야 한다.

#### M3-BOT-2 MENOPAUSE 봇 댓글 생성 경로 감사 (2026-08-20)

감사 결과, MENOPAUSE 봇 댓글 허용은 **조건부 구현 가능**이다. 조건은 단순하다.
`bot-engagement-policy.ts`에 MENOPAUSE를 추가하기 전에, 의료·성·정신건강 안전 guard를 공통화해야 한다.

핵심 발견:

```
bot-engagement-policy.ts    STORY · HUMOR · LIFE2만 허용
author-reply-policy.ts      STORY · LIFE2 · HUMOR · MENOPAUSE 허용 + 갱년기 안전 규칙 보유
guard 없는 경로             connection-facilitator · job-matcher · user-post-wave-processor
```

문제는 "MENOPAUSE가 막혀 있다"가 아니다.
**정책이 두 벌이고, safety guard가 일부 경로에만 있다**는 것이다.

특히 조심할 점:

```
bot-engagement-policy.ts 배열에 MENOPAUSE만 추가하면
현재 이 정책을 쓰는 seed/comment/wave 계열 여러 경로가 동시에 열린다.
그 경로들은 author-reply-policy의 갱년기 의료 safety guard를 자동으로 통과하지 않는다.
```

따라서 D-day 구현 순서는 아래처럼 고정한다.

```
1. author-reply-policy.ts의 갱년기 의료·성·정신건강 금지 정규식/판정 자산을 공용 guard로 분리한다
2. bot-engagement-policy.ts에 "보드 허용 + MENOPAUSE safety 검사"를 함께 수행하는 함수를 둔다
3. bot engagement를 생성하는 모든 경로가 이 함수를 통과하게 한다
4. guard 없는 경로 3개는 D-day에 끄거나 같은 guard에 편입한다
5. 그 다음에만 MENOPAUSE를 허용 목록에 추가한다
```

D-day에 반드시 막아야 할 발화:

```
의학 단정: "그거 갱년기예요", "호르몬 문제예요"
치료/검사 권유: "병원 가보세요", "검사 받아보세요", "치료받으세요"
약품/영양제 추천: "호르몬제", "영양제", "약", "보약" 권유
성/정신건강 민감 발화
불안 조장·공포 조장
```

추가 확인:

`agents/cafe/user-post-wave-processor.ts`는 현재 `post.title`, `post.content`, `post.status`만 조회하고
`boardType`을 보지 않는다. 따라서 이 경로는 MENOPAUSE 글인지 판정하지 못한다.
새 브랜드 D-day에는 이 경로를 그대로 열면 안 된다.

M3-BOT-2 이후 확정된 구현 원칙:

```
MENOPAUSE 봇 댓글 허용 자체는 확정
단, 배열 한 줄 추가 금지
공통 safety guard 선행
guard 없는 경로는 차단 또는 편입
migration 불필요
PersonaMemory는 D+30
```

#### M3-BOT-3 공통 MENOPAUSE safety guard 구현 설계 (2026-08-20)

Claude의 M3-BOT-3 감사 결과, 설계는 확정 가능하다. 이후 BotLog/Post/Comment read-only 대조로
MENOPAUSE 봇 댓글 생성 출처도 추가 확인했다.

중요 정정:

```
이전 판단: seed/scheduler.ts는 guard가 적용되어 있다
정정 판단: seed/scheduler.ts의 runActivity 일부만 보호된다

보호되는 create: seed/scheduler.ts L378 · L408
무방비 create:   seed/scheduler.ts L651 · L973 · L1196
추가 무방비:     cafe/user-post-wave-processor.ts L148
```

#### M3-BOT-3 후속 출처 대조 결과 (2026-08-20)

후속 대조 결과, 앞선 가설 일부는 정정한다.
`processSheetEngagementWaves()`는 실제 출처 중 하나였지만, **기존 guard가 뚫린 것은 아니다.**
과거 MENOPAUSE 봇 댓글 다수는 글이 STORY/LIFE2였을 때 정상 생성된 뒤,
나중에 글이 MENOPAUSE로 이관되면서 "MENOPAUSE 봇 댓글"처럼 보인 것이다.

실측 결론:

```
MENOPAUSE 봇 댓글      487건
비봇 댓글              31건
봇 비율                94.0%
대상 글                98개 / 전체 MENOPAUSE 141개
봇 계정                76개
기간                   2026-04-06 ~ 2026-08-14
마지막 MENOPAUSE 봇 댓글 2026-08-14T04:03Z
글 이관 집중            2026-08-18 ~ 2026-08-20
```

출처 귀속:

| 건수 | 귀속 | 판정 |
|---:|---|---|
| 169 | `SHEET_ENGAGE_COMMENT_PENDING` → `seed/scheduler.ts:973` | 확정 |
| 118 | `SHEET_COMMENT_WAVE_PENDING` + `SHEET_LIKE_WAVE_PENDING` → `seed/scheduler.ts:1196` | 확정 |
| 175 | `WAVE_PROCESS_V2` → `cafe/wave-processor.ts:592` | 확정. 단, 이관 전 정상 생성분 |
| 25 | USER 글 5개 × 정확히 5건 | 확정. `user-post-wave-processor.ts:148` |
| 0 | `KILLER_COMMENT_WAVE_PENDING` → `seed/scheduler.ts:651` | 미도달 확정 |
| 0 | `AUTHOR_REPLY_WRITE` 중 MENOPAUSE | 미관여 확정 |

중요한 운영 해석:

```
1. wave-processor.ts guard는 실제로 작동했다.
2. 2026-08-18~19 MENOPAUSE 대상 CommentWaveQueue 4건은 done 처리 후 댓글 0건이었다.
3. 따라서 "guard가 뚫렸다"가 아니라 "SHEET 계열 scheduler 경로에는 아직 guard가 없다"가 정확한 문제다.
4. scheduler.ts L973/L1196은 현재 MENOPAUSE 입력이 없어 조용할 뿐, D-day에 갱년기 SHEET 발행이 늘면 바로 열린다.
5. Comment에는 생성 경로 필드가 없어, 사후 귀속은 BotLog.details의 postId 대조로만 가능하다.
```

M3-BOT-3b 후속 확정:

```
USER 글 25건의 출처는 user-post-wave-processor.ts로 확정

근거:
- 코드 설계값: wave1 +1분 · wave2 +10분 · wave3 +20분 · wave4 +45분 · wave5 +60분
- 실측 MENOPAUSE USER 글 5개가 모두 5건씩, 위 wave 간격과 일치
- UserPostWaveQueue 소비자는 agents/cafe/user-post-wave-processor.ts
- BotLog action은 USER_POST_WAVE
```

생산자 경로:

| 생산자 | 트리거 | boardType 인지 | MENOPAUSE 적재 | 판단 |
|---|---|---|---|---|
| `src/lib/actions/wave-queue.ts` | 공용 enqueue 함수 | postId/authorId만 받음 | 가능 | 활성 |
| `src/lib/actions/posts.ts` | 회원 글 작성 직후 | `boardType` 변수가 있으나 조건에 안 씀 | 가능 | 주경로 |
| `src/app/api/internal/user-post-wave/route.ts` | 내부 API | body가 postId/authorId뿐 | 가능 | 코드 내 호출부 0, 외부 호출 여부 미확정 |
| `greeting.ts` 호출부 | 신규 가입 환대 글 | 환대 글 보드에 종속 | 가능성 있음 | 환대 글 boardType 별도 확인 필요 |

운영 판단:

```
1. 이 경로는 끄지 않는다. 실회원 글에 봇이 반응하는 유일한 경로라 North Star와 직결된다.
2. 생산자 3곳을 각각 고치지 않는다. 누락과 정책 분산이 생긴다.
3. 소비자 단일 지점인 user-post-wave-processor.ts에서 boardType select + checkBotComment()를 적용한다.
4. MENOPAUSE 글당 최대 2개 정책도 소비자에서 waveNum >= 3 skip으로 처리한다.
5. comment-activator.ts의 MAX_BOT_COMMENTS_PER_POST는 이 경로와 무관하다.
6. USER_POST_WAVE BotLog details에는 D-day에 postId, boardType, skipReason을 기록한다. migration 없이 가능하다.
```

권장 아키텍처:

```
agents/core/bot-engagement-policy.ts   기존 유지. 보드 허용 SSoT
agents/core/menopause-speech-rules.ts  신설. 갱년기 의료·성·정신건강 정규식 SSoT
agents/core/bot-comment-guard.ts       신설. 보드 허용 + 댓글 본문 안전 검사를 묶는 유일한 호출 진입점
```

핵심 원칙:

```
1. 호출부가 직접 부를 함수는 checkBotComment() 하나뿐이다
2. boardType을 모르면 차단한다 (fail-closed, BOARD_TYPE_UNKNOWN)
3. author-reply-policy.ts의 검증된 정규식은 "개선"하지 않고 그대로 이동한다
4. MENOPAUSE 의료·성·정신건강 규칙은 MENOPAUSE 보드에만 적용한다
5. STORY/HUMOR/LIFE2 기존 댓글 동작은 회귀 없이 유지한다
6. action은 D-day에 allow/skip만 쓴다. log_only나 severity 중간 단계는 두지 않는다
7. `BOT_ENGAGEMENT_BOARD_TYPES`에 MENOPAUSE를 추가하는 것은 마지막 단계다
```

제안 함수 계약:

```ts
checkBotComment({
  boardType: string | null | undefined,
  generatedComment: string,
  postTitle?: string,
  sourcePath: string,
  personaId?: string,
}) => {
  ok: boolean,
  action: 'allow' | 'skip' | 'escalate',
  reason:
    | 'BOARD_ENGAGEMENT_DISABLED'
    | 'BOARD_TYPE_UNKNOWN'
    | 'MENOPAUSE_MEDICAL_ADVICE'
    | 'MENOPAUSE_SEXUAL_CONTENT'
    | 'MENOPAUSE_MENTAL_HEALTH_CRISIS'
    | null,
  logDetail: string,
}
```

경로별 D-day 배선 판단:

| 경로 | 판단 | 이유 |
|---|---|---|
| `seed/scheduler.ts` runActivity | 기존 guard를 `checkBotComment()`로 교체 | boardType은 있으나 본문 safety가 없다 |
| `seed/scheduler.ts` L973 · L1196 | boardType select 추가 후 create 직전 guard 필수 | 실제 287건 귀속. 새 브랜드 SHEET 발행 주력 경로라 D-day 최고 위험 |
| `seed/scheduler.ts` L651 | D+30로 강등 | `KILLER_COMMENT_WAVE_PENDING`의 MENOPAUSE 도달 0건 확인 |
| `cafe/user-post-wave-processor.ts` | boardType select 추가 후 guard 필수. MENOPAUSE는 waveNum >= 3 skip | 실회원 글 반응 경로라 끄면 안 된다. USER 글 25건 출처로 확정 |
| `seed/micro-scheduler.ts` | 기존 guard 교체 | 기존 보드 검사는 있으나 본문 safety 없음 |
| `seed/controversy-chain.ts` | 기존 guard 교체 | 기존 보드 검사는 있으나 본문 safety 없음 |
| `coo/comment-activator.ts` | 기존 guard 교체 | 기존 보드 검사는 있으나 본문 safety 없음 |
| `coo/reply-chain-driver.ts` | 기존 guard 교체 | 기존 보드 검사는 있으나 본문 safety 없음 |
| `cafe/wave-processor.ts` | 기존 guard 교체 | 기존 보드 검사는 있으나 본문 safety 없음 |
| `coo/author-reply-driver.ts` | write 직전 공통 guard 편입 | author reply safety와 보드 정책을 두 벌로 두지 않는다 |
| `coo/connection-facilitator.ts` | D-day 현행 유지 | STORY 하드코딩. MENOPAUSE 도달 불가 |
| `coo/job-matcher.ts` | D-day 현행 유지 | JOB/STORY 하드코딩. MENOPAUSE 도달 불가 |

D-day 구현 순서:

```
1. menopause-speech-rules.ts 신설
2. author-reply-policy.ts가 새 공용 rules를 import하게 변경
3. bot-comment-guard.ts 신설
4. 단위 테스트 작성. 이 시점에는 MENOPAUSE가 아직 차단되는 것이 정상
5. seed/scheduler.ts L973 · L1196에 boardType select + guard 배선
6. user-post-wave-processor.ts에 boardType select + guard 배선 + MENOPAUSE waveNum >= 3 skip
7. 나머지 기존 guard 경로를 checkBotComment()로 교체
8. author-reply-policy.ts의 별도 보드 허용 정책을 공용 guard로 수렴
9. npx tsc --noEmit 및 npx tsc -p tsconfig.ops.json --noEmit
10. 그 다음에만 BOT_ENGAGEMENT_BOARD_TYPES에 MENOPAUSE 추가
11. dry-run으로 BOARD_TYPE_UNKNOWN 0건, MENOPAUSE_* skip 발생 여부 확인
12. 첫 세트 30명과 글당 최대 2개 정책 적용
```

주의: `cafe/wave-processor.ts`는 기존 배선이 실전에서 skip을 증명했다.
새 guard도 이 패턴을 유지해야 한다. 단순 `continue`로 빠지면 큐가 영원히 재시도될 수 있다.

주의: `user-post-wave-processor.ts`도 skip 시 큐가 계속 재시도되지 않도록 wave 처리 상태와 로그를 함께 설계해야 한다.

테스트/재발 방지:

```
src/__tests__/bot-comment-guard.test.ts
  - MENOPAUSE 의료 단정, 약/영양제 추천, 병원/검사 권유, 성, 정신건강 위기 차단
  - 순수 공감/감정 반응 허용
  - STORY/HUMOR/LIFE2 기존 동작 보존
  - null/undefined/빈 boardType fail-closed

src/__tests__/menopause-speech-rules-parity.test.ts
  - author-reply-policy.ts의 기존 safety 판정과 공용 rules 판정 동등성 고정

scripts/check-bot-comment-guard.ts
  - agents/**의 prisma.comment.create를 찾아 같은 함수 스코프에 checkBotComment가 없으면 실패
```

창업자 확정:

```
MENOPAUSE 실회원 글에 대한 user-post-wave 댓글 수는 D-day에도 글당 최대 2개로 간다.

이 결정의 목적은 갱년기 보드를 비어 보이지 않게 만드는 것이다.
단, AI 티를 줄이기 위해 2개 허용은 아래 조건을 전제로 한다.

1. 공통 checkBotComment() safety guard 선행
2. 의료·성·정신건강 위험 발화 차단
3. 같은 글에 같은 톤/같은 결론 반복 금지
4. 실회원 댓글이 붙으면 추가 봇 중단
5. 최근 20글 기준 동일 페르소나 노출 최대 2회
```

지금 하면 안 되는 것:

```
BOT_ENGAGEMENT_BOARD_TYPES에 MENOPAUSE만 추가
댓글 생성 경로 일부만 수정
boardType 없이 user-post-wave-processor 유지
guard 없이 페르소나 30명 확장
DB migration부터 시작
author-reply-policy.ts의 정규식 수정
author-reply-policy.test.ts 수정
connection-facilitator/job-matcher 겸사겸사 수정
AUTHOR_REPLY_MODE write 전환
```

#### M3-BOT-4 첫 세트 30명 페르소나 설계 (2026-08-20)

Claude의 read-only 감사 결과, **신규 페르소나 대량 창작은 불필요**하다.
`agents/seed/persona-data.ts`에 이미 깊은 필드를 가진 여성 페르소나 79명이 있고,
새 브랜드 첫날에 필요한 30명 중 29명은 기존 자산으로 즉시 선별 가능하다.

자산 판정:

```
전체 79명
남성 0명
45세 미만 0명
70세 이상 0명

45~49세    6명   목표 7명 대비 1명 부족
50~59세   39명   목표 18명 대비 충분
60~69세   34명   목표 5명 대비 충분
```

사용 자산 기준:

| 자산 | 규모 | 판단 |
|---|---:|---|
| `persona-data.ts` | 79명 | 1차 선별 대상. nickname, age, gender, personality, style, topics, speech_patterns, mood, quirks, never, examples 보유 |
| `curator-personas.ts` | 225명 | 보조 자산. 나이·가족·never가 없어 첫 30명 핵심 세트로는 부적합 |
| `curator-persona-meta.ts` | 40명 override | 보조 |
| `persona-registry.ts` | 304명 통합 | 소비 경로. bot/curator 네임스페이스 혼동 주의 |

주의: bot `E`와 curator `E`는 같은 사람이 아니다. 첫 30명 선별은 **bot 네임스페이스만** 사용한다.

이미 갱년기 배정이 끝난 깊은 bot 8명:

```
X  걱정인형
AM 불안한밤
AH 피곤해요
BF 속터지는현실
AJ 가족곁에서
H  매일걷기
AN 약국단골
AL 헬스덕후
```

단, `AN 약국단골`과 `AL 헬스덕후`는 D-day MENOPAUSE 배정에서 빼는 것이 맞다.
`AN`은 제품·영양제·가격 비교 톤이라 의료 guard와 충돌하고,
`AL`은 운동 권유 톤이라 갱년기 피로 글에서 사용자 경험을 해칠 위험이 크다.

첫 30명 운영 권고:

```
창업자 확정안:
50대 19명 · 40대 후반 6명 · 60대 5명

이유:
- 40대 후반 기존 자산이 6명뿐이라 목표 7명 충족을 위해 새 창작이 필요하다.
- D-day 목적은 완벽한 인구 비율이 아니라 24시간 안에 검증된 자산으로 여는 것이다.
- 핵심 타겟 1순위가 50대 여성이므로 50대 1명 증가는 제품 방향과도 맞다.
```

50대 핵심 후보:

| ID | 닉네임 | 나이 | 역할 |
|---|---|---:|---|
| AH | 피곤해요 | 55 | 피로·수면 하소연 |
| BF | 속터지는현실 | 57 | 감정 기복·가족 현실 |
| AJ | 가족곁에서 | 57 | 간병·가족 관계 |
| E | 미숙이맘 | 52 | 경험 공감 |
| AE | 새벽감성 | 52 | 불면·정서 동조 |
| AK | 엄마뭐해요 | 54 | 딸·가족 관계 |
| P | 오후햇살 | 55 | 잔잔한 정서 공감 |
| AQ | 조용한수다 | 59 | 짧은 지지 |
| Z | 혼자잘산다 | 54 | 혼자 사는 현실·자조 유머 |
| AV | 혼밥일기 | 56 | 생활형 공감 |
| K | 예쁘게살자 | 56 | 자기관리·전환 |
| BC | 억울한아내 | 59 | 부부 하소연 |
| AG | 비교분석왕 | 57 | 비의료 정보 정리 |
| BN | 위로천사 | 56 | 위로 |
| BK | 공감백퍼 | 52 | 짧은 즉각 공감 |
| BR | 응원언니 | 51 | 응원 |
| BQ | 조심스런댁 | 59 | 신중한 동조 |
| BW | 감성파 | 58 | 감성 반응 |
| 보강 1명 | 50대 기존 후보 중 추가 선별 | 50대 | 40대 후반 결손 보완 |

40대 후반 후보:

| ID | 닉네임 | 나이 | 역할 |
|---|---|---:|---|
| O | 올드팝 | 48 | 전조·취향 공유 |
| W | 참나진짜 | 48 | 직설 반응 |
| Y | 솔직히말해서 | 49 | 솔직한 동조 |
| AB | 따져보자 | 49 | 비의료 팩트체크 |
| AZ | 돈공부중 | 47 | 돈·현실 이야기 |
| BA | 은퇴준비중 | 48 | 노후·가족 불안 |

60대 후보:

| ID | 닉네임 | 나이 | 역할 |
|---|---|---:|---|
| X | 걱정인형 | 62 | 완경 후 불안 |
| AM | 불안한밤 | 62 | 불면·몸 변화 |
| BT | 나도그랬어 | 60 | 경험 기반 공감 |
| BU | 느린공감 | 63 | 느린 호흡의 정서 지지 |
| AC | 느긋이 | 63 | 가족 관계·생활형 공감 |

말투 분산 원칙:

```
1. 불안·질문형: X, AM, AE, BQ
2. 하소연·동반형: AH, BF, BC, AJ, Z
3. 위로·응원형: E, BN, BK, BR, BT, BU
4. 정리·전환형: AG, K, AV, AB, AC

MENOPAUSE 실회원 글에는 서로 다른 계열에서 최대 2명만 붙인다.
권장 조합은 위로·응원형 1명 + 불안·질문형 또는 하소연·동반형 1명이다.
정리·전환형 2명이 동시에 붙으면 조언처럼 보여 금지한다.
```

D-day 보강 필드 설계:

```
menopauseStage?: 'pre' | 'early' | 'active' | 'post' | 'none'
family?: { spouse: boolean; children?: string; inLaws?: boolean; grandchildren?: boolean }
commentLength?: 'short' | 'medium' | 'long'
memoryAnchors?: string[]
```

이 필드들은 모두 선택 필드로 추가해야 한다. DB migration은 하지 않는다.
D-day에는 실제 장기 기억 모델이 아니라 `memoryAnchors` 상수로 "그 사람다움"을 먼저 만든다.
`PersonaMemory` 같은 실제 이력 기반 기억은 D+30 이후 과제다.

M3-BOT-4 구현 전제:

```
1. M3-BOT-3의 common safety guard가 먼저 들어가야 한다.
2. scheduler.ts L973/L1196과 user-post-wave-processor.ts가 guard에 편입되어야 한다.
3. 그 다음에만 첫 30명 MENOPAUSE 배정과 봇 댓글 허용을 켠다.
4. guard 없이 30명을 투입하면 위험 노출량만 커진다.
```

지금 하면 안 되는 것:

```
페르소나 30명을 새로 창작
curator 225명에서 첫 30명 선별
bot/curator 같은 ID를 같은 인물로 취급
AN 약국단골·AL 헬스덕후를 MENOPAUSE에 유지
Persona 필드를 필수값으로 추가
PersonaMemory migration부터 시작
guard 없이 MENOPAUSE 봇 허용
```

---

#### M3-BOT-5 봇 노출 guard 설계 (2026-08-20)

> **판정: PARTIAL — D-day 구현 가능.** 6개 guard 중 4개는 이미 구현돼 있고 값만 다르다.
> 진짜 신규는 `screen_exposure`·`human_present` 2개뿐이다.
>
> M3-BOT-3이 **안전**(의료·성·정신건강 발화)을 다뤘다면, M3-BOT-5는 **노출·반복·타이밍**을 다룬다.
> 둘은 역할이 다르며 서로를 대체하지 않는다.

##### 문제 정의 — "봇이 많다"가 문제가 아니다

창업자 확정대로 **전체 봇 댓글 비율 상한은 두지 않는다.** 진짜 문제는 4가지다.

| # | 문제 | 증상 | 현재 상태 |
|---|---|---|---|
| 1 | **밀도(density)** | 한 글에 10~12개가 몰려 "이 글만 이상하게 활발"해진다 | 🟡 상한은 있으나 값이 크다 |
| 2 | **편재(ubiquity)** | 목록 한 화면에 같은 닉네임이 3~4번 보인다 | 🔴 **완전 무방비** |
| 3 | **규칙성(regularity)** | 모든 글이 `+5/+14/+24/+49/+60분` 동일 리듬 | 🔴 고정값 |
| 4 | **실회원 무시(disregard)** | 사람이 댓글을 달았는데 봇이 자기 스케줄대로 계속 붙는다 | 🔴 **완전 무방비** |

⚠️ **문제 2와 4가 "AI 운영처럼 보인다"의 핵심이다.** 1·3은 값 조정으로 풀리지만 2·4는 신규 구현이 필요하다.

##### 기존 구현 중 재사용 가능한 자산 (실측)

새로 만들 필요가 없는 것들이다. 이미 검증되어 운영 중이다.

| 자산 | 위치 | 현재 값 | D-day 조치 |
|---|---|---|---|
| KST 날짜 경계 | `wave-processor.ts:105` `startOfKstDay()` | ✅ UTC 아님 | 그대로 재사용 |
| 페르소나 일일 cap | `wave-processor.ts:99` `BOT_DAILY_COMMENT_CAP` | **20** | **값만 3으로** |
| 일일 집계 방식 | `wave-processor.ts:539` `Comment.groupBy` | ✅ | 그대로 |
| 같은 페르소나 중복 금지 | `user-post-wave-processor.ts:105-136` | ✅ | 그대로 |
| 표현·내용 중복 방지 | `user-post-wave:114` · `wave-processor:560` | ✅ | 그대로 |
| skip 사유 기록 | `wave-processor.ts:645` `skippedReasons[]` | ✅ | 확장 |
| **영구 skip 방지 패턴** | `wave-processor.ts:621-629` | ✅ `bot_cap`은 20분 뒤 재시도, `expiresAt` 넘으면 중단 | **이 패턴을 표준으로 삼는다** |
| **실회원 판정 SSoT** | `notify-author.ts:4` `isRealUser()` | ✅ `providerId` 순수 숫자 | 그대로 재사용 |
| 시작 시각 jitter | `comment-activator.ts:26` 0~3분 랜덤 | ✅ | 참고 |

⚠️ **실회원 판정에 `@unao.bot` 이메일을 쓰면 안 된다.** `isRealUser(providerId)`가 SSoT이며, 이메일 기준은 게스트 댓글을 놓친다.

##### 신규로 필요한 guard 2개

```
G5 screen_exposure   최근 20개 글 기준 동일 페르소나 최대 2회
                     → 현재 이런 조회 자체가 코드에 없다. 문제 2의 유일한 해법
G7 human_present     사람 댓글이 있으면 추가 봇 wave 중단
                     → 현재 existingComments를 조회하지만 "중복 회피"용이지 중단 판단이 아니다
```

##### 최종 guard 정책표

| # | guard | 목적 | 데이터 | skip 조건 | BotLog reason | retryable | D-day |
|---|---|---|---|---|---|---|---|
| G1 | `post_cap` | 글당 봇 댓글 2개 | `Comment.count(postId, bot)` | 봇댓글 ≥2 | `post_cap_reached` | ❌ | 필수 |
| G2 | `persona_dup` | 같은 페르소나 재등장 금지 | 기존 댓글 authorId | 이미 등장 | `persona_already_on_post` | ❌ | 재사용 |
| G3 | `tone_family_dup` | 같은 톤 계열 2명 금지 | personaId → 계열 | 동일 계열 존재 | `tone_family_conflict` | ❌ | 필수 |
| G4 | `advice_tone_solo` | 정리/조언형 2명 금지 | 계열④ 카운트 | ④ 이미 1명 | `advice_tone_limit` | ❌ | 필수 |
| G5 | `screen_exposure` | 최근 20글 중 최대 2회 | 최근 20 post의 봇댓글 authorId | 해당 페르소나 ≥2 | `screen_exposure_cap` | ✅ | **신규** |
| G6 | `persona_day_cap` | 페르소나 하루 3회 | `Comment.groupBy` + KST | ≥3 | `persona_daily_cap` | ✅ | 값만 20→3 |
| G7 | `human_present` | 사람 댓글 시 중단 | `providerId` · `guestNickname` | 사람 댓글 ≥1 | `human_comment_present` | ❌ | **신규** |
| G8 | `delay_jitter` | 10~60분 + 흔들기 | postId 해시 | — | — | — | 필수 |

**권장 조합(G3·G4 통과 기준)**: 위로/응원형 1명 + 불안·질문형 **또는** 하소연·동반형 1명.
정리/조언형 2명이 동시에 붙으면 조언처럼 읽혀 커뮤니티 톤이 무너진다.

##### 창업자 확정 사항 (2026-08-20)

**① 게스트 댓글도 사람 댓글로 본다** ✅

```
사람 댓글 판정 =
  ( author.providerId가 순수 숫자  OR  guestNickname != null )
  AND status = 'ACTIVE'

→ 사람이 말을 걸었으면 봇은 물러난다. 이후 wave 전체 중단.
→ 봇 댓글 뒤에 사람 댓글이 붙은 경우에도 그 시점부터 중단한다.
```

**② strict exposure guard는 MENOPAUSE부터 적용한다** ✅

```
구현    공통 함수 checkBotExposure() 하나로 설계한다 (경로별 제각각 금지)
첫 적용 M3 MENOPAUSE 보드에만
기존 보드 STORY/HUMOR/LIFE2는 현행 유지 — D+30 또는 운영 안정 후 확대 검토

이유: 네이버 색인 0 상황에서 기존 서비스 활성감까지 흔들면 변수가 겹친다.
      기존 보드 globalCap 10~20을 2로 낮추면 댓글 수가 급감한다.
```

**③ author-reply는 글당 2개 제한과 별도 집계한다** ✅

```
포함 안 함  글쓴이가 자기 글 댓글에 답하는 것은 대화의 자연스러운 일부다
            (AUTHOR_REPLY_WRITE 60건 가동 중, 2026-07-22~08-19)
통과 필수    safety guard(checkBotComment) + exposure guard(checkBotExposure) 둘 다
skip 조건    대화를 방해하거나 반복 노출되면 skip한다
            → G5(screen_exposure) · G6(persona_day_cap)은 author-reply에도 적용
            → G1(post_cap)만 별도 집계 대상
```

##### 코드 적용 지점

```
agents/core/
  bot-comment-guard.ts     M3-BOT-3에서 신설
    checkBotComment()        보드 + 의료 발화   [safety · 순수 함수 · DB 불필요]
    checkBotExposure()       ★ M3-BOT-5 추가    [exposure · DB 조회 필요]
  tone-family.ts           ★ 신설 — 30명을 4계열로 매핑하는 순수 상수
```

⚠️ **두 함수를 한 파일에 두되 분리한다.** safety는 순수 함수라 단위 테스트가 가볍고,
exposure는 DB 의존이다. 합치면 safety 테스트에 DB mock이 필요해진다.
같은 파일에 두는 이유는 호출부가 하나만 부르고 나머지를 빠뜨리는 사고를 막기 위해서다.

**`retryable` 구분이 핵심이다.** 기존 `bot_cap` 재시도 패턴(`wave-processor.ts:621-629`)을 따른다.

```
retryable=true   persona_daily_cap · screen_exposure_cap  → 큐 waveAt 20분 미룸
retryable=false  post_cap · human_present · tone_conflict  → 큐 done 마킹
                 (단순 continue는 큐가 영원히 재시도된다)
```

**migration 불필요.** 전부 상수·함수·조회이며 스키마 무변경이다.
`wave3At`·`wave4At`은 필수 필드라 값은 넣되 **소비 단계에서 skip**한다(M3-BOT-3b 결론과 동일).

⚠️ **현재 `wave1At = +1분`은 확정 정책(10~60분 지연)과 정면 충돌한다.**
실측에서도 첫 댓글이 4~5분 만에 달렸다. `src/lib/actions/wave-queue.ts:11`에서 조정해야 한다.

##### D-day 구현 순서 (M3-BOT-3과 통합)

```
[안전이 먼저 — M3-BOT-3 1~9단계 완료가 절대 선행]
 1~9   menopause-speech-rules · bot-comment-guard(safety) · scheduler L973/L1196 배선
       user-post-wave 배선 · 나머지 8경로 guard 교체 · ELIGIBLE_BOARDS 수렴 · tsc

[M3-BOT-5 시작]
 10   tone-family.ts 신설 — 30명을 4계열로 매핑 (순수 상수)
 11   checkBotExposure() 신설 — G1~G7. 이 시점엔 호출부 없음
 12   단위 테스트 — 호출 전에 로직부터 고정
 13   wave-processor에 배선 ← 자산이 가장 많고 skip/retry 패턴이 이미 있어 회귀가 적다
      · BOT_DAILY_COMMENT_CAP 20 → 3
      · getGlobalCap에 MENOPAUSE=2
 14   user-post-wave-processor 배선 + MENOPAUSE wave3~5 skip
 15   comment-activator 배선 (MAX_BOT_COMMENTS_PER_POST 폐기)
 16   scheduler 3경로 · micro-scheduler · controversy-chain · reply-chain · author-reply 배선
 17   wave-queue.ts jitter (G8) — 생산 시점 변경이라 마지막
 18   dry-run 관찰
 19   ★ MENOPAUSE 배열 추가 ★   ← M3-BOT-3의 10단계가 여기로 밀린다
 20   페르소나 30명 활성화
```

⚠️ **M3-BOT-3에서 "10번째"였던 배열 추가가 19번째로 밀린다.**
노출 guard 없이 MENOPAUSE를 열면 글당 10개가 붙어 첫인상이 무너진다.

**13번(wave-processor)을 먼저 하는 이유**: `skips[]`·retry·KST cap·BotLog details가 전부 이미 있다.
여기서 패턴을 확정한 뒤 나머지에 복제하면 설계 오류가 한 번만 발생한다.
**17번(jitter)을 마지막에 두는 이유**: 생산 시점을 바꾸면 기존 큐와 신규 큐가 섞여 관찰이 어렵다.

##### 테스트·재발 방지

```
단위    src/__tests__/bot-exposure-guard.test.ts (신설)
        G1~G7 각각 · KST 날짜 경계(오늘 3건 skip / 어제 3건 allow)
        fail-closed: boardType null → skip / post not found → skip(terminal)
                     댓글 조회 throw → skip(retryable)
        회귀: STORY/HUMOR/LIFE2 기존 동작 보존

정적    scripts/check-bot-comment-guard.ts (신설, CI 등록)
        agents/**의 prisma.comment.create를 전부 찾아
        같은 스코프에 checkBotComment + checkBotExposure 둘 다 있는지 확인
        → "새 경로 추가하고 guard 빠뜨리는" 구조적 재발을 막는다

dry-run PASS 조건
        BOARD_TYPE_UNKNOWN 0건 · post_cap_reached 1건 이상
        human_comment_present 관측 · 기존 보드 댓글 수 전일 ±10%

로그    BotLog.details에 { postId, boardType, personaId, toneFamily, skipReason, retryable }
        ⚠️ 현재 USER_POST_WAVE 로그는 {processed, failed}만 남겨 사후 추적이 불가능하다
```

##### 하면 안 되는 것

```
MAX_BOT_COMMENTS_PER_POST만 5→2로 낮추기   comment-activator 전용. 나머지 2벌이 남는다
MENOPAUSE 배열만 추가                       노출 guard 없이 열면 글당 10개가 붙는다 (19단계)
producer마다 제각각 제한 넣기               이미 3벌(5/10~20/5)이고 그게 문제의 원인이다
BotLog 없이 skip                            M3-BOT-3b 출처 확정이 어려웠던 직접 원인
실회원 감지 없이 wave 유지                  문제 4. AI 운영처럼 보이는 가장 직접적 원인
@unao.bot 이메일로 실회원 판정              isRealUser(providerId)가 SSoT. 게스트를 놓친다
BOT_DAILY_COMMENT_CAP 20 유지               확정값은 3이다
wave1At = +1분 유지                         확정값은 10~60분이다
safety와 exposure를 한 함수로 합치기        safety 단위 테스트가 무거워진다
screen_exposure를 terminal skip으로 처리    시간이 지나면 해소된다. retryable=true여야 한다
기존 보드에 strict guard 동시 적용           창업자 확정: MENOPAUSE 우선, 기존 보드는 D+30
migration부터 시작                          D-day 항목은 전부 migration 불필요
```

##### M3-BOT-6으로 넘길 구현 체크리스트 (초안)

```
[ ] 1. tone-family.ts — M3-BOT-4의 30명 → 4계열 매핑 확정
       ⚠️ 계열 매핑은 Claude 설계안이며 Codex Master 검증 미완
[ ] 2. checkBotExposure() 시그니처 확정 (retryable 포함)
[ ] 3. bot-exposure-guard.test.ts 케이스 작성
[ ] 4. wave-processor 배선 + cap 20→3 + MENOPAUSE globalCap=2
[ ] 5. user-post-wave-processor 배선 + wave3~5 skip
[ ] 6. comment-activator 배선 + MAX_BOT_COMMENTS_PER_POST 폐기
[ ] 7. scheduler 3경로 + 나머지 4경로 배선
[ ] 8. author-reply 별도 집계 분기 (G1 제외 / G5·G6 적용)
[ ] 9. wave-queue.ts jitter
[ ] 10. check-bot-comment-guard.ts + CI 등록
[ ] 11. BotLog details 확장
[ ] 12. dry-run 관찰 → 배열 추가 → 페르소나 30명
```

##### 아직 미확정 (추정하지 않음)

| 항목 | 왜 미확정인가 | 확인 방법 |
|---|---|---|
| ~~tone family 4계열 매핑~~ | ✅ **M3-BOT-7에서 확정 (2026-08-20)** — 30명 전수 대조 완료. `BF`는 ①→② 정정, `AG`·`W`·`Y`·`AB`는 MENOPAUSE 금지 | 해소됨 |
| ~~"최근 20개 글"의 범위~~ | ✅ **M3-BOT-6에서 확정 — MENOPAUSE 보드 기준 20개** | 해소됨 |
| `screen_exposure` 조회 비용 | 매 create마다 최근 20글 조회 시 부하 미실측 | 13단계에서 EXPLAIN |
| ~~MENOPAUSE wave3~5 skip 시 큐 처리~~ | ✅ **M3-BOT-6에서 확정 — done 마킹** (§큐 처리 정책) | 해소됨 |
| ~~기존 globalCap 10~20의 근거~~ | ✅ **M3-BOT-6에서 실측 — `constitution.yaml:351` `bot_comment_cap_per_post: 5`(2026-05-12 창업자 승인). wave/tier cap 조항은 없으며, 코드가 헌법값을 초과해 독자 운영 중이다.** D-day에는 건드리지 않는다(D+30 과제) | 해소됨 |

---

#### M3-BOT-6 D-day 봇 구현 체크리스트 (2026-08-20)

> **판정: PARTIAL — D-day 구현 가능.**
> **한 줄 결론: 신규 파일 7개 + 기존 파일 13개 수정으로 24시간 내 구현 가능하며(예상 20h),
> `MENOPAUSE` 배열 추가는 22단계 중 20번째다.**
>
> 이 절은 M3-BOT-3(safety) · M3-BOT-4(페르소나) · M3-BOT-5(exposure)를 하나의 실행 순서표로 통합한 것이다.
> 앞선 절들과 충돌하는 내용은 없으며, 단계 번호만 통합 기준으로 재부여했다.

##### 🔴 Blocker 1건 — 3개 경로가 BotLog를 남기지 않는다

```
botLog 기록 실태 (2026-08-20 실측)
  scheduler.ts              create 0 · update 6      ✅ 기존 wave row를 update
  micro-scheduler.ts        create 1                 ✅
  wave-processor.ts         create 3                 ✅
  user-post-wave.ts         create 1                 🟡 {processed,failed}만 — postId 없음
  author-reply-driver.ts    create 5                 ✅
  ────────────────────────────────────────────────
  comment-activator.ts      create 0 · update 0      🔴 기록 없음
  reply-chain-driver.ts     create 0 · update 0      🔴 기록 없음
  controversy-chain.ts      create 0 (findMany만)    🔴 기록 없음
```

이 3개 경로는 **guard가 skip해도 그 사실이 어디에도 남지 않는다.** dry-run 관찰이 불가능해지고,
M3-BOT-3b에서 468건 출처 확정에 애먹은 상황이 그대로 재현된다.

⚠️ **blocker이지 중단 사유는 아니다.** 구현 순서 15단계에 BotLog 배선을 넣으면 해소된다.

⚠️ `comment-activator`·`reply-chain-driver`는 action 상수(`COMMENT_ACTIVATE`·`REPLY_CHAIN_DRIVE`)가
코드에 이미 있으나 `botLog.create` 호출이 0건이다. **상수만 있고 기록은 안 하는 상태**다.

##### 창업자 확정 사항 (2026-08-20)

**① `screen_exposure`의 "최근 20개 글" = MENOPAUSE 보드 기준 20개** ✅

```
고객이 실제로 보는 목록 화면이 보드별이기 때문이다.
D-day에 strict exposure guard를 MENOPAUSE에만 적용하므로 전체 보드 기준은 의미가 흐려진다.
→ G5 조회 조건: Post.boardType='MENOPAUSE' ORDER BY createdAt DESC LIMIT 20
```

**② constitution 불일치는 D-day에 건드리지 않는다** ✅

```
발견   constitution.yaml:351  bot_comment_cap_per_post: 5  (2026-05-12 창업자 승인)
       wave-processor.ts:112  globalCap  KILLER 20 / HOT 14 / NORMAL 10
       → constitution에 wave·tier cap 조항은 없다(grep 0건). 코드가 헌법값을 초과해 독자 운영 중.

결정   D-day에는 손대지 않는다.
       MENOPAUSE=2는 헌법값 5보다 낮으므로 충돌하지 않는다.
       기존 보드 cap 정리는 D+30 별도 과제로 남긴다.
       (확정 13번 "기존 보드를 과도하게 흔들지 않는다"와 정합)
```

##### AS-IS 실행 경로 지도

| # | 경로 | DB write | MENOPAUSE 도달 | 현재 guard | BotLog | 실제 생성 이력 |
|---|---|---|---|---|---|---|
| 1 | `scheduler.ts` `runActivity` | :378 :408 | ❌ 차단 | ✅ (:331) | ✅ update | — |
| 2 | `scheduler.ts` `processPendingKillerCommentWaves` | :651 | ⚪ 미도달 | 🔴 없음 | ✅ update | 0건 (KILLER 15건 중 0) |
| 3 | **`scheduler.ts` `processSheetEngagementWaves`** | :973 | 🔴 **가능** | 🔴 **없음** | ✅ update | **169건 확정** |
| 4 | **`scheduler.ts` `processPendingSheetCommentWaves`** | :1196 | 🔴 **가능** | 🔴 **없음** | ✅ update | **118건 확정** |
| 5 | `micro-scheduler.ts` | :204 :232 | ❌ 차단 | ✅ (:174) | ✅ create | — |
| 6 | `controversy-chain.ts` | :211 :250 | ❌ 차단 | ✅ (:160) | 🔴 **없음** | — |
| 7 | `comment-activator.ts` | :115 | ❌ 차단 | ✅ (:47 where + :70) | 🔴 **없음** | — |
| 8 | `reply-chain-driver.ts` | :125 | ❌ 차단 | ✅ (:110) | 🔴 **없음** | — |
| 9 | `wave-processor.ts` ×4 | :173 :324 :431 :592 | ✅ **차단 실증 4/4** | ✅ (:762 :853) | ✅ create ×3 | 175건(보드 이관 전) |
| 10 | **`user-post-wave-processor.ts`** | :148 | 🔴 **boardType 미조회(:87)** | 🔴 **없음** | 🟡 postId 없음 | **25건 확정** |
| 11 | `author-reply-driver.ts` | :89 | ✅ 가능 | 🟡 자체 `ELIGIBLE_BOARDS` (정책 두 벌) | ✅ create ×5 | MENOPAUSE 0건 |
| 12 | `connection-facilitator.ts` | :72 | ⚪ `'STORY'` 고정 | — | — | D-day 제외 |
| 13 | `job-matcher.ts` | :146 | ⚪ JOB/STORY 고정 | — | — | D-day 제외 |

**D-day 위험 순위**

```
🔴 1위  scheduler.ts L973 · L1196   287건 확정 · guard 전무 · boardType 조회조차 없음
🔴 2위  user-post-wave L148          25건 확정 · select에 boardType 없음 · 실회원 글 대상
🟡 3위  author-reply L89             MENOPAUSE 도달 가능 · 정책이 두 벌
🟢 4위  wave-processor               차단 실증 완료 · 본문 검사만 추가하면 됨
⚪ 제외 connection-facilitator · job-matcher · KILLER 경로  도달 불가 확정
```

##### D-day 구현 순서 22단계

**Phase A — 순수 모듈 (1~5) · 예상 3h · 위험 최저**

| # | 목적 | 파일 | 선행 | 검증 | 중단 기준 |
|---|---|---|---|---|---|
| 1 | 브랜치 생성 | — | — | `git switch -c feat/m3-bot-guard origin/main` | 로컬 `main` checkout 시도 시 중단(worktree 점유) |
| 2 | 의료 정규식 분리 | **신규** `agents/core/menopause-speech-rules.ts` | 1 | 정규식을 **한 글자도 바꾸지 않고 이동** | 정규식 수정 발견 시 되돌림 |
| 3 | policy가 2번을 import | `agents/coo/author-reply-policy.ts` | 2 | **기존 `author-reply-policy.test.ts` 그대로 통과** | 이 테스트 실패 = 회귀. 즉시 중단 |
| 4 | 동등성 테스트 | **신규** `src/__tests__/menopause-speech-rules-parity.test.ts` | 3 | 기존 판정과 100% 동일 | 1건이라도 다르면 중단 |
| 5 | 톤 계열 매핑 | **신규** `agents/core/tone-family.ts` | 1 | 30명 전원이 4계열 중 하나 | 미분류 1명이라도 있으면 중단 |

**Phase B — guard 함수 (6~9) · 예상 4h · 위험 낮음**

| # | 목적 | 파일 | 선행 | 검증 | 중단 기준 |
|---|---|---|---|---|---|
| 6 | safety guard | **신규** `agents/core/bot-comment-guard.ts` `checkBotComment()` | 4 | 순수 함수(DB 의존 0) | DB import 발견 시 설계 오류 |
| 7 | exposure guard | 위 파일 `checkBotExposure()` | 5,6 | `retryable` 필드 포함 | — |
| 8 | safety 단위 테스트 | **신규** `src/__tests__/bot-comment-guard.test.ts` | 6 | 의료 5종 차단 · 일반 공감 허용 · fail-closed | 실패 시 배선 진입 금지 |
| 9 | exposure 단위 테스트 | **신규** `src/__tests__/bot-exposure-guard.test.ts` | 7 | G1~G7 · KST 경계 · retryable 구분 | 동일 |

⚠️ **8·9가 통과하기 전에는 어떤 호출부도 건드리지 않는다.** 이 시점엔 MENOPAUSE가 아직 배열에 없으므로
"MENOPAUSE는 차단된다"가 **정상 통과**여야 한다.

**Phase C — 배선 (10~17) · 예상 8h · 위험 중간**

| # | 목적 | 파일 | 선행 | 검증 | 중단 기준 |
|---|---|---|---|---|---|
| 10 | **기준 경로 배선** | `agents/cafe/wave-processor.ts` | 9 | `skips[]`·retry·KST cap 재사용 | 기존 STORY 동작 변화 시 중단 |
| 11 | cap 조정 | 위 파일 `BOT_DAILY_COMMENT_CAP` 20→3 · `getGlobalCap` MENOPAUSE=2 | 10 | tsc | — |
| 12 | 🔴 **최고 위험** | `agents/seed/scheduler.ts` L973·L1196 | 10 | post 조회에 `boardType: true` 추가 → guard | boardType select 누락 시 중단 |
| 13 | 🔴 **실회원 경로** | `agents/cafe/user-post-wave-processor.ts` :87 select + :148 guard | 10 | `boardType` 확보 확인 | 동일 |
| 14 | wave 축소 | 위 파일 — MENOPAUSE는 wave3~5 skip | 13 | 글당 2개 확인 | — |
| 15 | 🔴 **blocker 해소** | `comment-activator.ts` · `reply-chain-driver.ts` · `controversy-chain.ts` | 10 | **BotLog 기록 신설** + guard 배선 | BotLog 없이 guard만 넣으면 중단 |
| 16 | 나머지 배선 | `micro-scheduler.ts` · `author-reply-driver.ts` | 10 | author-reply는 G1 제외 / G5·G6 적용 | — |
| 17 | 정책 수렴 | `author-reply-policy.ts` `ELIGIBLE_BOARDS`에서 MENOPAUSE 제거 | 16 | 보드 판정이 guard 한 곳으로 | 두 벌 정책 잔존 시 중단 |

**Phase D — 생산·검증 (18~22) · 예상 5h**

| # | 목적 | 파일 | 선행 | 검증 | 중단 기준 |
|---|---|---|---|---|---|
| 18 | 지연 jitter | `src/lib/actions/wave-queue.ts:11` `+1분` → **10~60분** | 17 | postId 해시 기반 결정적 jitter | 고정값 잔존 시 중단 |
| 19 | 정적 가드 | **신규** `scripts/check-bot-comment-guard.ts` + CI 등록 | 17 | `comment.create` 전량이 guard 2개 통과 | **exit 1이면 20단계 진입 금지** |
| 20 | ★ **`MENOPAUSE` 배열 추가** ★ | `agents/core/bot-engagement-policy.ts:12` | **1~19 전부** | tsc + ops tsc + 19번 exit 0 | 19번 실패 시 절대 진행 금지 |
| 21 | 페르소나 30명 | `agents/seed/persona-data.ts` 선택 필드 · `sheet-scraper.ts` 배정 8→18 | 20 | AN 약국단골·AL 헬스덕후 배정 **해제** 확인 | — |
| 22 | dry-run 관찰 | — | 21 | 아래 PASS 조건 | 미달 시 롤백 |

**총 22단계 · 예상 20시간 · 24시간 내 실행 가능** ✅

⚠️ **`MENOPAUSE` 배열 추가는 20번째다.** M3-BOT-3에서 "10단계 중 10번째",
M3-BOT-5에서 "20단계 중 19번째"였던 것이 BotLog 배선 단계가 들어오며 22단계 중 20번째가 됐다.
**순서상 위치(safety·exposure guard 전부 이후)는 세 문서가 동일하다.**

##### 필수 신규/수정 파일

**신규 7개**

| 파일 | 왜 필요한가 |
|---|---|
| `agents/core/menopause-speech-rules.ts` | 의료 정규식이 `author-reply-policy.ts`에 갇혀 있어 다른 9경로가 못 쓴다. **이동만 하고 수정 금지** |
| `agents/core/bot-comment-guard.ts` | **호출부가 부를 함수는 하나여야 한다.** 정책이 두 벌인 게 이번 사고의 원인이다 |
| `agents/core/tone-family.ts` | G3·G4의 입력. 30명 → 4계열 순수 상수 |
| `scripts/check-bot-comment-guard.ts` | "새 create 경로 추가하고 guard 빠뜨림"의 **구조적 재발 방지**. `check-cron-links.ts`와 같은 방식 |
| `src/__tests__/bot-comment-guard.test.ts` | safety 단위 |
| `src/__tests__/bot-exposure-guard.test.ts` | exposure 단위 |
| `src/__tests__/menopause-speech-rules-parity.test.ts` | 2·3단계 리팩터링이 판정을 바꾸지 않았음을 고정 |

**수정 13개**

```
agents/core/bot-engagement-policy.ts     배열에 MENOPAUSE (20단계)
agents/coo/author-reply-policy.ts        정규식 import + ELIGIBLE_BOARDS 정리
agents/cafe/wave-processor.ts            guard + cap 20→3 + MENOPAUSE globalCap=2
agents/cafe/user-post-wave-processor.ts  boardType select + guard + wave3~5 skip
agents/seed/scheduler.ts                 L973·L1196 boardType select + guard
agents/seed/micro-scheduler.ts           guard 교체
agents/seed/controversy-chain.ts         guard 교체 + BotLog 신설
agents/coo/comment-activator.ts          guard 교체 + BotLog 신설 + MAX_BOT_COMMENTS_PER_POST 폐기
agents/coo/reply-chain-driver.ts         guard 교체 + BotLog 신설
agents/coo/author-reply-driver.ts        guard 배선 (G1 제외)
agents/seed/persona-data.ts              선택 필드 4개 + 30명 값
agents/community/sheet-scraper.ts        MENOPAUSE 배정 8 → 18명, AN·AL 해제
src/lib/actions/wave-queue.ts            jitter 10~60분
```

**migration 0건** ✅ — 전부 상수·함수·인터페이스. Prisma 스키마 무변경.

##### guard 함수 설계

```ts
// agents/core/bot-comment-guard.ts

// ── safety (순수 · DB 불필요 · 테스트 가벼움) ──
export type BotCommentBlockReason =
  | 'BOARD_ENGAGEMENT_DISABLED' | 'BOARD_TYPE_UNKNOWN'
  | 'MENOPAUSE_MEDICAL_ADVICE' | 'MENOPAUSE_SEXUAL_CONTENT' | 'MENOPAUSE_MENTAL_HEALTH_CRISIS'

export function checkBotComment(i: {
  boardType: string | null | undefined   // null 허용 = fail-closed를 타입으로 강제
  generatedComment: string
  postTitle?: string
  sourcePath: string
  personaId?: string
}): { ok: boolean; reason: BotCommentBlockReason | null; logDetail: string }

// ── exposure (DB 조회 필요) ──
export type BotExposureBlockReason =
  | 'post_cap_reached' | 'persona_already_on_post' | 'tone_family_conflict'
  | 'advice_tone_limit' | 'screen_exposure_cap' | 'persona_daily_cap'
  | 'human_comment_present' | 'BOARD_TYPE_UNKNOWN' | 'POST_NOT_FOUND' | 'QUERY_FAILED'

export async function checkBotExposure(i: {
  postId: string
  boardType: string | null | undefined
  personaId: string
  toneFamily: ToneFamily
  sourcePath: string
  isAuthorReply?: boolean        // true면 G1(post_cap) 건너뜀 — 별도 집계
}): Promise<{ ok: boolean; reason: BotExposureBlockReason | null; retryable: boolean; logDetail: string }>
```

**역할 분리 이유**

```
safety   텍스트만 본다 → 순수 함수 → DB mock 없이 테스트
exposure DB를 본다     → 비동기   → 조회 실패 처리 필요

같은 파일에 두되 함수는 분리한다.
같은 파일 = 호출부가 하나만 부르고 나머지를 빠뜨리는 걸 눈에 띄게 한다.
분리    = safety 테스트가 무거워지지 않는다.
```

**fail-closed 기준**

| 상황 | 판정 | retryable | 이유 |
|---|---|---|---|
| `boardType` null·undefined·`''` | **차단** | ❌ terminal | 배선 버그 신호. 재시도해도 같다 |
| `post` not found | **차단** | ❌ terminal | 글이 없다 |
| 댓글 조회 throw | **차단** | ✅ retryable | 일시적 DB 장애일 수 있다 |
| 알 수 없는 boardType(`'TALK'` 등) | **차단** | ❌ terminal | 허용 목록에 없다 |

⚠️ **`severity`·`log_only` 필드는 두지 않는다.** D-day 판단은 "쓴다/안 쓴다" 둘뿐이고,
중간 등급은 호출부마다 해석이 갈려 `log_only`가 사실상 통과로 쓰이는 사고를 부른다.

##### 큐 처리 정책

```
retryable = true  →  waveAt을 +20분 미룬다 (WAVE_BOT_CAP_RETRY_MS 재사용)
                     단 retryAt < expiresAt 일 때만. 넘으면 done 마킹
                     대상: screen_exposure_cap · persona_daily_cap · QUERY_FAILED
                     이유: 시간이 지나면 해소되는 조건이다

retryable = false →  wave1~5Done 전부 true로 마킹 후 skip
                     대상: post_cap_reached · human_comment_present · tone_family_conflict
                           persona_already_on_post · BOARD_TYPE_UNKNOWN
                           POST_NOT_FOUND · BOARD_ENGAGEMENT_DISABLED
                     이유: 재시도해도 결과가 같다
```

⚠️ **단순 `continue`는 금지다.** 큐가 영원히 재시도된다.
`wave-processor.ts:762`의 "done 마킹 후 skip" 패턴이 실전 검증(4/4)됐으므로 이를 표준으로 삼는다.

**USER_POST_WAVE의 wave3~5 처리 (확정)**

```
MENOPAUSE 글:  wave1·wave2만 처리 → 글당 2개
               wave3·wave4·wave5는 소비 단계에서 skip + Done 마킹

⚠️ 생산자(wave-queue.ts)에서 wave3~5를 안 만드는 방식은 불가하다.
   wave3At·wave4At은 schema 필수 필드다(wave5At만 nullable).
   → 값은 넣되 소비 단계에서 거른다. migration 회피.
```

##### BotLog.details 표준

전 경로 필수 필드다. 사후 감사가 가능해야 한다.

```json
{
  "postId":     "cmt155q1t0001iz2yxq3yg8jx",
  "boardType":  "MENOPAUSE",
  "personaId":  "AM",
  "toneFamily": "anxious_question",
  "sourcePath": "seed:sheet-engagement-wave",
  "skipReason": "post_cap_reached",
  "retryable":  false
}
```

**action 명명** — 기존 관례(`SCREAMING_SNAKE`)를 따른다.

```
기존 유지  SHEET_ENGAGE_COMMENT_PENDING · SHEET_COMMENT_WAVE_PENDING · WAVE_PROCESS_V2
           USER_POST_WAVE · COMMENT_ACTIVATE · REPLY_CHAIN_DRIVE
           AUTHOR_REPLY_WRITE · AUTHOR_REPLY_DRYRUN

신규       BOT_COMMENT_GUARD_SKIP   guard가 차단한 건 (전 경로 공통)
           CONTROVERSY_CHAIN        controversy-chain 신설 (현재 기록 0건)
```

##### 테스트·검증 계획

```
① 단위       npx vitest run src/__tests__/bot-comment-guard.test.ts
                            src/__tests__/bot-exposure-guard.test.ts
                            src/__tests__/menopause-speech-rules-parity.test.ts
                            src/__tests__/author-reply-policy.test.ts   ← 회귀 기준선, 수정 금지

② 정적       npx tsx scripts/check-bot-comment-guard.ts     exit 0 필수
             npx tsx scripts/check-cron-links.ts            orphan 0

③ typecheck  npx tsc --noEmit                               오류 0
④ ops        npx tsc -p tsconfig.ops.json --noEmit          오류 0  ⚠️ agents/ 검사는 이쪽만
⑤ lint       npx eslint . --ext .ts,.tsx
⑥ build      npm run build

⑦ dry-run    22단계. 실제 write 없이 skip 로그만 관찰
   PASS 조건
     BOARD_TYPE_UNKNOWN            0건      ← 1건이라도 있으면 배선 누락. 롤백
     post_cap_reached              1건 이상  ← guard 동작 증명
     human_comment_present         관측됨
     STORY/HUMOR/LIFE2 댓글 수      전일 ±10% 이내 ← 기존 서비스 회귀 없음

⑧ 첫 운영    MENOPAUSE 글 1개에 실제 2개 생성 확인
             시각 간격이 10~60분 범위이고 글마다 다른지 확인
             (현재는 [5,14,24,49,60] 고정 패턴 — 바뀌어야 정상)

⑨ 고객 화면  curl -H "x-bot-type: qa-verify" <글 URL>
             목록에서 같은 닉네임 반복 노출 없는지
             댓글 2개의 톤 계열이 다른지 육안 확인
```

##### D-day 실행 전/중/후 체크리스트

```
[실행 전]
[ ] git fetch origin main && git rev-list --count HEAD..origin/main → 0 확인
[ ] git switch -c feat/m3-bot-guard origin/main   (로컬 main checkout 금지 — worktree 점유)
[ ] git status --short → 타 세션 미커밋 없는지
[ ] 현재 MENOPAUSE 봇 댓글 수 기록 (롤백 기준선)
[ ] 현재 STORY/HUMOR/LIFE2 일일 댓글 수 기록 (회귀 판정 기준선)
[ ] .env.local · GitHub Secrets 변경 필요 여부 → 없음(확인 완료)

[구현 중]
[ ] Phase A 끝 → author-reply-policy.test.ts 통과 확인 후에만 B 진입
[ ] Phase B 끝 → 단위 테스트 전량 통과 후에만 C 진입
[ ] Phase C 각 단계 → npx tsc -p tsconfig.ops.json --noEmit
[ ] 12·13단계 후 → boardType이 실제 select에 들어갔는지 코드 확인
[ ] 19단계 → check-bot-comment-guard.ts exit 0 아니면 20단계 진입 금지

[구현 후]
[ ] dry-run PASS 조건 4개 전부 충족
[ ] 첫 MENOPAUSE 글 실제 2개 · 톤 계열 상이 · 지연 10~60분
[ ] 기존 보드 댓글 수 ±10% 이내
[ ] BotLog에 postId·boardType·skipReason 기록됨
```

##### 🛑 즉시 중단 기준

```
1. author-reply-policy.test.ts 실패        → 정규식 이동에서 회귀. 되돌림
2. BOARD_TYPE_UNKNOWN 1건 이상             → 배선 누락. 배열 추가 금지
3. check-bot-comment-guard.ts exit 1       → guard 미배선 경로 존재
4. 기존 보드 댓글 수 -10% 초과 감소         → 기존 서비스 영향. 롤백
5. MENOPAUSE 글에 3개 이상 생성            → G1 미작동
6. 실회원/게스트 댓글 뒤 봇 추가 생성       → G7 미작동
7. npx tsc -p tsconfig.ops.json 오류        → agents 타입 회귀
```

**롤백 방법**: 20단계(배열 추가) 이전이면 코드가 들어가 있어도 MENOPAUSE는 여전히 차단되므로 **무해하다.**
20단계 이후 문제 발생 시 배열에서 `'MENOPAUSE'` **한 줄만 되돌리면 즉시 원복**된다.

##### 하면 안 되는 것

```
MENOPAUSE 배열 먼저 추가             287+25건 확정 경로가 guard 없이 열린다. 20단계다
일부 경로만 guard 적용               scheduler L973·L1196이 가장 위험한데 가장 안 보인다
BotLog 없는 skip                     3개 경로가 이미 무기록. dry-run 판정이 불가능해진다
producer마다 제각각 제한             이미 3벌(5 / 10~20 / wave×count)이고 그게 원인이다
migration부터 시작                   D-day 항목 전부 migration 불필요
기존 보드 cap 동시 정리              창업자 확정 ②. D+30 과제다
실회원/게스트 감지 없이 wave 유지     G7. AI 운영처럼 보이는 가장 직접적 원인
@unao.bot 이메일로 실회원 판정        isRealUser(providerId 숫자)가 SSoT. 게스트를 놓친다
의료 정규식을 "개선"하며 이동         2단계는 이동이지 개선이 아니다
author-reply-policy.test.ts 수정      회귀 기준선이다
connection-facilitator·job-matcher 수정  도달 불가 확정. 겸사겸사 수정은 회귀만 늘린다
단순 continue로 skip                 큐가 영원히 재시도된다. done 마킹 필요
wave1At = +1분 유지                  확정값은 10~60분
로컬 main checkout                   다른 worktree 점유 중. git switch -c origin/main
```

##### D+30 과제

```
[ ] 기존 보드 globalCap 10~20과 constitution.yaml:351 (=5) 불일치 정리
[ ] strict exposure guard를 STORY/HUMOR/LIFE2로 확대할지 검토
[ ] screen_exposure 조회 비용 실측 (매 create마다 최근 20글 조회 부하)
[ ] /api/internal/user-post-wave 외부 호출 여부 점검 (코드 내 호출부 0건이나 토큰 보유 주체 미확인)
[ ] PersonaMemory 모델 (실제 대화 이력 기반 기억) — 유일하게 migration이 필요한 항목
[ ] Comment에 생성 경로 필드(botSourcePath) — 사후 추적용
[ ] 페르소나 30 → 50명 확장
```

##### 아직 미확정 (추정하지 않음)

| 항목 | 왜 미확정인가 | 확인 방법 |
|---|---|---|
| ~~tone family 4계열 매핑~~ | ✅ **M3-BOT-7에서 해소 (2026-08-20).** 30명 전원을 `persona-data.ts` 실제 필드로 전수 대조해 계열을 확정하고, MENOPAUSE 부적합 4명을 걸러냈다 | 해소됨. **단 코드 반영표는 D-day 5단계에서 재확인** |
| `screen_exposure` 조회 비용 | 부하 미실측 | 10단계에서 EXPLAIN |
| `/api/internal/user-post-wave` 외부 호출 | `INTERNAL_API_TOKEN` 보유 주체 미확인 | 소비자 guard(13단계)로 덮이므로 D-day blocker는 아님 |
| `greeting.ts` 환대 글의 boardType | MENOPAUSE 환대 글 가능 여부 미추적 | 13단계 소비자 guard로 덮임 |
| `comment-activator`·`reply-chain-driver` 실행 빈도 | `agents-daily.yml`에 case는 확인했으나 실제 회차 수 미확인 | 15단계 BotLog 신설 후 관측 |

---

#### M3-BOT-7 tone family 4계열 매핑 확정 (2026-08-20)

> **판정: 확정 — M3-BOT-6의 blocker "tone family 4계열 매핑"이 해소됐다.**
> 30명 전원을 `agents/seed/persona-data.ts`의 실제 `personality`·`speech_patterns`·`topics`·
> `quirks`·`never`·`examples` 필드로 전수 대조해 계열을 부여했다.
>
> ⚠️ **단 코드 반영표(`agents/core/tone-family.ts`)는 D-day 구현 5단계에서 다시 확인한다.**
> 이 절은 정책 확정이며, 상수 파일의 최종 형태는 구현 시점에 결정한다.

##### 🔧 M3-BOT-4 오류 정정 2건

**정정 ① — AG 비교분석왕을 MENOPAUSE에 배정한 것은 오판이었다**

M3-BOT-4에서 AG를 "완경·호르몬(비의료)" 후보로 제안했으나, 실제 필드는 정반대다.

```
topics    "혈압약비교 3개 병원 직접 다녀봤어요" · "오메가3 3종 직접 비교했어요"
examples  "혈압약 비교해봤어요. A병원: 2만원(진료 30분) / B병원: 1만5천원 ...
           결론은 B병원이 가성비 좋아요"
의료어     약 · 병원 · 의사
```

**병원·약 가격 비교가 이 페르소나의 본체다.** MENOPAUSE에 배정하면 `checkBotComment()`의
의료 guard에 상시 걸리고, 통과하더라도 정확히 우리가 막으려던 발화가 된다.

⚠️ `sheet-scraper.ts`의 **기존** MENOPAUSE 배정 8명(X·AM·AH·BF·AJ·H·AN·AL)에 AG는 없다.
기존 설정은 정상이었고 **M3-BOT-4의 확장안이 오염원**이었다.

**정정 ② — BF 속터지는현실은 ①이 아니라 ②다 (창업자 확정)**

```
M3-BOT-4/5   ① 불안·질문형으로 분류 (근거: "제가 이상한 건가요? / 저만 그래요?")
M3-BOT-7     ② 하소연·동반형으로 정정

정정 이유: 질문형 표현이 있어도 본질은 불안 질문이 아니라
          억울함·답답함·상황 토로다. quirks도 "상황을 최대한 구체적으로 묘사
          (누가/언제/뭐라고 했는지)"가 본체이며, 질문은 마무리 장치일 뿐이다.
```

이 정정으로 ①이 4명 → **3명**이 됐다(§계열 균형 참조).

##### 4계열 정의 (필드 근거)

| 계열 | 정의 | 판별 근거 |
|---|---|---|
| **① 불안·질문형** | 확인받고 싶어 묻는다. 결론을 안 낸다 | `speech_patterns`에 "혹시/괜찮을까요/저만 그런가" · `never`에 "확신·단정" |
| **② 하소연·동반형** | 자기도 힘들다고 같이 털어놓는다 | `mood` negative/mixed · `quirks`에 "공감 요청 마무리" · 자기 상황 서술이 본체 |
| **③ 위로·응원형** | 상대에게 반응한다. 자기 얘기가 짧다 | `speech_patterns`에 "저도 그랬어요/힘드셨겠어요" · `never`에 "조언·충고" |
| **④ 정리·전환형** | 정보를 정리하거나 판단을 내린다 | `quirks`에 "비교/근거/결론" · `never`에 "감정적 반응" |

##### 첫날 30명 최종 매핑표

**구성은 변경 없다 — 50대 19명 · 40대 후반 6명 · 60대 5명.**
50대 19번째는 **A 하늘바라기(58)** 로 확정한다(`topics`에 "갱년기 증상 솔직하게 공유"·
"무릎이 요즘 자꾸 아파요"가 직접 포함되어 갱년기·몸 변화·가족 맥락에 자연스럽게 붙는다).

**① 불안·질문형 — 3명 (전원 MENOPAUSE 허용)**

| ID | 닉네임 | 나이 | 근거 |
|---|---|---|---|
| X | 걱정인형 | 62 | `"~하면 어쩌지 / 혹시~ / ~괜찮을까요"` · never: 낙관적 결론·확신 |
| AM | 불안한밤 | 62 | `"혹시 이거~ / 괜찮은 걸까요"` · never: **의학 단정·약 추천** |
| BQ | 조심스런댁 | 59 | `"제가 이상한 건지 모르겠는데..."` · never: 강한 주장 |

**② 하소연·동반형 — 10명**

| ID | 닉네임 | 나이 | 근거 | MENOPAUSE |
|---|---|---|---|---|
| AH | 피곤해요 | 55 | `"피곤해요..."` · never: 활기찬 톤·**운동 권유** | ✅ |
| AJ | 가족곁에서 | 57 | 시어머니 간병 3년차 · never: **조언 강요** | ✅ |
| AK | 엄마뭐해요 | 54 | 친정엄마 치매 간병 · never: **간병 조언·의료 진단** | ✅ |
| BC | 억울한아내 | 59 | `"이 사람이 진짜... / 저만 이래요?"` | ✅ |
| AE | 새벽감성 | 52 | 불면증 · `"~하는 밤이에요"` · never: 밝은 톤 | ✅ **불면 축 최적** |
| BA | 은퇴준비중 | 48 | "기대 한 문장 + 불안 한 문장" | ✅ |
| AV | 혼밥일기 | 56 | `"혼자라 좀 허전하지만"` · never: 외로움 과장 | ✅ |
| **BF** | 속터지는현실 | 57 | **①→② 정정** · 억울 서술이 본체 · never: **해결책 제시** | ✅ |
| **A** | 하늘바라기 | 58 | **19번째 확정** · topics에 갱년기 직접 포함 | ✅ |
| Z | 혼자잘산다 | 54 | 자조 유머 · never: **외로움 호소·불쌍한 톤** | 🟡 조건부 |

**③ 위로·응원형 — 8명**

| ID | 닉네임 | 나이 | 근거 | MENOPAUSE |
|---|---|---|---|---|
| E | 미숙이맘 | 52 | `"저도 그랬어요"` · never: 비판·반박 · 3줄 이상 필수 | ✅ |
| BN | 위로천사 | 56 | `"힘드셨겠어요"` · never: **충고·해결책 강요** | ✅ **최적** |
| AQ | 조용한수다 | 59 | `"그러셨군요"` · never: **조언** · 1~2문장 | ✅ **최적** |
| BU | 느린공감 | 63 | "매번 다른 첫마디" · never: 반복 | ✅ |
| BT | 나도그랬어 | 60 | `"저도 비슷한 적 있어요"` · never: **조언** | ✅ |
| BK | 공감백퍼 | 52 | `"맞아맞아"` · 짧고 강함 | ✅ |
| BW | 감성파 | 58 | `"여운이 남네요"` · never: **명확한 판단** | ✅ |
| BR | 응원언니 | 51 | `"잘하셨어요!!"` · 느낌표 겹침 | 🟡 조건부 |

**④ 정리·전환형 — 9명 (MENOPAUSE는 P·AC만 저빈도)**

| ID | 닉네임 | 나이 | MENOPAUSE | 사유 |
|---|---|---|---|---|
| P | 오후햇살 | 55 | ✅ **저빈도** | 에세이 · never: 정보형·목록형 — ④ 중 유일하게 안전 |
| AC | 느긋이 | 63 | ✅ **저빈도** | 충청 사투리 · 여유 전환 |
| K | 예쁘게살자 | 56 | 🟡 fallback | 브랜드·제품명 구체 언급 습관 → 영양제 추천으로 번질 위험 |
| O | 올드팝 | 48 | 🟡 fallback | 음악·추억 · 갱년기 맥락 약함 |
| AZ | 돈공부중 | 47 | 🟡 fallback | 재테크 · 갱년기 맥락 없음 |
| **AG** | 비교분석왕 | 57 | 🔴 **금지** | **topics·examples가 "혈압약 3개 병원 비교"** · 의료 guard 상시 충돌 |
| **W** | 참나진짜 | 48 | 🔴 **금지** | `"참나... / 어이없다 / 장사하네"` · never: **칭찬** · 갱년기 하소연에 재앙 |
| **Y** | 솔직히말해서 | 49 | 🔴 **금지** | 팩폭러 · never: **위로·"힘내세요" 류 금지** · 갱년기 정서와 정반대 |
| **AB** | 따져보자 | 49 | 🔴 **금지** | `"근데"로 반론` · never: **무조건적 동의** · 의료어 병원·약 |

##### MENOPAUSE 허용/금지 최종 명단

```
✅ 허용 23명
   ① X · AM · BQ                                              (3)
   ② AH · AJ · AK · BC · AE · BA · AV · BF · A · Z(조건부)     (10)
   ③ E · BN · AQ · BU · BT · BK · BW · BR(조건부)              (8)
   ④ P · AC  ← 저빈도만                                        (2)

🟡 fallback/저빈도 3명   K · O · AZ
   → 첫날 MENOPAUSE 기본 풀에서는 제외한다. 후보 고갈 시에만 사용

🔴 금지 6명   AG · W · Y · AB · AN 약국단골 · AL 헬스덕후
   → AN·AL은 M3-BOT-4에서 이미 배정 해제 대상으로 확정됨
   → AG·W·Y·AB는 30명 세트에는 유지한다. STORY/LIFE2에서는 유효한 자산이다
      코드에는 menopauseAllowed: false 플래그로 분리한다
```

##### 조건부 2명의 허용 범위

```
Z 혼자잘산다   never에 "외로움 호소 금지"가 있어 갱년기 우울 글과 충돌한다
               → '가족·관계' · '나만 이런가요'만 허용. '마음의 변화' 제외
BR 응원언니    느낌표 겹침(!!)이 갱년기 무거운 글에 과하다
               → '나만 이런가요'만 허용
```

##### 글당 2개 조합 원칙 (창업자 확정)

```
✅ 기본 추천   ③ + ①      예: BN 위로천사 + AM 불안한밤
✅ 기본 추천   ③ + ②      예: AQ 조용한수다 + AH 피곤해요

🚫 같은 family 중복 금지 (G3)
🚫 ④ + ④        조언처럼 읽힌다 (G4)
🚫 ① + ①        불안이 증폭된다. 글쓴이가 더 불안해진다
🚫 ② + ②        하소연 경쟁이 된다. 글쓴이가 밀려난다
🚫 AM + X        둘 다 ①이며 말투("혹시…괜찮을까요")가 거의 동일
🚫 BN + AQ       둘 다 ③ 최적이나 동시 투입 시 위로만 두 줄
🚫 E + BN        둘 다 ③ · "저도 그랬어요"와 "힘드셨겠어요"가 겹친다
⚠️ AH · AJ · AK  상호 중복 지양 — ② 간병·피로 축이 겹쳐 무거움이 배가된다
```

##### 계열 균형 검증 (D-day 발행량 대비)

```
BF가 ①→②로 이동하며 ①이 3명으로 줄었다. 공급 가능량을 재계산한다.

③ 8명 × 일일 3회 = 24슬롯   ← 병목. 모든 조합의 첫 슬롯이다
① 3명 × 3회 =  9슬롯
② 10명 × 3회 = 30슬롯
④ 2명(저빈도) = 소수

→ ③이 병목이므로 하루 최대 24개 글까지 커버된다.
   D-day 발행 목표 20건이므로 충분하다 ✅

⚠️ 단 "③+① 우선" 규칙을 엄격히 적용하면 ①이 9슬롯이라
   하루 9글까지만 ③+① 조합이 가능하다. 나머지는 ③+②로 채운다.
   → 배정 로직은 ①을 먼저 소진하고 ②로 넘어가는 순서를 권장한다.
```

##### D-day 구현 시 확인할 것

```
[ ] agents/core/tone-family.ts 에 30명 → 4계열 매핑 상수 (5단계)
[ ] menopauseAllowed 플래그 — AG/W/Y/AB = false
[ ] 조건부 2명(Z·BR)의 카테고리 제한을 상수로 표현할지, D+30으로 미룰지
[ ] sheet-scraper.ts MENOPAUSE 배정을 8명 → 23명으로 (21단계)
    동시에 AN 약국단골 · AL 헬스덕후 해제
[ ] ① 고갈 시 ②로 넘어가는 fallback 순서 구현
```

##### 아직 미확정 (추정하지 않음)

| 항목 | 왜 미확정인가 | 확인 방법 |
|---|---|---|
| ③ 8명 내부 세분화 필요성 | BN·AQ·BU·BT·E가 모두 "위로"라 서로 대체 가능하다. 같은 글에는 1명뿐이라 D-day 문제는 없으나 목록 화면에서 위로 톤이 반복돼 보일 수 있다 | G5(`screen_exposure`)로 완화되나 미검증 — dry-run에서 관찰 |
| 조건부 2명의 카테고리 제한 구현 방식 | Z·BR의 허용 카테고리를 코드로 표현할지 운영으로 뺄지 미정 | D-day 5단계에서 결정 |
| curator 225명의 계열 분류 | `age`·`never` 필드가 없어 같은 방식으로 분류 불가 | D+30 과제 |

---

## 5. 가져가지 않을 가능성이 큰 것

| 항목 | 현재 상태 | 제외 근거 |
|---|---|---|
| **별도 jobs/2막준비 게시판** | `/jobs` · `/jobs/[id]` · `/jobs/region/[sido]` + `JobDetail` 모델 | SEO 목적이었으나 실질 효과가 거의 없다. 일자리 방식은 버리고, 돈·노후·일 이야기는 자유게시판/매거진 주제로 흡수 |
| **웃음방 독립 게시판** | HUMOR 보드 731건 | E0 정책으로 googlebot noindex 전면 적용 중 = 검색 유입 기여 0 |
| **화제성 파생 탭 다수** | `_화제성` 탭 4종 (Sheet 탭 9개 중) | 운영 복잡도 대비 효과 불명 |
| **popular crawler** | `agents/cafe/` + launchd 3개 | 30일 20회 SUCCESS인데 **발행 0건**. 원인 미규명 상태로 계속 실행 |
| **과도한 GHA/cron/launchd** | 워크플로 26개 · cron 116개 · launchd 12개 · agents 120파일 | 회원 424명 서비스에 대기업 규모 자동화. **전체를 파악할 수 있는 사람이 없다** |
| **대량 자동 외부글 발행** | 일 134건 | 71.4%가 300자 미만. 검색엔진·방문자 모두에게 양산 신호 |
| **봇 댓글을 활성 지표로 보는 구조** | 봇 83계정이 댓글 93.5% 생산 | 마중물 개념은 유효하나, 현재 비율은 정체성 위협 |
| **네이버카페 crawler** | `agents/cafe/crawler.ts` + launchd 10개 | 쿠키 수동 갱신 의존 · 차단 위험 · `CafePost` 31,160건 축적. 운영 부담 > 산출 가치 |

---

## 6. 외부글 운영 현실과 원칙

### 현실 (이상론 금지)

**회원 글이 일 0.7건이다.** 외부글을 끊으면 하루 1건 미만이 올라온다. 그건 진짜로 죽은 사이트다.
**"외부글을 없애자"는 현실에 맞지 않는다.**

### 진짜 문제

> 문제는 **"외부글이 있다"**가 아니라 **"외부글이 99.4%다"**이다.

외부글은 **대화의 씨앗**이어야지 **사이트의 정체성**이 되면 안 된다. 지금은 정체성이 됐다.

### 실패 조건 (하나라도 해당하면 실패)

- 죽은 사이트처럼 보인다
- AI가 대충 만든 사이트처럼 보인다
- 퍼온 글 모음처럼 보인다
- 출처/자동 발행/스크래핑 냄새가 고객 화면에 남는다
- 연예·자극 유입에 정체성이 끌려간다

### 필요 조건 (4종 세트)

```
① gate         자동 선별 — 위험 글 차단 + 타겟 적합도 판정
② 사람 승인     창업자가 직접 보고 고른다. 자동 승격 경로 없음
③ 제한 발행     하루 상한을 먼저 정하고 시작한다
④ 댓글 유도     대화가 붙을 글만 고른다 (댓글수를 신호로 사용)
```

### 이미 확보한 자산

이번 주에 만든 **cook82 후보 큐**가 정확히 이 구조다.

```
agents/cook82/
  collector.ts       수집 (write 없음)
  gate.ts            v3.2.2 선별 — AI 호출 0원, 위험 4종 차단
  queue.ts           판정 (write 없음)
  review.ts          ★ 사람 승인 — APPROVED로 가는 코드 경로 없음
  publish-bridge.ts  전달 — 유일한 write 지점, 4중 안전장치
```

**실전 검증 완료**: 첫 82cook 글이 Sheet → PUBLISHED까지 성공했고, QA에서
고객 화면 출처 노출 0건 · 제목 rewrite 정상 · SEO 메타 정상을 확인했다.

**빠진 것은 하나 — 발행량이다.** 골라내는 장치는 만들었는데 일 134건 자동 발행은 그대로다.

### 원천별 선별 기준

| 원천 | 대상 | 비고 |
|---|---|---|
| **82cook 자유게시판(bn=15)** | 자유게시판·갱년기 소재 | gate v3.2.2 적용. 실측 PASS 58% |
| **드라마·연예 회상형** | 작품·방송(E4) 유형 | "청춘의 덫 다시보니" 류. **범죄·의혹(E5)·정치연계(E6)는 차단 유지** |
| 그 외 | 미정 | 새 브랜드에서 재검토 |

### 새 브랜드 외부글 운영 원칙 (제안)

```
1. 하루 외부글 발행 상한은 20건으로 시작한다
2. 모든 외부글은 gate + 사람 승인을 거친다
3. 외부글 : 회원글 비율을 지표로 관리한다 (현재는 측정조차 안 함)
4. 봇 댓글은 활성화처럼 보이기 위한 마중물로 적극 사용하되, 봇마다 강한 페르소나와 기억을 부여한다
5. 본문 300자 미만은 발행하지 않는다
6. 고객 화면에 출처·자동발행 흔적을 남기지 않는다 (내부 추적은 유지)
```

봇 댓글은 단순 수량 채우기가 아니다. 각 페르소나는 한 명의 실제 사용자처럼 주제 맥락,
이전에 쓴 댓글, 이전 게시글, 말투를 기억해야 한다. 현재처럼 봇 댓글이 많아도 정체성이 없으면
커뮤니티가 아니라 자동화된 사이트처럼 보인다.

---

## 7. Keep / Drop / Rewrite 기준

### KEEP — 코드 패턴/구현 경험을 재사용한다

| 항목 | 경로 | 근거 |
|---|---|---|
| 커뮤니티 글/댓글 기본 구조 | `src/app/(main)/community/**`, `Comment` 모델 | 보드-목록-상세-작성 표준 구조. 문제는 구조가 아니라 콘텐츠 |
| Kakao 로그인 패턴 | `src/lib/auth.config.ts`, `User.providerId` | 타겟층에 카카오 로그인은 사실상 필수. 단, 새 브랜드라면 실제 Kakao 앱은 분리 생성 검토가 기본 |
| Supabase / Prisma 구현 경험 | `prisma/schema.prisma` | 스택과 ORM 패턴은 재사용 가치 있음. 단, 새 브랜드라면 실제 Supabase 프로젝트는 분리 생성 검토가 기본 |
| 제목/description 개선 | `agents/community/title-seo.ts` | 실측 검증됨 — 원문 왜곡 없이 맥락 보강. **Sonnet 고정, Haiku 금지** |
| cook82 후보 큐 | `agents/cook82/**` | **유일한 "선별형" 구조.** 새 브랜드의 표준 공급 경로 |
| 출처 처리 | `content-transformer.ts`, `normalize-source-references.ts` | 자동 꼬리표 제거 완료(PR #390). 원문 문구 일반화는 유지 |
| sitemap/robots/canonical | `src/app/sitemap.ts`, `robots.ts` | seo-guard로 보호되는 구조. 새 도메인으로만 교체 |

주의: KEEP은 기존 계정/프로젝트/앱/도메인을 그대로 가져간다는 뜻이 아니다. GitHub repo, Vercel project, Supabase project, Kakao app, Google/Search Console/Analytics 계정은 새 브랜드 독립성 때문에 분리 검토가 기본 전제다.

### DROP — 가져가면 위험하거나 불필요

```
무분별한 crawler       네이버카페 crawler + launchd 10개 — 쿠키 수동 갱신·차단 위험
popular crawler        20회 실행 · 발행 0건 · 원인 미규명
과도한 탭              jobs 독립 route · 웃음방 · 화제성 파생 탭
대량 봇 댓글           83계정이 댓글 93.5% 생산
GHA 26개 / cron 116개  최소 3~5개로 재시작
launchd 12개           로컬 맥 의존 = 단일 장애점
```

### REWRITE — 개념은 가져가되 다시 설계

```
게시판 구조            4보드 + 파생탭 → 자유게시판 + 갱년기 2판
SEO 매거진             262건 자산 유지, 시리즈·큐레이션 구조는 단순화
외부글 선별/발행 플로우   cook82 방식으로 통일 + 발행 상한 도입
운영 cron 구조          39개 핸들러(CEO~CDO 가상 조직) → 최소 구성
비용 구조              ISR Writes $56.10 · revalidatePath 167곳 → 설계 시점에 캐시 전략 확정
봇 마중물              개념 유지, 단순 비율 상한보다 페르소나·기억·맥락 품질을 핵심으로 재설계
noindex 정책(E0)       HUMOR 전면 googlebot noindex는 저품질 회피 목적.
                      새 브랜드가 애초에 저품질을 안 만들면 불필요 — 재검토
```

### M3-1 파일 단위 초안 (2026-08-20)

이 표는 D-day에 바로 구현하라는 지시가 아니다. 새 브랜드가 필요해졌을 때
**어떤 코드를 가져가고, 어떤 코드를 버리고, 어떤 코드를 다시 써야 하는지**
논의가 반복되지 않도록 미리 확정하기 위한 초안이다.

| 판정 | 현재 파일·경로 | 새 브랜드 처리 | 이유 |
|---|---|---|---|
| **KEEP** | `src/lib/board-registry.ts` | 구조는 유지하되 초기 보드는 `자유게시판`·`갱년기`·`매거진` 중심으로 축소 | 보드 slug/url/name의 단일 기준점은 필요하다. 단, JOB/HUMOR/LIFE2/WEEKLY를 그대로 열면 현재 복잡도가 반복된다 |
| **KEEP/SLIM** | `prisma/schema.prisma`의 `User`·`Post`·`Comment`·`PostSource` | 핵심 모델은 유지, `sourceUrl/sourceSite/source`는 반드시 유지 | 외부글을 검색 대표 영역에서 빼려면 출처 추적 필드가 처음부터 필요하다 |
| **DROP** | `JobDetail`, `/jobs/**`, `src/app/api/jobs/route.ts`, jobs 관련 agent/workflow | 독립 일자리 서비스는 새 브랜드 MVP에서 제외 | 일자리 SEO는 효과가 없었고, 돈·노후·일 이야기는 자유게시판/매거진 주제로 흡수한다 |
| **KEEP/SEPARATE** | `src/lib/auth.config.ts`, `src/lib/auth.ts` | NextAuth/Kakao 패턴은 유지. 실제 Kakao app/env는 새 브랜드용으로 분리 | 50대 여성 타겟에는 카카오 로그인이 필수다. 단, 기존 앱을 재사용하면 브랜드 독립성이 깨진다 |
| **REWRITE** | `src/app/(main)/page.tsx` | 홈은 새로 설계. 첫 화면에서 브랜드 정체성·갱년기 특화·커뮤니티성을 명확히 보여준다 | 현재 홈은 jobs, humor, ads, popup, 여러 섹션이 섞여 대표성이 약하다 |
| **KEEP/REWRITE** | `src/app/(main)/community/[boardSlug]/**` | 목록/상세/댓글 구조는 유지, 보드 수와 SEO 정책은 재작성 | 커뮤니티 기본 골격은 유효하다. 문제는 정보구조와 콘텐츠 신호다 |
| **KEEP/ABSORB** | `src/lib/seo/topic-menopause.ts`, `/topic/menopause` | 허브 로직은 유지하되 새 브랜드에서는 `/community/menopause` 상단으로 흡수 | 갱년기 허브 자산은 핵심이지만 대표 URL은 하나로 집중해야 한다. 별도 `/topic/menopause`를 같이 열면 검색 대표성이 분산된다 |
| **REWRITE** | `src/app/sitemap.ts`, `src/lib/seo/community-google-noindex.ts`, 커뮤니티 metadata | 처음부터 source/board 기준 검색 대표 영역 분리 | 외부글 20건/day를 허용하더라도 검색엔진에는 대표 페이지·원본 매거진·핵심 허브를 먼저 보여줘야 한다 |
| **KEEP/REWRITE** | `agents/cook82/**` | 후보 큐·gate·사람 승인 패턴은 표준 공급 경로로 유지 | 현재 코드 중 유일하게 “선별형 외부글 운영”에 가깝다. 다만 새 브랜드 정책/보드에 맞게 재작성한다 |
| **REWRITE** | `agents/community/sheet-scraper.ts`, `content-transformer.ts`, `title-seo.ts` | 승인 큐 소비자만 유지. 발행량·보드·출처 정책을 단순화 | Sheet 기반 운영은 유효하지만, 자동 대량 발행과 출처 흔적은 새 브랜드에서 반복되면 안 된다 |
| **DROP/POSTPONE** | `agents/cafe/crawler.ts`, `popular-*`, `image-router.ts`, 카페 crawler workflow/launchd | D-day MVP에는 넣지 않는다 | 쿠키·차단·대량 수집·제목 추출 실패 리스크가 크다. 먼저 사람 승인 큐 기반으로 시작한다 |
| **KEEP/REWRITE** | `agents/core/persona-registry.ts`, `agents/seed/persona-data.ts`, `agents/coo/comment-activator.ts`, `agents/core/bot-engagement-policy.ts`, `agents/coo/author-reply-policy.ts` | 79명 페르소나 자산과 갱년기 안전 규칙은 유지하되, 기억·노출 guard·KPI·MENOPAUSE 실행 경로를 재설계 | 자산은 우수하다. 79명 전원 여성이고 연령도 50대/60대 중심이다. 문제는 자산이 아니라 운영 축이다. 현재는 글당 댓글 수 중심이라 목록 체감 반복을 막지 못하고, 갱년기 안전 규칙도 author-reply 경로에만 확인된다. 새 브랜드에서는 첫 세트 30명, 갱년기 봇 댓글 허용, 글당 2개, 최근 20글 노출 guard, 실회원 KPI 분리를 D-day 기준으로 둔다. 단, MENOPAUSE는 배열 한 줄 추가가 아니라 공통 safety guard 선행 후 허용한다 |
| **DROP/POSTPONE** | 독립 `HUMOR` 보드/웃음방 노출면 | 유머는 자유게시판 카테고리로만 흡수 | HUMOR는 이미 검색 회피 대상이었고, 독립 보드로 두면 새 브랜드 대표성을 흐린다 |
| **REWRITE** | `.github/workflows/**`, launchd, cron | 최소 운영 runner만 다시 정의 | 기존 workflow 26개·cron 116개·launchd 12개는 새 브랜드 MVP에 과하다. 실행 경로 정본 붕괴를 반복하면 안 된다 |
| **DROP** | 기존 도메인 전체 리다이렉트, 기존 `sameAs`/브랜드 링크 재사용 | 새 브랜드에서 사용하지 않음 | 실패 도메인의 신호를 새 브랜드에 연결하지 않는다 |
| **POSTPONE** | 광고/이벤트/투표/푸시/과도한 admin 기능 | MVP 안정 이후 단계적으로 재검토 | 첫 목표는 생존과 대표성 회복이다. 수익화/부가 기능은 후순위다 |

### M3-1에서 아직 창업자와 확정해야 할 것

1. `자유게시판` 안에서 허용할 카테고리: 사는 이야기, 돈/노후, 유머, 일, 가족, 건강 중 무엇을 첫날부터 열지
2. `갱년기` 보드의 성격: 질문/경험담 중심인지, 매거진과 연결된 상담형 중심인지
3. 외부글 20건/day의 구성: 자유게시판 몇 건, 갱년기 몇 건, 매거진 보강 몇 건인지
4. 봇 페르소나의 첫 세트 명단: 30명은 확정. 50대 19명 · 40대 후반 6명 · 60대 5명 기준으로 최종 후보를 고를지
5. 기존 콘텐츠 재활용 기준: 살릴 글, 버릴 글, 완전 재작성할 글의 기준

---

## 8. M3 마일스톤

| # | 이름 | 목적 | 성공 기준 | 창업자 결정 |
|---|---|---|---|---|
| **M3-0** | AS-IS inventory | 현재 전수 조사 | ✅ **완료** (2026-08-19) | — |
| **M3-1** | Keep/Drop/Rewrite 확정 | §7 표를 창업자가 확정 | 18개 항목 전부 판정 | ✅ 필요 |
| **M3-2** | 새 브랜드 IA/Product spec | 홈·자유게시판·갱년기·매거진 상세 설계 | route 10개 이내 정의 | ✅ 필요 |
| **M3-3** | 콘텐츠 공급/외부글 운영 정책 | 발행 상한·승인 절차·비율 목표 확정 | "일 N건, 승인 M단계" 수치 확정 | ✅ 필요 |
| **M3-4** | SEO reset 전략 | 새 도메인 SEO 초기 설계 + 기존 도메인 처리 | 중복·저품질 재생산 차단 규칙 | ✅ 필요 |
| **M3-5** | 인프라 분리 계획 | 계정·리소스 목록화 + 순서·비용 | 무엇을 몇 번째로, 얼마에 | ❌ 불필요 |
| **M3-6** | launch checklist | 전환 시점·데이터 이관 범위·기존 서비스 처리 | 되돌리기 가능한 단계별 체크리스트 | ✅ 필요 |

### 각 마일스톤 공통 금지사항

```
창업자 명시 승인 없는 코드 수정 · DB write · Sheet write · workflow_dispatch · PR 생성 · merge
창업자 명시 승인 없는 외부 계정/도메인/서비스 생성 · 구매
naver_google/ 및 vercel 비용/ 폴더 수정
Naver/GSC/Search Advisor 요청
```

---

## 9. 운영 원칙

1. **현재 서비스 회복 관찰이 우선이다.** M3는 본작업이 아니라 **생존 보험**이다.
2. **대기 시간에만 진행한다.** 네이버 관찰은 대기이고, 그 시간에 판단 자료를 쌓는다.
3. **회복 여부가 확정되기 전에는 창업자 명시 승인 없는 새 브랜드 실행/구매/계정 생성 금지.**
4. **현재 서비스에 창업자 명시 승인 없는 추가 SEO 변경 금지.** 수집량이 하루 10건 안팎으로 극단적으로 축소되어 변경 효과를 판정하기 어렵고,
   변경만 쌓이면 나중에 원인 규명이 불가능해진다.
5. **이 문서는 append/update로 계속 갱신한다.** 마일스톤 완료 시 해당 절을 갱신한다.

### 생존 판단 기준 (창업자 확정 필요)

**운영 판단 기준 제안: 2026-08-22까지 네이버 수집량이 하루 10건 안팎에서 의미 있게 증가하는가.**

색인이나 유입보다 먼저 **수집량**을 보는 이유는, 현재 네이버가 사이트를 하루 4~14건 수준으로만
극소량 크롤링하고 있기 때문이다. **이 속도로는 수정분 반영과 회복 판정이 매우 느리다.**

```
수집 10건 안팎 유지  →  소량 수집 고착. M3 준비 비중 확대
수집 100건 이상 회복  →  회복 시작 신호. 단, 진짜 회복은 색인/노출/유입으로 추가 판정
```

확인 위치: Search Advisor → 요약 → 수집 현황 차트

---

## 10. 창업자 결정 대기 항목

| # | 항목 | 현황 | Claude 의견 |
|---|---|---|---|
| 1 | **새 브랜드명** | 미정 | — (창업자 영역) |
| 2 | **도메인** | 미정 | 기존 도메인 리다이렉트는 **비권장** — SEO 오염이 함께 옮겨질 위험 |
| 3 | **기존 회원 이전 여부** | 확정 | 데이터 이관 안 함. 기존 회원에게 카카오톡 등으로 새 브랜드 재가입 유도 |
| 4 | **사업자/계정 분리 수준** | 확정 | 새 브랜드 독립성을 위해 Kakao app·Supabase project·Vercel project·Google/Search Console/Analytics는 최대한 독립 분리 |
| 5 | **초기 외부글 일 발행량** | 확정 | 하루 20건. 단, gate + 사람 승인 + 출처/자동발행 흔적 제거가 전제 |
| 6 | **매거진 운영 방식** | 미정 | 적게·길게·원본. 대량 AI 생성 금지. guide 유형(글당 노출 10.5) 참고 |
| 7 | **봇 댓글 운영** | 핵심 기준 확정 · 첫 30명 설계 PASS · guard 설계 확정 | 비율 상한보다 페르소나 품질 우선. D-day 기준은 첫 세트 30명, 갱년기 보드 봇 댓글 허용, 글당 최대 2개, 최근 20글 기준 동일 페르소나 최대 2회, 게시 후 10~60분 지연, 실회원 댓글 후 추가 봇 중단. 전체 댓글과 실회원 댓글 KPI는 반드시 분리한다. M3-BOT-3 기준, MENOPAUSE 배열 추가는 마지막 단계이며 공통 `checkBotComment()` guard와 무방비 경로 편입이 선행되어야 한다. M3-BOT-4 기준, 첫 30명은 신규 대량 창작 없이 기존 bot 자산으로 구성하고, 40대 후반 결손 1명은 50대 1명으로 보완한다. 최종 분포는 50대 19명 · 40대 후반 6명 · 60대 5명이다. **M3-BOT-5 기준(2026-08-20 확정)**: ① 게스트 댓글도 사람 댓글로 보고(`providerId` 숫자 **또는** `guestNickname` 존재) 사람 댓글이 있으면 추가 봇 wave를 중단한다 ② strict exposure guard는 공통 함수로 설계하되 **첫 적용은 MENOPAUSE만**, 기존 보드는 D+30 이후 확대 검토 ③ author-reply는 글당 2개 제한과 **별도 집계**하되 safety·exposure guard는 통과해야 하며 반복 노출 시 skip한다. **M3-BOT-6 기준(2026-08-20 확정)**: ④ `screen_exposure`의 "최근 20개 글"은 **MENOPAUSE 보드 기준 20개**다 ⑤ `constitution.yaml:351`(`bot_comment_cap_per_post: 5`)과 `wave-processor` globalCap 10~20의 불일치는 **D-day에 건드리지 않는다** — MENOPAUSE=2는 헌법값보다 낮아 충돌하지 않으며, 기존 보드 cap 정리는 D+30 과제다. 구현은 **22단계 순서표**를 따르며 `MENOPAUSE` 배열 추가는 **20번째**다. **M3-BOT-7 기준(2026-08-20 확정)**: ⑥ 30명 구성(50대 19 · 40대 후반 6 · 60대 5)은 유지하고 **50대 19번째는 `A 하늘바라기`(58, 계열②, MENOPAUSE 허용)** 로 확정한다 ⑦ **`AG`·`W`·`Y`·`AB`는 30명 세트에 유지하되 `menopauseAllowed: false`** — AG는 "혈압약 3개 병원 비교"가 본체라 의료 guard와 충돌하고, W·Y·AB는 공격적·논쟁적 톤이라 MENOPAUSE 첫인상에 부적합하다. STORY/LIFE2에서는 활용 가능 ⑧ **`BF 속터지는현실`은 ①이 아니라 ② 하소연·동반형으로 정정** — 질문 표현이 있어도 본질은 억울함·상황 토로다 ⑨ MENOPAUSE 허용 23명 · fallback 3명(K·O·AZ) · 금지 6명(AG·W·Y·AB·AN·AL) ⑩ **M3-BOT-6의 blocker "tone family 매핑"은 해소됐다.** 단 코드 반영표는 D-day 5단계에서 재확인한다 |
| 8 | **생존 판단 기준** | 미정 | **운영 기준으로 08-22까지 수집량이 10건 안팎이면 소량 수집 고착, 100건 이상이면 회복 시작 신호** (§9 참조). 진짜 회복은 색인/노출/유입 동반 여부로 판정 |
| 9 | **기존 도메인 연결** | 확정 | 전체 리다이렉트 금지. 실패한 도메인의 신호를 새 브랜드에 연결하지 않음 |
| 10 | **기존 콘텐츠 재활용** | 방향 확정 | 살릴 수 있는 글은 Google Sheet 등 내부 큐에 보존하고, 오리지널리티를 강화해 새 브랜드에서 재활용하는 방법을 설계 |
| 11 | **자유게시판 내부 구현** | ✅ **확정 (M3-OPS-4)** | 고객 URL은 `/community/talk`, 내부 enum은 `STORY` 재사용. **`TALK` enum은 추가하지 않는다** — 빈 DB DDL에 BoardType 7값이 이미 있고, 추가 시 16파일 변경 + `ALTER TYPE` DB 작업이 드는데 효과는 0이다. 구현은 `BOARD_REGISTRY`의 STORY 행 slug를 `'stories'`→`'talk'`로 변경 |
| 13 | **D-day 게시판 구조** | ✅ **확정 (M3-OPS-4, 2026-08-20)** | 글쓰기 게시판 **3개만**: `MENOPAUSE`(갱년기 핵심판) · `STORY`(자유게시판) · `MAGAZINE`(매거진). 베스트는 별도 게시판이 아니라 노출/랭킹 화면. `HUMOR`·`LIFE2`·`WEEKLY`·`JOB`은 **BoardConfig row를 만들지 않는다**(= 404). 사는이야기·웃음방·2막준비·수다·돈·노후·유머는 자유게시판으로 흡수. 임시 표시명은 갱년기톡/자유게시판/매거진이며 브랜드명 확정 후 조정 |
| 14 | **매거진 D-day 오픈** | ✅ **확정** | 연다. 단 **첫날 3~5개 글이 전제**다. 단순 콘텐츠가 아니라 브랜드 정체성을 보여주는 공식 콘텐츠여야 하며, 네이버 AI 인용과 Google SEO를 위해 **원문성·구체성·서비스 정체성**을 담는다 |
| 15 | **`/jobs` 처리** | ✅ **확정** | D-day에는 **삭제하지 않고 `notFound()`로 임시 차단**한다. `/jobs`는 최상위 라우트이고 34파일이 `JOB`을 참조해 즉시 삭제 시 빌드·타입·라우팅 리스크가 크다. D+7~D+30에 참조 전수 조사 후 완전 제거 검토. **`notFound()`는 영구 유지가 아니라 첫날 사고 방지용 안전 차단막이다** |
| 16 | **D-day DB 초기화** | ✅ **확정 (M3-OPS-7/7b)** | 기존 `prisma/seed.ts`는 **절대 실행하지 않는다**(폐기 보드 4개 + 샘플 유저·글·댓글 오염). `scripts/seed-m3-minimal-board-config.ts`로 **BoardConfig 3행만 upsert**. DDL은 `migrate diff --from-empty --to-schema`로 생성하며 **멱등성 0건 = 1회 전용** — 실패 시 재실행 금지, 새 Supabase project 재생성으로 복구. AdminAccount는 기존 `scripts/create-admin.ts`(bcrypt saltRounds=12) 사용 |
| 17 | **D-day 매거진 3개** | ✅ **확정 (M3-OPS-8/9, 2026-08-20)** | ① 갱년기 언제 시작해 언제 끝나나요(연령대별 구조) · ② 잠이 안 오고 얼굴이 화끈거릴 때(시간대별 증상 지도) · ③ 이 커뮤니티는 어떤 곳인가요(운영자 관점, 브랜드명 확정 후). **감정·가족**과 **병원·치료**는 **D+7로 이월** — 전자는 실회원 근거 0건, 후자는 의료 키워드 리스크 |
| 18 | **매거진 원문성 전략** | ✅ **정정 확정 (M3-OPS-9)** | 🔴 기존 우나어 MENOPAUSE 141건은 **원문성 근거로 쓰지 않는다** — 실회원 글 5건(3.5%)뿐이고 나머지는 봇 136·외부글 89다. "회원들이 말했다"는 **거짓 서술**이 된다. 문장 추출·직접 인용·외부글 재가공·봇 글의 회원 발화화 전부 금지. 원문성은 **데이터가 아니라 글의 구조와 운영자 관점**에서 확보한다 |
| 19 | **외부글 = voice 자산** | ✅ **창업자 확정 (M3-OPS-10, 2026-08-20)** | **"외부글은 실제 4050/5060 여성들의 목소리이므로 최고의 자산이다."** 직접 재사용은 금지하되 **장기 voice 자산으로 보존**한다. `CafePost` **31,501건**(AI 분석 29,312 · `ageSignal=50s` **18,221**)의 **비식별 메타**는 M3 장기 리서치 자산으로 쓸 수 있다. 🔴 **D-day에는 사용하지 않는다** — 아카이브 Sheet 생성·자동 export·원문/닉네임/URL 이관 전부 안 한다. D+30 이후 **M3 Voice Engine**(말투·오타·문장 호흡·감정선 체화 + 자동 재창조 + originality/risk gate + 자동 발행/HOLD/폐기)으로 발전시킨다. 목표는 창업자가 매번 검수하는 구조가 아니라 **자동 gate + 애매한 것만 보류**다. 상세 §16 |
| 20 | **D-day 변경 항목 수** | ✅ **상향 정정 (M3-OPS-11, 2026-08-20)** | M3-OPS-6 **18파일** → M3-OPS-6b **30항목** → M3-OPS-11 **38항목**. 신규 8종은 네이버 인증코드·애드센스 fallback·사업자 정보·CONTACT_EMAIL·앱 딥링크 5곳·child-safety·capacitor·android build.gradle이다. 이전 수치는 폐기가 아니라 **상향 정정**이다. 상세 §17 |
| 21 | **Android 앱 D-day 처리** | 🔔 **권고 — 창업자 확정 필요** | **D-day 범위에서 제외**를 권고한다. 스토어 심사로 24시간을 초과한다. 제외하면 N5·N7·N8이 필수에서 빠져 **38 → 35항목**이 된다. D-day에는 웹만 오픈하고 `manifest.json`의 앱 연결을 제거한다 |
| 22 | **사업자 정보 · 네이버 인증코드** | ✅ **확정 (M3-OPS-11)** | 🚫 `Footer.tsx:57-60`의 법인·대표·사업자번호·통신판매업·주소를 **복붙 금지**. placeholder(`M3_OPERATOR_LEGAL_NAME` 등 5종)로 관리하고 새 브랜드 기준 검토 후 입력한다. ⚠️ 통신판매업 신고가 도메인별인지 사업자별인지 **미확인**. 🚫 `layout.tsx:67`의 구 네이버 인증코드 2개 **유지 금지** — 새 도메인으로 Search Advisor 등록 후 신규값으로 교체한다. **실패해도 사이트는 정상 동작하므로 발견이 늦는다** |
| 23 | **M3 D-day runner 정책** | ✅ **확정 (OPS-RUNNER-1, 2026-08-20)** | active runner **42개**(GHA 26 + launchd 16). 🔴 **필수 재사용**: `ci.yml` 가드 5종 · `launchd-wrapper.mjs`(UNAO_WORKDIR 필수화) · `unao-prod-sync`(03:00 자동 pull). 🟡 **guard 후 활성화**: 봇 댓글 5경로(cafe-wave · sheet-viral · seed · seed-micro · daily 4task) — M3-BOT-6 22단계 완료 전 금지. 🔴 **분리 필수**: `agents-social`(SNS 토큰 전량 신규). 🚫 **제외**: `agents-jobs` · `coo:job-matcher`. 🔵 **검토**: `run-script` · `killer-post` · `design` · `weekly`. ⚠️ O1 stale 문제는 해소(launchd 16개 전부 unao-prod · 0 behind)됐으나 `unao-ops` 디렉터리가 140 behind로 잔존한다(참조 0건). 상세 §18 |
| 12 | **MENOPAUSE 실회원 글 봇 wave 수** | 확정 | D-day에도 글당 최대 2개. 단, 공통 safety guard, 같은 톤 반복 방지, 실회원 댓글 후 중단, 최근 20글 동일 페르소나 최대 2회 조건을 전제로 한다 |

---

## 11. 지금 하지 말아야 할 것

```
🚫 새 브랜드 실행 — 도메인 구매 · 계정 생성 · repo 생성 · 코드 작성
🚫 현재 서비스에 추가 SEO 변경 — 수집량이 하루 10건 안팎이라 검증 불가
🚫 네이버 수집 요청 연타 — 이미 3회 시도, 효과 없었음
🚫 기존 회원 데이터 이관 준비 — 개인정보 영역, 결정 전 착수 금지
🚫 "안 되니 다른 걸" 식 시행착오 — 변수가 섞이면 원인 규명 불가
🚫 HUMOR 대량 자동 발행 — ✅ **보류 확정 (창업자, 2026-08-20)**
   r370 검증으로 launchd 통합·출처 꼬리표 제거는 PASS. 기술적 막힘은 없다.
   그러나 네이버 생존 판정 전까지 창업자가 Sheet를 추가 조작하지 않기로 했다.
   → 현재 서비스 건이며 M3와 무관하다. 판정 후 재검토하며, 그때까지 반복 질의하지 않는다.
   → 재개하더라도 첫 반응 확인 후 제한 운영으로 간다
🚫 popular crawler 삭제 — 원인 규명 전 제거 금지 (기록은 남길 것)
```

---

## 12. 다음에 Claude가 이어서 할 일

**우선순위 순.** 창업자 지시가 있을 때만 착수한다.

1. **M3-1 Keep/Drop/Rewrite 확정** — §7 파일 단위 초안을 창업자와 함께 확정
2. **네이버 수집/색인 관찰 결과 반영** — 창업자가 확인한 Search Advisor 최신 자료를 기준으로 §9 판정만 업데이트
3. **M3-2 새 브랜드 IA 설계** — 홈·자유게시판·갱년기·매거진 상세 정보구조
4. **M3-BOT-5 봇 노출 guard 설계** — 글당 2개, 최근 20글 동일 페르소나 2회, 게시 후 10~60분 지연, 실회원 댓글 후 중단을 코드 정책으로 정리
5. **M3-BOT-6 D-day 구현 체크리스트** — scheduler L973/L1196, user-post-wave, wave-processor skip 패턴, BotLog details, 첫 30명 배정까지 구현 순서 확정
6. **M3-3 외부글 운영 정책** — 발행 상한·승인 절차·비율 목표 수치화
7. **M3-5 인프라 분리 계획** — 계정·리소스 목록화 (창업자 결정 불필요, 단독 진행 가능)

### 지금 바로 할 일과 하지 않을 일

| 구분 | 항목 | 판단 |
|---|---|---|
| **지금 함** | M3-1 파일 단위 Keep/Drop/Rewrite 정리 | 대기 중 해도 변수를 만들지 않고, D-day 실행 시간을 줄인다 |
| **지금 함** | 새 브랜드 IA/콘텐츠/봇/인프라의 빈칸 파악 | 실행이 아니라 설계다. 생존 보험의 핵심이다 |
| **창업자 자료 오면 함** | 네이버 최신 관찰값 문서 반영 | Search Advisor 확인은 창업자가 수시로 하고 있으므로 Claude/Codex가 반복 요청하지 않는다 |
| **지금 안 함** | 현재 서비스 SEO 코드·sitemap·robots·canonical·noindex 변경 | 다음 수집/색인 판정 전에는 변수만 늘어난다 |
| **지금 안 함** | 새 도메인 구매·계정 생성·repo 생성·인프라 생성 | 회복 불가 판정 전 실행 금지 |
| **지금 안 함** | 기존 도메인 리다이렉트·대량 삭제·검색 제외 요청 | 생존 판정 전에는 되돌리기 어려운 조치다 |

### 병행 가능한 현재 서비스 작업

```
- HUMOR 제한 운영 여부 판단 (r370 검증 PASS. 대량 자동 재개가 아니라 첫 반응 확인 후 1~3건 단위)
- cook82 큐 상태 동기화 스크립트 (SENT_TO_SHEET → PUBLISHED 대조)
- Vercel 비용 절감 효과 측정 (PR #392 반영 후 다음 청구서)
```

---

## 13. D-day 준비를 위해 아직 부족한 것

현재 문서는 전략 방향과 창업자 확정 원칙을 담았지만, 아직 **24시간 안에 새 브랜드 MVP를 개설**하기에는 부족하다.
다음 항목은 M3-1 이후 반드시 채워야 한다.

| 영역 | 부족한 내용 | 다음 작업 |
|---|---|---|
| 브랜드 | 새 브랜드명 후보, 금지어, 도메인 후보 기준 | 은은한 여성 커뮤니티 이름 후보군 작성 |
| 제품 | ~~MVP route, 게시판별 역할~~ → ✅ **M3-OPS-4에서 확정** (§14-1). 남은 것은 홈 첫 화면 구성뿐 | 게시판 3개(MENOPAUSE·STORY·MAGAZINE) 확정. `/community/talk` = `STORY` enum 재사용. 홈 화면 구성은 M3-2에서 계속 |
| 인프라·DB | ~~Supabase 초기화 절차~~ → ✅ **M3-OPS-7/7b에서 확보** (§14-5~14-8) | DDL 46/46 생성 실증 · 1회 전용 · AdminAccount 절차 확인. 남은 것은 **로컬 리허설 수단 부재**뿐 |
| 콘텐츠 | 초기 7일 발행 계획, 외부글 20건 구성, 매거진 첫 주제 | M3-3 콘텐츠 운영 정책으로 확정 |
| 봇/페르소나 | 첫 세트 30명 설계 PASS, D-day 확정 분포 50대 19명·40대 후반 6명·60대 5명, 갱년기 봇 댓글 허용, 갱년기 실회원 글도 글당 최대 2개, 최근 20글 노출 guard, 실회원 KPI 6종 | M3-BOT-1/2/3/3b/4 기준을 문서화함. 다음은 같은 톤 반복 방지, 노출 guard 세부 설계, D-day 구현 체크리스트 |
| 코드 | 복사할 모듈, 삭제할 모듈, 다시 쓸 모듈 | M3-1 Keep/Drop/Rewrite를 파일 단위로 확장 |
| 인프라 | GitHub, Vercel, Supabase, Kakao, Google, Sheet 생성 순서 | M3-5 인프라 분리 계획으로 확정 |
| SEO | 새 도메인 sitemap/robots/canonical/noindex 초기 정책 | M3-4 SEO reset 전략으로 확정 |
| 기존 콘텐츠 | 살릴 글 선별 기준, Sheet 보존 구조, 오리지널리티 강화 방식 | 재활용 큐 설계 |
| 기존 회원 | 카카오톡 재가입 안내 문구, 발송 대상, 발송 시점 | D-day launch checklist에 포함 |
| 런칭 | 시간대별 작업 순서, 검증 체크리스트, 실패 시 중단 기준 | M3-6 launch checklist로 확정 |

이 섹션은 실행 지시가 아니다. 네이버 생존 판정 대기 시간에 하나씩 채워서,
회복 불가 판정이 났을 때 판단과 실행을 같은 날 끝낼 수 있게 만드는 준비 항목이다.

---

## 14. D-day IA · DB 초기화 (M3-OPS-4 / 7 / 7b, 2026-08-20)

> **판정: D-day IA 확정 · DB 초기화 경로 확보.**
> 핵심 발견은 **"D-day IA에 코드 변경이 거의 필요 없다"** 는 것이다.
> 게시판 노출은 enum이 아니라 **`BoardConfig` row 존재 여부**로 결정되므로,
> row를 안 만들면 그 게시판은 404가 된다(`getBoardConfig`에 fallback 없음).

### 14-1. 창업자 확정 — D-day 게시판 구조 (2026-08-20)

**① 글쓰기 게시판은 3개다**

| # | boardType | 고객 URL | 역할 |
|---|---|---|---|
| 1 | **MENOPAUSE** | `/community/menopause` | **갱년기 핵심판** — 새 브랜드의 시작점 |
| 2 | **STORY** | **`/community/talk`** | **자유게시판** — 사는이야기·유머·돈·노후·수다를 전부 흡수 |
| 3 | **MAGAZINE** | `/magazine` | **매거진** — 브랜드 정체성 콘텐츠 |

```
베스트는 별도 게시판이 아니라 노출/랭킹 화면이다. BoardConfig row를 만들지 않는다.
HUMOR · LIFE2 · WEEKLY · JOB 은 BoardConfig row를 만들지 않는다.
기존 사는이야기 · 웃음방 · 2막준비 · 수다 · 돈 · 노후 · 유머는 자유게시판으로 흡수한다.
```

**② 자유게시판 URL = `/community/talk`, 내부 enum은 `STORY` 재사용**

```
✅ 고객 URL   /community/talk
✅ 내부 enum  STORY (기존 값 그대로)
🚫 TALK enum 추가 금지

근거
  · 빈 DB DDL에 BoardType 7값이 이미 전부 포함된다(init-ddl.sql:20)
    'JOB','STORY','HUMOR','MAGAZINE','WEEKLY','LIFE2','MENOPAUSE'
  · TALK 추가는 전례상 16파일 변경 + ALTER TYPE DB 작업이 든다
    (MENOPAUSE 도입 커밋 102aaf49 실측)
  · 효과는 0 — STORY로 동일하게 달성된다
  · M3-2 확정 원칙("고객 URL은 /community/talk, 내부 enum은 STORY 재사용")과 일치

⚠️ 구현 지점: BOARD_REGISTRY의 STORY 행 slug를 'stories' → 'talk' 로 변경한다.
   slug는 sitemap · prewarm · revalidatePath · URL prefix가 전부 파생되는 SSoT다.
```

**③ 매거진은 D-day에 연다 — 단 첫날 3~5개 글이 전제다**

```
매거진 글은 단순 콘텐츠가 아니라 새 브랜드 정체성을 보여주는 공식 콘텐츠여야 한다.
요건: 네이버 AI가 인용하기 쉽고, Google SEO에도 걸릴 수 있도록
      원문성 · 구체성 · 서비스 정체성을 담는다.
⚠️ 3~5개가 준비되지 않으면 빈 매거진이 되어 오히려 신뢰를 떨어뜨린다.
   콘텐츠 확보가 D-day 매거진 오픈의 선행 조건이다.
```

**④ `/jobs`는 D-day에 `notFound()`로 임시 차단한다**

```
🚫 D-day에 삭제하지 않는다
이유: /jobs는 BoardConfig와 무관한 최상위 라우트이고(BOARD_REGISTRY isCommunity:false),
      JobDetail 모델과 34파일이 JOB을 참조한다.
      즉시 삭제하면 빌드 · 타입 · 라우팅 리스크가 크다.

D-day    /jobs · /jobs/[id] · /jobs/region/[sido] 에서 notFound() 반환
D+7~D+30 참조 전수 조사 후 완전 제거 검토

⚠️ notFound()는 영구 유지가 아니라 첫날 사고 방지용 안전 차단막이다.
```

**⑤ 게시판 표시명 — 브랜드명 확정 전 임시명**

```
MENOPAUSE  갱년기톡  또는  갱년기 이야기
STORY      자유게시판
MAGAZINE   매거진

⚠️ 최종 표시명은 브랜드명 확정 후 조정한다(§10 결정 2 종속).
   단 row 구조와 categories는 지금 확정된 것을 쓴다.
```

### 14-2. BoardConfig 최소 seed 표 (D-day 3행)

| # | boardType | 고객 URL | displayName(임시) | description | categories | writeGrade | isActive | hot/fame | D-day |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **MENOPAUSE** | `/community/menopause` | 갱년기톡 | 갱년기를 지나는 우리 또래의 이야기 | `나만 이런가요` `몸의 변화` `완경·호르몬` `마음의 변화` `가족·관계` | `SPROUT` | `true` | 기본값 유지 | ✅ 필수 |
| 2 | **STORY** | **`/community/talk`** | 자유게시판 | 무슨 이야기든 편하게 | `가입인사` `건강` `가족` `돈·노후` `고민` `자유수다` | `SPROUT` | `true` | 기본값 유지 | ✅ 필수 |
| 3 | **MAGAZINE** | `/magazine` | 매거진 | 우리 또래를 위한 읽을거리 | `전체` `건강` `돈·노후` `생활정보` | `SPROUT` | `true` | 기본값 유지 | ✅ 필수 |
| — | HUMOR · LIFE2 · WEEKLY · JOB | — | — | — | — | — | — | — | ❌ **row 미생성** |

**categories 변경점 (기존 `seed.ts` 대비)**

```
STORY     '취미' → '돈·노후' 로 교체 — LIFE2(2막준비) 폐기분을 카테고리로 흡수
MAGAZINE  '재테크'·'여행' → '돈·노후' 로 통합 — 초기 빈 카테고리를 만들지 않는다
MENOPAUSE 기존 5개 그대로 재사용
          ⚠️ sheet-board-routing.test.ts:50이 '나만 이런가요'를 기본값으로 고정 중

writeGrade = SPROUT   신규 가입자가 첫날 바로 글을 쓸 수 있어야 한다
hot(10)/fame(50)      첫날 트래픽에서 도달할 일이 없다. 튜닝은 D+30
```

### 14-3. 🚫 기존 `prisma/seed.ts`를 D-day에 절대 실행하지 않는다

| 문제 | 위치 | 새 브랜드 오염 |
|---|---|---|
| **LIFE2 row** | `seed.ts:17-20` `2막준비` | 🔴 폐기 게시판이 `isActive=true`로 노출 |
| **WEEKLY row** | `:23-26` `수다방` | 🔴 이미 숨김 처리한 보드가 부활 |
| **JOB row** | `:29-32` `내 일 찾기` | 🔴 폐기한 일자리 전략이 메뉴에 등장 |
| **HUMOR row** | `:11-14` `웃음방` | 🟡 자유게시판 흡수 대상인데 별도 판이 열림 |
| **user.upsert** | `:82` | 🔴 테스트 유저가 실제 회원 목록에 |
| **post.create** | `:147` | 🔴 샘플 글이 고객 화면에 노출 |
| **jobDetail.create** | `:166` | 🔴 폐기한 일자리 데이터 |
| **comment.create ×6** | `:216-238` | 🔴 샘플 댓글(삭제된 댓글 케이스 포함) |
| **구 브랜드 게시판명** | 전 row | 🔴 `사는이야기`·`웃음방`·`2막준비` |

**7개 row 중 4개가 폐기 대상이고 유저·글·댓글 샘플이 함께 들어간다.**

### 14-4. D-day 최소 seed 스크립트 설계

```
scripts/seed-m3-minimal-board-config.ts   (신규 · D-day에 작성)

기존 seed.ts를 수정하지 않는 이유
  ① seed.ts는 현재 서비스 자산이다 — 우나어가 생존하면 계속 쓴다
  ② D-day에 원본을 고치면 되돌릴 기준이 사라진다
  ③ prisma.config.ts의 seed 설정이 seed.ts를 가리킨다 — 건드리면 부작용

설계
  · DIRECT_URL 우선 (pooler 6543 아님) — create-admin.ts:11과 동일 패턴
  · BoardConfig 3행만 upsert (where: { boardType } — @unique)
  · upsert여야 하는 이유: displayName·categories 조정이 D-day에 여러 번 필요할 수 있다
    DDL은 1회 전용이지만 seed는 재실행이 안전해야 한다
  🚫 prisma db seed 금지(prisma-guide:5) → npx tsx 로 직접 실행
```

**검증 쿼리**

```sql
-- 실행 전 (DDL 직후)
SELECT count(*) FROM "BoardConfig";        -- 기대: 0

-- 실행 후
SELECT "boardType","displayName","isActive",array_length("categories",1)
FROM "BoardConfig" ORDER BY "boardType";   -- 기대: 3행 (MAGAZINE·MENOPAUSE·STORY)
-- 🔴 JOB·WEEKLY·LIFE2·HUMOR이 있으면 잘못된 seed를 돌린 것
```

```bash
curl -sI NEW_APP_URL/community/menopause   # 200
curl -sI NEW_APP_URL/community/talk        # 200
curl -sI NEW_APP_URL/community/humor       # 404 (정상)
curl -sI NEW_APP_URL/jobs                  # 404 (notFound 차단)
```

**실패 시 중단 기준**

```
1. BoardConfig 행 수 != 3              → 중단, 스크립트 확인
2. 폐기 보드가 1행이라도 생성됨         → 중단, 잘못된 seed 실행
3. /community/menopause 가 404         → 중단, isActive 또는 slug 확인
4. 글쓰기 시 "카테고리 유효하지 않음"   → categories 불일치 (posts.ts:83)
```

### 14-5. 빈 Supabase DB 초기화 절차 (M3-OPS-7 / 7b 실증)

**1단계 — DDL 생성 (DB 접속 없음, 실행 검증 완료)**

```bash
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > init.sql
```

⚠️ **`--to-schema-datamodel`은 Prisma 7에서 제거됐다.** `--to-schema`가 올바른 플래그다.

**실측 결과 (2026-08-20)**

```
1,503줄 / 49,096 bytes
CREATE TABLE 46  ← schema.prisma 46모델과 정확히 일치 (46/46)
CREATE TYPE  36 (enum)
CREATE INDEX 99 + UNIQUE INDEX 36
FOREIGN KEY  34 · PRIMARY KEY 46

✅ migrations에 없던 9모델도 전부 포함됨
   AdminQueue · DailyBrief · HomeCurationOverride · Notice · Popup
   PushSubscription · SocialPost · VoteBallot · VoteEvent

✅ Supabase 전용 의존 0건
   CREATE EXTENSION 0 · auth. 0 · storage. 0 · SECURITY DEFINER 0 · supabase 0
   → 순수 PostgreSQL. 어떤 Postgres에도 이식 가능하다
```

**2단계 — Node.js pg 모듈로 실행** (prisma-guide:6 원칙 준수 · DIRECT_URL 5432)

**3단계 — 검증**

```sql
-- 실행 전: 빈 DB 확인 (필수)
SELECT count(*) FROM information_schema.tables
WHERE table_schema='public' AND table_type='BASE TABLE';   -- 기대: 0
-- 🔴 0이 아니면 실행 중단. 빈 DB가 아니다

-- 실행 후
SELECT count(*) FROM information_schema.tables
WHERE table_schema='public' AND table_type='BASE TABLE';   -- 기대: 46
SELECT count(*) FROM pg_type t JOIN pg_namespace n ON t.typnamespace=n.oid
WHERE n.nspname='public' AND t.typtype='e';                -- 기대: 36
SELECT count(*) FROM information_schema.table_constraints
WHERE table_schema='public' AND constraint_type='FOREIGN KEY';  -- 기대: 34
```

**4단계** — `npx prisma generate` → `npx tsc --noEmit`

### 14-6. 🔴 DDL은 1회 전용이다 (멱등성 0건 — 실측)

| 구문 | 멱등 | 전체 |
|---|---|---|
| `CREATE TABLE IF NOT EXISTS` | **0** | 46 |
| `CREATE TYPE IF NOT EXISTS` | **0** | 36 |
| `CREATE INDEX IF NOT EXISTS` | **0** | 99 |
| `DO $$` 블록 | **0** | — |
| `BEGIN`/`COMMIT` 트랜잭션 | **0** | — |

```
재실행하면 첫 CREATE TYPE "Role" 에서 42710(duplicate_object) 즉시 실패한다.
트랜잭션이 없으므로 중간 실패 시 일부 테이블만 생성된 상태로 남는다.

⚠️ prisma-guide:7("신규 SQL은 멱등적으로 작성")과 충돌한다.
   migrate diff 출력은 프로젝트 원칙을 따르지 않는다.
```

**🚫 실패 시 같은 SQL을 재실행하지 않는다. 복구는 아래 둘 중 하나다.**

```
A(권장)  새 Supabase project를 재생성하고 처음부터
         → 데이터가 없는 project이므로 재생성 비용이 가장 낮다
B        DROP SCHEMA public CASCADE; CREATE SCHEMA public; 후 재실행
         → 빠르지만 DROP은 되돌릴 수 없다. 새 DB에만 허용
```

**재실행 금지 조건**

```
1. 실행 전 테이블 수 != 0
2. _prisma_migrations 테이블이 이미 존재
3. 이전 실행이 중간 실패 → DROP SCHEMA 또는 project 재생성 없이 재시도 금지
4. 기존 데이터가 1행이라도 있는 DB
```

### 14-7. 관리자 계정 생성 (M3-OPS-7b — 절차 이미 존재)

```bash
npx tsx scripts/create-admin.ts <이메일> <닉네임> <비밀번호>
```

```
모델    AdminAccount { email @unique · passwordHash · nickname · role }
해시    bcrypt (bcryptjs) · saltRounds=12
        생성 create-admin.ts:34  bcrypt.hash(password, 12)
        검증 admin-auth.ts:35    bcrypt.compare(...)
전제    .env.local 에 DIRECT_URL 설정 (새 Supabase)
검증    새 도메인 /admin/login 로그인 성공

⚠️ 비밀번호는 대화·문서에 남기지 않는다. 창업자가 직접 입력한다.
⚠️ create-admin.ts:19 예시 이메일이 admin@unao.com (구 브랜드) — 실행 시 새 도메인 사용
⚠️ 중복 이메일은 실패 처리다(멱등 아님)
```

**관리자 계정 없이 최소 오픈이 가능한가 — 조건부 가능**

```
가능    홈 · 게시판 · 글 상세 · 카카오 로그인 · 글쓰기 · 댓글
막힘    /admin/** 전체 — 신고 처리 · 회원 관리 · 배너/광고 · 공지 · 팝업
        투표 이벤트 · 홈 큐레이션 · BoardConfig 수정
→ 오픈은 되지만 운영이 불가능하다. D-day 필수로 본다.
```

### 14-8. D-day DB 실행 순서 요약

```
1. 새 Supabase project 생성 (창업자)
2. npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > init.sql
3. 실행 전 검증: 테이블 수 0 확인
4. Node pg 모듈로 init.sql 실행 (DIRECT_URL)   ← 1회 전용
5. 실행 후 검증: 46 / 36 / 34
6. npx prisma generate → npx tsc --noEmit
7. npx tsx scripts/seed-m3-minimal-board-config.ts   ← BoardConfig 3행
8. seed 검증: 3행 확인
9. npx tsx scripts/create-admin.ts <이메일> <닉네임> <비밀번호>
10. /admin/login 로그인 검증
```

### 14-9. 아직 미확정 (추정하지 않음)

| 항목 | 왜 미확정인가 | 확인 방법 |
|---|---|---|
| 로컬 리허설 수단 | psql · docker 없음. 설치 금지 | 창업자에게 Postgres/Docker 설치 요청 |
| 최종 게시판 표시명 | 브랜드명(§10 결정 2) 종속 | 브랜드명 확정 후 |
| 매거진 첫날 3~5글 주제 | 콘텐츠 기획 미착수 | M3-3 콘텐츠 운영 정책 |
| `create-admin.ts:5`의 `[WATCH] 2주 모니터링` | 무슨 감시였는지 불명 | `git log -S "WATCH" -- scripts/create-admin.ts` |
| 2단계(pg로 DDL 실행) 실측 | 로컬 DB 부재로 리허설 불가 | 리허설 수단 확보 후 |

⚠️ **로컬 리허설 부재의 위험도는 낮아졌다.** 멱등성이 없다는 사실이 확정되면서
**"실패하면 project를 다시 만든다"** 는 단순 복구 경로가 생겼기 때문이다.

### 14-10. 우나어 생존 시에도 가져갈 개선 backlog

> 📌 **이 절은 원본이다. 전체 24건 통합 관리는 §19를 본다.**

```
1. 🔴 재해 복구 절차 문서화 — 현재 DB 소실 시 46모델 복원 절차가 없었다
      → §14-5~14-8이 그 절차다. 현재 서비스에도 그대로 적용된다
2. 🔴 migration 파일과 실제 스키마 9모델 불일치 — 이력 추적이 불완전
3. 🟡 seed.ts가 운영 데이터(BoardConfig)와 테스트 데이터(유저·글·댓글)를 섞고 있다
4. 🟡 BoardConfig 단일 장애점 — fallback 없음. 비면 전 게시판 404
5. 🟡 prisma-guide가 Prisma 7 이전 기준 — prisma.config.ts 도입 미반영,
      제거된 플래그(--to-schema-datamodel)가 문서에 남아 있을 수 있다
6. 🟡 create-admin.ts 예시 이메일이 admin@unao.com — 실제 도메인과 불일치
7. 🟢 BOARD_REGISTRY는 잘 설계된 자산이다 — slug·sitemap·prewarm이 여기서 파생된다
```

---

## 15. D-day 매거진 전략 (M3-OPS-8 / 9, 2026-08-20)

> **판정: 주제 확정 · 단 원문성 전략은 정정됨.**
> M3-OPS-8이 세운 "기존 회원 데이터 활용" 전략은 M3-OPS-9 실측으로 **폐기**됐다.
> 원문성은 **데이터가 아니라 글의 구조와 운영자 관점**에서 확보한다.

### 15-1. 🔴 M3-OPS-9 실측 — 기존 141건은 원문성 근거가 될 수 없다

```
MENOPAUSE 141건 구성 (2026-04-06 ~ 2026-08-19, 실측)
  source      SHEET 89 (63%, 외부 퍼온 글) · BOT 47 (33%, 시드봇) · USER 5 (4%)
  작성자      봇 계정 136 / 실회원 5
  카테고리    완경·호르몬 40 · 몸의 변화 34 · 나만 이런가요 23
              마음의 변화 17 · (없음) 21 · 가족·관계 6

주제별 실회원 근거
  A 시기(시작/끝/완경)   전체 58 | SHEET 31 · BOT 25 · 실회원  2
  B 몸(잠/열감/체중)     전체 56 | SHEET 36 · BOT 17 · 실회원  3
  C 감정·가족            전체 36 | SHEET 23 · BOT 13 · 실회원 🔴 0
```

**실회원 글이 3.5%다. "회원들이 말하길"이라고 쓰면 실제로는 봇이 쓴 글을 인용하게 된다.**
이것은 개인정보 문제가 아니라 **거짓 서술** 문제다.

**활용 불가 사유 4가지**

```
① 거짓 서술 위험 (최대)   실회원 3.5%. "회원들이"는 사실이 아니다
② 저작권                  SHEET 89건은 외부글이다. 원저작자가 우리가 아니며
                          82cook 약관·저작권은 "미확인, risk accepted" 상태다
③ 순환 참조               BOT 47건은 우리가 만든 것이다.
                          그걸 "커뮤니티에서 나온 이야기"로 인용하면 자기참조다
④ 브랜드 독립성            창업자 확정 "기존 회원 데이터 이관 없음"과 실질 충돌
```

### 15-2. 전략 정정 — 폐기와 대체

| | M3-OPS-8 (폐기) | M3-OPS-9 이후 (확정) |
|---|---|---|
| 원문성 출처 | 🔴 ~~우리 회원의 실제 표현·시기 분포~~ | ✅ **글의 구조 + 운영자 관점** |
| 필수 3번 | 🔴 ~~감정·가족관계~~ | ✅ **이 커뮤니티는 어떤 곳인가요** |
| 병원·치료 글 | 🟡 선택 4 | ✅ **D+7로 확정 이월** |

### 15-3. D-day 필수 매거진 3개 (정정 확정)

**① 갱년기, 언제 시작해서 언제 끝나나요 — 40대 후반부터 60대까지 시기별로**

```
검색 의도   topic-menopause.ts ④축 (폐경·완경)
네이버 실적  "갱년기 끝나는 나이" 30위 (실측, §172) — 세 키워드 중 최고
키워드      갱년기 끝나는 나이 · 갱년기 시작 나이 · 완경 나이 · 폐경 몇 살

🟢 원문성   연령대별 구조 — 40대 후반 / 50대 초중반 / 50대 후반 / 60대를
            각각 소제목으로 분해한다.
            기존 갱년기 글 대부분이 "평균"만 말한다.
            타겟 3개 연령대를 전부 커버하는 글은 흔치 않다.

AI 인용 문장 "갱년기는 보통 45세 전후에 시작해 평균 49~52세에 완경을 지나고,
             이후 3~5년간 증상이 이어집니다. 다만 시작과 끝은 사람마다 크게 다릅니다."
피할 표현    "당신은 지금 ○기입니다" (진단 단정)
guard       의료 용어 없음 → M3-BOT-3 hasMedicalTerm 회피 ✅
```

**② 잠이 안 오고 얼굴이 화끈거릴 때 — 갱년기 몸의 변화, 나만 그런 게 아닙니다**

```
검색 의도   ③축 (몸의 변화)
네이버 실적  "갱년기 소변 냄새" 34위 — 몸 변화 계열이 이미 잡히고 있다
키워드      갱년기 불면 · 안면홍조 · 식은땀 · 체중 증가 · 갱년기 증상

🟢 원문성   시간대별 증상 지도 — 새벽 / 아침 / 낮 / 밤으로 나눠
            언제 어떤 증상이 나타나는지 정리한다.
            의학 글은 증상을 나열하지만 "언제"를 다루지 않는다.
            생활 밀착 서술이 병원 블로그와의 차별점이다.

AI 인용 문장 "안면홍조·식은땀·불면·체중 변화는 갱년기에 가장 흔한 증상입니다.
             증상이 있다고 해서 모두 치료가 필요한 것은 아니며,
             일상에 지장이 있을 때 전문의와 상의하는 것이 일반적입니다."
피할 표현    "○○을 드시면 좋아집니다" · 특정 제품명·병원명
guard       hasMedicalTerm(증상어) 있으나 givesAdvice 없음 → 통과 ✅
정체성       "나만 그런 게 아니다"는 North Star 문장 그 자체다
```

**③ 이 커뮤니티는 어떤 곳인가요 — 40대 중반부터 60대까지, 우리 이야기를 나누는 곳**

```
검색 의도   브랜드 탐색 — "브랜드명 + 커뮤니티" 직접 검색
키워드      (브랜드명) · 40대 여성 커뮤니티 · 50대 여성 커뮤니티 · 갱년기 커뮤니티

🟢 원문성   창업자·운영자의 문제의식과 새 브랜드 정체성.
            1인칭 서술이라 누구도 흉내낼 수 없다.

AI 인용 문장 "(브랜드명)은 40대 중반부터 60대 중반 여성이 갱년기를 비롯한
             삶의 변화를 나누는 커뮤니티입니다.
             정보 제공보다 '나만 그런 게 아니구나'를 확인하는 것을 목적으로 합니다."

⚠️ 브랜드명 확정 후 최종 작성한다(§10 결정 2 종속).
🔴 이 글이 필수인 이유: /about이 D-day에 비공개될 수 있다(§14 관련 결정).
   그러면 "이 서비스가 무엇인가"를 말하는 곳이 매거진뿐이다.
```

### 15-4. D+7로 미루는 2개

| 주제 | 미루는 이유 |
|---|---|
| **감정·가족관계** (②축) | 🔴 **실회원 근거 0건.** 첫날에 억지로 쓰면 일반론이 되어 우나어 실패 패턴(262건 → 클릭 5)을 반복한다 |
| **병원·치료 선택** (①축) | 🔴 의료·치료·호르몬 키워드 리스크가 크다. 키워드 특이도는 최상위지만 **첫날 브랜드 톤은 커뮤니티 정체성 중심이어야 한다.** M3-BOT-3에서 의료 guard를 공들여 설계해놓고 매거진 첫 글이 병원 이야기면 앞뒤가 맞지 않는다 |

### 15-5. 🚫 기존 141건에서 사용 금지 목록

```
🚫 문장 추출
🚫 직접 인용
🚫 닉네임 · URL · 날짜 · 구체 사연
🚫 외부글(SHEET 89건) 재가공
🚫 봇 글(BOT 47건)을 회원 발화처럼 표현
🚫 실회원 5건 인용 — 5명뿐이라 사실상 특정 가능(개인정보)
🚫 "우리 회원들은" 표현
🚫 141건을 새 브랜드로 복사·이관
```

### 15-6. ✅ 사용할 수 있는 표현 원칙

```
"이 커뮤니티가 다루려는 문제는…"
"40대 후반부터 60대 여성이 자주 마주하는 변화는…"
"우리는 정보를 넘어, 나만 그런 게 아니라는 감각을 만들고자 한다"

⚠️ 단 기존 우나어 데이터를 근거처럼 쓰지 않는다.
   위 문장들은 운영자의 문제의식 서술이지 데이터 주장이 아니다.
```

### 15-7. 하면 안 되는 콘텐츠 (매거진 공통)

```
🚫 의료 과장          "갱년기 완치" · "증상이 사라집니다" · "효과가 검증된"
🚫 치료·약물 단정      "호르몬제를 드세요" · "이 영양제가 좋습니다"
                      ⚠️ M3-BOT-3 의료 guard와 동일 기준을 매거진에도 적용한다
🚫 병원·영양제 광고 톤  특정 병원명 · 제품명 · 가격 언급
                      ⚠️ AG 비교분석왕이 MENOPAUSE에서 제외된 이유와 같다
🚫 얕은 SEO 짜깁기     우나어 262건 → 클릭 5 의 재현. §165 "적게, 길게, 원본으로"
🚫 진단명 사용         "우울증" → "감정 기복" / "골다공증입니다" → "뼈 건강"
🚫 외부글 재가공       매거진은 운영자 공식 콘텐츠다
🚫 대량 AI 생성        3건을 사람이 검수한다
🚫 "시니어·어르신·노인·실버"  브랜드 금지어
🚫 일자리 언급         전략 폐기 확정
```

### 15-8. 매거진이 D-day에 필요한 이유

```
① 네이버 AI 인용 대상이 된다
   커뮤니티 글은 "저만 이런가요?"라 인용할 문장이 없다.
   매거진만이 "~입니다" 형태의 인용 가능한 서술을 제공한다

② 검색 유입의 첫 진입점이 된다
   새 도메인은 색인 0에서 시작한다
   [추정] 커뮤니티 글 20건보다 잘 쓴 매거진 3건이 먼저 잡힌다
   근거: 우나어 GSC 실측에서 매거진 262건이 노출 82를 만들었다(§169)

③ 서비스 정체성을 검색엔진에 선언한다
   /about이 D-day에 비공개될 수 있다 → 매거진 ③이 유일한 설명이 된다

④ 빈 커뮤니티의 첫인상을 방어한다  ← 가장 실질적
   D-day에 회원 글은 0건이고 봇도 D+1~D+3이다.
   첫날 콘텐츠는 외부글 20건 + 매거진 3건뿐이다.
   매거진이 없으면 순수 외부글 사이트로 보인다
```

### 15-9. 아직 미확정 (추정하지 않음)

| 항목 | 왜 미확정인가 | 확인 방법 |
|---|---|---|
| 매거진 글 작성 주체 | 창업자 직접 / Claude 초안+검수 / 외부 — 미결 | 창업자 결정 |
| 실회원 5건의 콘텐츠 활용 동의 | 이용약관상 활용 범위 미검토 | `terms/page.tsx` 검토 |
| SHEET 89건의 원 출처별 분포 | 82cook / bboom / navercafe 비율 미집계 | 저작권 판단에 영향 |
| 매거진 1건 적정 분량 | §165가 "길게"라 했으나 구체 기준 없음 | 기존 매거진 262건 평균 길이 조회 |
| ②축(감정·관계) 네이버 검색 순위 | ③④축 실적만 있고 ②축은 미측정 | Search Advisor 확인 |
| 카테고리 분포 집계 사용 가부 | 인용은 아니나 출처가 외부글 63%라 애매 | 창업자 판단 |

---

## 16. 외부글 리서치 자산 · M3 Voice Engine (M3-OPS-10, 2026-08-20)

> **창업자 확정 (2026-08-20)**
> **"외부글은 실제 4050/5060 여성들의 목소리이므로 최고의 자산이다."**
>
> 외부글을 위험물로만 다루지 않는다. **직접 재사용은 금지하되, 장기 voice 자산으로 보존한다.**
> 그대로 발행할 원고가 아니라, **실제 4050/5060 여성의 고민·말투·감정·반응을 담은 voice 자산**이다.

### 16-1. 두 층위를 구분한다 — Post(발행물) vs CafePost(리서치)

M3-OPS-9의 "141건은 못 쓴다"는 결론은 **발행된 `Post`** 에 대한 것이다.
`CafePost`는 완전히 다른 층위이며, **비식별 분석 메타는 사용 가능하다.**

| 층위 | 대상 | 규모 | D-day | 장기 |
|---|---|---|---|---|
| **발행물 `Post`** | MENOPAUSE 141건 | 실회원 5건(3.5%) | 🔴 **매거진 근거로 사용 금지** (§15-1) | 변동 없음 |
| **리서치 `CafePost`** | 외부 카페 수집 원문 + AI 분석 메타 | **31,501건** | 🔴 **사용하지 않음** | 🟢 **D+30 voice 자산** |

**두 결론은 충돌하지 않는다.** §15는 "발행된 글을 인용하지 마라"이고,
§16은 "수집 원문의 **비식별 패턴**은 장기 자산이다"이다.

### 16-2. M3-OPS-10 실측 — 자산 규모

```
CafePost          총 31,501건
AI 분석 완료      29,312건 (93%)
isUsable          24,638건

연령 신호 (ageSignal)
  50s  18,221   ← 🔴 새 브랜드 1순위 타겟 데이터가 이미 1.8만 건
  60s   5,375
  unknown 5,582 · 70s+ 86 · 40s 40 · 30s 4

욕구 분류 (desireCategory)
  MONEY 3,910 · HEALTH 3,772 · HOBBY 3,536 · FAMILY 3,353
  FOOD 1,871 · ENTERTAIN 1,741

글의 성격 (communitySignal)
  question 10,683 · complaint 7,488 · celebration 4,730
  recommendation 4,352 · confession 1,868

바이럴 구조 (viralType)
  INJUSTICE 3,167 · EMPATHY 2,104 · BETRAYAL 811 · CONTROVERSY 227
긴급도 (urgencyLevel)  1:12,758 · 2:5,590 · 3:6,073 · 4:4,392 · 5:441
```

**`psych-analyzer`가 이미 추출 중인 비식별 메타 15종**

```
desireCategory · desireType · psychInsight · urgencyLevel · communitySignal
ageSignal · emotionTags · topics · sentiment · qualityScore · killerScore
conflictTrigger · betrayalFactor · emotionalPeak · viralType

⚠️ sentiment 필드는 현재 비어 있다(미채움). 원인 미확인
```

**만들어야 할 자산이 아니라 이미 있는 자산이다.** 새로 만들 게 아니라 **분리해서 꺼내 쓰면 된다.**

### 16-3. A. D-day에는 하지 않는 것 🔴

```
🚫 아카이브 Sheet 생성하지 않음
🚫 자동 export 구현하지 않음
🚫 원문 · 닉네임 · URL · 이미지 이관하지 않음
🚫 외부글 직접 재사용하지 않음
🚫 CafePost 테이블을 새 브랜드로 복사하지 않음

D-day 매거진 3건은 §15-3 확정안대로 쓴다. 이 자산 없이도 작성 가능하다.
성급히 쓰면 "퍼온 글 재가공 사이트"라는 첫인상을 스스로 만든다.
```

### 16-4. B. D+30 이후 설계할 것 — M3 Voice Engine

> 목표는 **단순 분석표가 아니다.**
> 실제 4050/5060 여성의 **말투·오타·문장 호흡·감정선·주제 흐름**을 체화한 **재창조 엔진**이다.
> 창업자가 매번 검수하는 구조가 아니라,
> **자동 생성 + 자동 gate + 애매한 것만 보류**하는 구조가 목표다.

```
[ ] 비식별 메타 기반 아카이브 (원문 미포함)
[ ] voice profile — 연령대·욕구·상황별 화법 프로파일
[ ] 말투 · 오타 · 문장 호흡 학습
      문장 길이 분포 · 말끝 패턴 · 이모지 사용률 · 줄바꿈 습관
      ⚠️ 특정 문장 학습이 아니라 통계적 특성 학습이다
[ ] 주제 · 감정 · 반응 패턴 학습
      어떤 주제에 어떤 감정이 붙고 어떤 댓글이 달리는가
[ ] 자동 재창조 — 주제와 화법만 취하고 문장은 100% 새로 생성
[ ] originality gate — 원문 유사도 검증. 임계 초과 시 폐기
[ ] risk gate — 민감도 · urgencyLevel · viralType 기준 자동 차단
[ ] 자동 발행 / HOLD / 폐기 기준
      PASS → 자동 발행 · 애매 → HOLD(사람) · FAIL → 폐기
[ ] 창업자 개입 최소화 — HOLD만 사람이 본다

⚠️ gate 구조는 새로 만들 필요가 없다.
   agents/cook82의 3레이어(수집 L1 / 판정 L2 / 전달 L3) + review.ts 사람 gate가
   이미 검증된 패턴이다. 그대로 재사용한다.
```

### 16-5. C. 절대 금지 🔴

```
🚫 닉네임 · URL · 날짜 · 이미지 재사용
🚫 특정 사연이 식별될 수준의 요약
   ⚠️ conflictTrigger("며느리가 아이를 멀리하는 상황") · emotionalPeak
      ("기가 막혀서 말이 안 나왔어요")는 사연 요약에 가깝다.
      분석 DB에는 두되 콘텐츠 재료로는 쓰지 않는다
🚫 새 브랜드 회원이 말한 것처럼 표현
   → 외부 카페 회원이다. "우리 회원이 말했다"는 거짓 서술이다
🚫 D-day에 이 자산을 성급히 사용
🚫 원문 그대로 복사해 새 브랜드 콘텐츠로 발행
🚫 문장 일부만 변형해 재사용 — 재작성이 아니라 표절이다
```

### 16-6. D. 장기적으로 가능한 것 🟢

```
✅ 비식별 메타 집계
✅ 주제 빈도 분석
✅ 50대 여성 관심사 map        ← ageSignal=50s 18,221건이 근거
✅ 매거진 주제 후보 도출
✅ 봇 tone 검증                 M3-BOT-4 30명의 speech_patterns 검증용
✅ 자유게시판 시드 글감 선정
✅ M3 Voice Engine 학습 자산화
```

**전환 gate (D+30 설계 기준)**

| 전환 유형 | 조건 | 산출물 | 위험 |
|---|---|---|---|
| **매거진** | `question` + 같은 주제 **10건 이상** 반복 + 민감도 하·중 | 주제만 취하고 **100% 새로 작성** | 🟢 개별 글이 아니라 **패턴**이 입력값 |
| **자유게시판 시드** | `urgencyLevel ≤ 2` + 민감도 하 + celebration/recommendation | 봇 페르소나가 자기 경험으로 새로 씀 | 🟡 원문 유사도 검증 필요 |
| **봇 톤 참고** | 전체 | 말투·길이·호흡 통계만 | 🟢 문장을 가져오지 않는다 |
| **🔴 사용 금지** | 민감도 상 · `urgencyLevel 5` · `BETRAYAL`/`CONTROVERSY` | — | 🔴 |

**"10건 규칙"** — 개별 글 1건 → 매거진 1건은 재가공이다.
같은 주제 10건 이상이 모여야 "패턴 관찰"이 성립한다.
이것이 §15의 *"구조와 관점으로 원문성 확보"* 를 실행 가능하게 만든다.

⚠️ 서술은 **"우리 회원이"가 아니라 "우리가 관찰한 것"** 이어야 한다.

### 16-7. 아카이브 컬럼 설계 (D+30 · 스펙만 확정)

| 구분 | 컬럼 |
|---|---|
| **최소** | `id` · `sourceType`(유형화) · `ageSignal` · `desireCategory` · `communitySignal` · `urgencyLevel` · `topicTags` · `emotionTags` |
| **추천(사람 판정)** | `주제요약`(**20자 이내 · 고유명사 금지**) · `전환후보` · `금지사유` · `민감도` · `승인` · `승인자` · `승인일` |
| 🚫 **금지** | 원문제목 · 원문본문 · 본문발췌 · 닉네임 · 원문URL · 원문작성일 · 댓글 전문 · `psychInsight` · `conflictTrigger` · `betrayalFactor` · `emotionalPeak` · 이미지 URL |

⚠️ **`주제요약`이 최대 위험점이다.** "갱년기 불면 고민"은 안전하지만
"며느리가 아이를 멀리해 서운함"은 사연이다. **20자 제한 + 고유명사 금지**를 규칙으로 둔다.

### 16-8. 우나어가 생존해도 이 전략이 유효한 이유

```
1. 🔴 외부글 의존 리스크 감소
   SHEET 발행글 2,945건 중 cook82 1,564(53%) · navercafe 1,164(40%) = 93%
   두 곳이 막히면 공급이 절반 끊긴다
   → 리서치 아카이브가 있으면 "주제"는 남고 "원문"만 갈아끼울 수 있다
   ⚠️ image-router DAY_CAP · navercafe/bboom 공급 중단은 이미 발생한 현재진행형 리스크다

2. 🔴 저작권 리스크 축소
   현재는 원문을 발행한다. 아카이브 방식은 주제만 쓴다
   ⚠️ cook82 약관·저작권은 여전히 "미확인, risk accepted" 상태다

3. 🟡 오리지널 매거진 강화
   262건 → 클릭 5의 실패는 주제 선정이 데이터 기반이 아니었을 가능성
   → ageSignal=50s 18,221건이 주제 근거가 된다

4. 🟡 봇 tone 개선 — 실제 4050/5060 여성 언어 통계를 봇 검증에 쓸 수 있다

5. 🟢 장기 SEO 자산화 — 퍼온 글은 중복 콘텐츠지만 오리지널은 자산이다
```

### 16-9. 아직 미확정 (추정하지 않음)

| 항목 | 왜 미확정인가 | 확인 방법 |
|---|---|---|
| `CafePost` 비식별 메타 사용 승인 | 브랜드 독립성 관점의 창업자 판단 필요 | §10 결정 |
| cook82 이용약관 | "risk accepted" 상태 유지 중 | 약관 검토 |
| `sentiment` 필드 미채움 원인 | psych-analyzer 미구현 추정 | 코드 확인 |
| `dlxogns01`(9,760) · `remonterrace`(8,316) 카페 정체 | `cafeId`만 있고 실제 카페명 미확인 | `agents/cafe/config.ts` |
| "10건 규칙"의 저작권 안전성 | 실무 판단이며 **법률 자문이 아니다** | 필요 시 전문가 검토 |
| 기존 Sheet 전체 컬럼 스펙 | A~H열 사용만 확인 | Sheet 직접 확인 |

---

## 17. D-day 변경 지점 최종 매니페스트 (M3-OPS-11, 2026-08-20)

> **판정: PARTIAL — D-day 필수 항목을 38로 상향 정정한다.**
>
> ⚠️ **이 절은 브랜드명·도메인이 미확정인 상태에서 "무엇을 지금 준비할 수 있는가"와
> "무엇을 아직 못 닫았는가"를 확정한 것이다.**

### 17-1. 항목 수 상향 이력 (이력 보존 — 이전 수치를 지우지 않는다)

```
M3-OPS-6    D-day 필수 18파일   (env·레이아웃·핵심페이지·법적·next.config)
M3-OPS-6b   D-day 필수 30항목   (+ 하드코딩 6 · 자산 4 · 설정 2)
M3-OPS-11   D-day 필수 38항목   ← 🔴 신규 8종 발견으로 상향 정정

⚠️ M3-OPS-6b의 "30항목"은 폐기가 아니라 **M3-OPS-11에서 38항목으로 상향 정정**된 것이다.
   30항목 자체는 여전히 유효하며, 그 위에 8종이 추가됐다.
```

**38항목 내역**

```
코드 파일        24 + 8 = 32
이미지 자산       4   (og-cover · og-image · logo · logo-symbol)
설정 파일         2   (manifest.json · assetlinks.json)
────────────────────────
합계             38
```

### 17-2. 🔴 M3-OPS-11 신규 발견 8종

| # | 파일:라인 | 현재 값 | placeholder | 누락 시 장애 |
|---|---|---|---|---|
| **N1** | `src/app/layout.tsx:67` | `'naver-site-verification': ['f3e97b22…', 'dd29f33d…']` | `M3_NAVER_SITE_VERIFICATION` | 🔴 **네이버 Search Advisor 소유 확인 실패.** 네이버 유입이 핵심인데 등록 자체가 막힌다. **빌드·화면 모두 정상이라 당일 발견되지 않는다** |
| **N2** | `src/app/layout.tsx:66` | `?? 'ca-pub-4117999106913048'` | `M3_ADSENSE_CLIENT_ID` | 🟡 구 애드센스 계정으로 광고 수익이 귀속된다 |
| **N3** | `src/components/layouts/Footer.tsx:57-60` | 케이에이지랩(K-Agelab) · 대표 김용석 · 사업자등록번호 457-24-01157 · 통신판매업 제2023-서울서초-2160호 · 주소 | `M3_OPERATOR_LEGAL_NAME` `M3_REPRESENTATIVE_NAME` `M3_BUSINESS_REGISTRATION_NUMBER` `M3_ECOMMERCE_REGISTRATION` `M3_BUSINESS_ADDRESS` | 🔴 **법적 표기다.** 통신판매업 신고가 도메인별인지 사업자별인지 확인 필요 |
| **N4** | `src/components/layouts/Footer.tsx:18` | `korea.age.not.matter@gmail.com` | `M3_CONTACT_EMAIL` | 🟡 문의가 구 브랜드 메일로 간다 |
| **N5** | `src/lib/app-links.ts:5,66` · `AppDeepLinkHandler.tsx:17` · `app-login/bridge/route.ts:8` · `auth/error/AppAuthErrorRedirect.tsx:11` | `com.agenotmatter.app://` | `M3_APP_ID` | 🟡 앱 미출시면 무해. 출시 시 딥링크 실패 |
| **N6** | `src/app/child-safety/page.tsx:19,20,53,68` | 도메인 · 앱ID · 이메일 · 운영자명 | 전부 | 🔴 **앱 스토어 심사 대상 문서.** 구 정보면 심사 반려 |
| **N7** | `capacitor.config.ts:14,15,17` | `appId` · `appName` · `server.url` | `M3_APP_ID` `M3_BRAND_NAME` `M3_DOMAIN` | 🟡 앱 D-day 제외 시 무관 |
| **N8** | `android/app/build.gradle:4,7` | `namespace` · `applicationId` = `com.agenotmatter.app` | `M3_APP_ID` | 🟡 동일 |

⚠️ **N1이 가장 위험하다.** 나머지는 눈에 보이거나 기능이 깨지지만, N1은 **에러 없이 조용히 실패**한다.

### 17-2b. ⚠️ 이 절이 존재하는 이유 — M3-OPS 감사 결과의 문서화 공백

```
M3-OPS-1 (인프라 감사) · M3-OPS-2 (env 매트릭스) · M3-OPS-3 (치환 파일 목록)
M3-OPS-6 (라인 단위 매니페스트) · M3-OPS-6b (잔여 미확정 해소)
→ 이 5개 감사는 수행됐으나 **문서에 직접 반영된 적이 없다**(2026-08-20 확인).
   결과가 대화에만 남아 있어, 세션이 바뀌면 D-day에 라인 번호를 다시 찾아야 했다.

§17은 그 공백을 메우는 **실행 매니페스트**다.
D-day 구현자가 이 절만 보고 손을 움직일 수 있어야 한다.
```

### 17-2c. 38항목 라인 단위 변경 매니페스트

**분류: 웹 D-day 필수 35 + Android D+30 이월 3 = 38**

범례 — `브전`=브랜드명 확정 전 가능 · `도후`=도메인 확정 후 가능 · `당일`=D-day 당일 필요

#### A. 시스템 기반 — env·SEO fallback (5항목)

| # | 파일 | 라인/패턴 | 현재 값 | placeholder | 브전 | 도후 | 당일 | 누락 시 장애 | 검증 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `src/lib/env.ts` | **83** | `optionalEnv('SEARCH_CONSOLE_SITE_URL', 'https://age-doesnt-matter.com')` | `M3_DOMAIN` | ✅ | ✅ | ✅ | 🔴 **새 브랜드 검색 데이터가 죽은 속성으로.** 에러 없이 실패 | `grep -c age-doesnt-matter src/lib/env.ts` → 0 |
| 2 | `src/lib/env.ts` | **117** | `optionalEnv('NEXT_PUBLIC_APP_URL', 'https://age-doesnt-matter.com')` | `M3_DOMAIN` | ✅ | ✅ | ✅ | 🔴 sitemap·robots·canonical·breadcrumb 전부 구 도메인 | 동일 |
| 3 | `src/app/sitemap.ts` | **13** | `const BASE_URL = … ?? 'https://age-doesnt-matter.com'` | `M3_DOMAIN` | ✅ | ✅ | ✅ | 🔴 sitemap 전체가 구 도메인 URL | `curl -s $URL/sitemap.xml \| grep -c age-doesnt-matter` → 0 |
| 4 | `src/app/robots.ts` | **12** | `` `${… ?? 'https://age-doesnt-matter.com'}/sitemap.xml` `` | `M3_DOMAIN` | ✅ | ✅ | ✅ | 🔴 robots가 구 sitemap을 가리킴 | `curl -s $URL/robots.txt` |
| 5 | `src/lib/seo/breadcrumb.ts` **6** · `src/components/common/Breadcrumbs.tsx` **12** | 각 1곳 | 동일 fallback | `M3_DOMAIN` | ✅ | ✅ | ✅ | 🟡 JSON-LD breadcrumb이 구 도메인 | `curl \| grep BreadcrumbList` |

⚠️ **권장 조치**: `env.ts:83,117`을 `requireEnv`로 승격하면 3·4·5의 fallback이 전부 무력화된다.
`breadcrumb.ts:3` 주석은 *"BASE_URL은 여기 한 곳에서만 관리"* 라고 하지만 **실제로는 5곳**이다.

#### B. 전역 레이아웃·메타 (9항목)

| # | 파일 | 라인 | 현재 값 | placeholder | 브전 | 도후 | 당일 | 누락 시 장애 | 검증 |
|---|---|---|---|---|---|---|---|---|---|
| 6 | `layout.tsx` | **52** | `default: '우리 나이가 어때서 — 40대 50대 여성 커뮤니티'` | `M3_BRAND_NAME` | ❌ | — | ✅ | 🔴 모든 페이지 `<title>` | `curl \| grep -o '<title>[^<]*'` |
| 7 | `layout.tsx` | **53** | `template: '%s \| … : 우리 나이가 어때서'` | `M3_BRAND_NAME` | ❌ | — | ✅ | 🔴 하위 페이지 title | 동일 |
| 8 | `layout.tsx` | **56** | `metadataBase: new URL(… ?? 'https://age-doesnt-matter.com')` | `M3_DOMAIN` | ✅ | ✅ | ✅ | 🔴 상대 OG 경로가 구 도메인으로 절대화 | `curl \| grep og:url` |
| 9 | `layout.tsx` | **60** | `siteName: '우리 나이가 어때서'` | `M3_BRAND_NAME` | ❌ | — | ✅ | 🔴 OG site_name | `curl \| grep og:site_name` |
| 10 | `layout.tsx` | **61** | `images: [{ url: '/og-cover.png', … alt: '우리 나이가 어때서 — …' }]` | `M3_BRAND_NAME` | ❌ | — | ✅ | 🟡 OG alt | `curl \| grep og:image` |
| 11 | `layout.tsx` | **64** | `google: process.env.NEXT_PUBLIC_GSC_VERIFICATION` | `M3_GOOGLE_SITE_VERIFICATION` | ❌ | ✅ | ✅ | 🔴 GSC 소유 확인 실패 | GSC 콘솔 확인 |
| 12 | `layout.tsx` | **66** | `?? 'ca-pub-4117999106913048'` | `M3_ADSENSE_CLIENT_ID` | ✅ | — | ✅ | 🟡 **구 애드센스로 수익 귀속** | `curl \| grep adsense-account` |
| 13 | `layout.tsx` | **67** | `'naver-site-verification': ['f3e97b22…','dd29f33d…']` | `M3_NAVER_SITE_VERIFICATION` | ❌ | ✅ | ✅ | 🔴🔴 **네이버 소유 확인 실패. 조용히 실패한다** | Search Advisor 소유확인 |
| 14 | `layout.tsx` | **119** | `<link rel="preconnect" href="https://img.age-doesnt-matter.com" />` | `M3_IMAGE_DOMAIN` | ✅ | ✅ | ✅ | 🟡 불필요 DNS 조회 | `curl \| grep preconnect` |

#### C. 헤더·푸터·사업자 정보 (5항목)

| # | 파일 | 라인 | 현재 값 | placeholder | 브전 | 도후 | 당일 | 누락 시 장애 | 검증 |
|---|---|---|---|---|---|---|---|---|---|
| 15 | `Header.tsx` | **16** | `aria-label="우나어 홈"` | `M3_BRAND_NAME` | ❌ | — | ✅ | 🟢 스크린리더만 | `grep -c 우나어` → 0 |
| 16 | `GNB.tsx` | **46** | `aria-label="우나어 홈"` | `M3_BRAND_NAME` | ❌ | — | ✅ | 🟢 동일 | 동일 |
| 17 | `Footer.tsx` | **50** | `&copy; 2026 우리 나이가 어때서` | `M3_BRAND_NAME` | ❌ | — | ✅ | 🟡 전 페이지 하단 노출 | `curl \| grep -c 우리 나이가` → 0 |
| 18 | `Footer.tsx` | **18, 64, 65** | `CONTACT_EMAIL = 'korea.age.not.matter@gmail.com'` | `M3_CONTACT_EMAIL` | ✅ | — | ✅ | 🟡 문의가 구 메일로 | `curl \| grep mailto` |
| 19 | `Footer.tsx` | **57, 60** | 케이에이지랩(K-Agelab) · 대표 김용석 · 사업자등록번호 457-24-01157 · 통신판매업 제2023-서울서초-2160호 · 서울 노원구 월계로55길 15 | `M3_OPERATOR_LEGAL_NAME` `M3_REPRESENTATIVE_NAME` `M3_BUSINESS_REGISTRATION_NUMBER` `M3_ECOMMERCE_REGISTRATION` `M3_BUSINESS_ADDRESS` | ❌ | — | ✅ | 🔴 **법적 표기.** 복붙 금지(§17-5②) | 육안 + 법적 검토 |

#### D. 핵심 페이지·JSON-LD (7항목)

| # | 파일 | 라인 | 현재 값 | placeholder | 브전 | 도후 | 당일 | 누락 시 장애 | 검증 |
|---|---|---|---|---|---|---|---|---|---|
| 20 | `(main)/page.tsx` | **161,162,165,186,187,208** | Organization/WebSite `name`·`alternateName`·`description`·`<h1 sr-only>` | `M3_BRAND_NAME` | ❌ | — | ✅ | 🔴 JSON-LD 브랜드 | `curl \| grep -A5 Organization` |
| 21 | `(main)/page.tsx` | **163,164,188,192** | `url`·`logo`·`searchAction target` fallback | `M3_DOMAIN` | ✅ | ✅ | ✅ | 🔴 JSON-LD URL | 동일 |
| 22 | `(main)/page.tsx` | **178** | `'https://blog.naver.com/age-doesnt-matter'` (`sameAs`) | 제거 또는 신규 | ✅ | — | ✅ | 🔴 **[추정]** 검색엔진이 구 브랜드와 동일 주체로 연결 | `curl \| grep -A3 sameAs` |
| 23 | `(main)/page.tsx` | **179** | `play.google.com/…id=com.agenotmatter.app` (`sameAs`) | `M3_APP_ID` 또는 제거 | ✅ | — | ✅ | 🟡 구 앱 연결 | 동일 |
| 24 | `[postId]/page.tsx` | **35** | `const BASE_URL = … ?? 'https://age-doesnt-matter.com'` | `M3_DOMAIN` | ✅ | ✅ | ✅ | 🔴🔴 **모든 글 canonical이 구 도메인 → 색인 전면 제외** | `curl <글> \| grep canonical` |
| 25 | `[postId]/page.tsx` | **104, 201** | `siteName:` · `publisherName: '우리 나이가 어때서'` | `M3_BRAND_NAME` | ❌ | — | ✅ | 🔴 글 상세 OG·JSON-LD | 동일 |
| 26 | `opengraph-image.tsx` | **4, 16, 104, 108** | `alt` · 기본 title · **픽셀 텍스트** · **픽셀 도메인** | `M3_BRAND_NAME` `M3_DOMAIN` | ❌ | ✅ | ✅ | 🔴 **카톡 공유 이미지에 구 브랜드·도메인. 캐시되면 회수 불가** | 브라우저로 이미지 직접 열람 |

#### E. 라이브러리 하드코딩 (4항목)

| # | 파일 | 라인 | 현재 값 | placeholder | 브전 | 도후 | 당일 | 누락 시 장애 | 검증 |
|---|---|---|---|---|---|---|---|---|---|
| 27 | `src/lib/app-links.ts` | **45** | `const APP_HOST = 'age-doesnt-matter.com'` | `M3_DOMAIN` | ✅ | ✅ | ✅ | 🟡 앱 딥링크 판정 실패 | `grep -c age-doesnt-matter` → 0 |
| 28 | `src/lib/hero-link.ts` | **26** | `const SITE_HOST = 'age-doesnt-matter.com'` | `M3_DOMAIN` | ✅ | ✅ | ✅ | 🔴 **HERO 배너 내부링크 판정 실패 → 외부 이탈** | 배너 클릭 테스트 |
| 29 | `src/lib/sanitize.ts` | **160, 180** | `img.age-doesnt-matter.com` 정규식 2곳 | `M3_IMAGE_DOMAIN` | ✅ | ✅ | ✅ | 🔴 **본문 이미지 프록시 미작동 → 이미지 깨짐** | 본문 이미지 렌더 확인 |
| 30 | `src/lib/actions/contact.ts` | **42** | `from: 'noreply@age-doesnt-matter.com'` | `M3_DOMAIN` | ✅ | ✅ | ✅ | 🔴 **문의 메일 발송 실패**(도메인 미인증) | 문의 폼 실제 발송 |

#### F. 법적·정책 페이지 (4항목)

| # | 파일 | 패턴 | 건수 | placeholder | 브전 | 도후 | 당일 | 누락 시 장애 | 검증 |
|---|---|---|---|---|---|---|---|---|---|
| 31 | `(main)/terms/page.tsx` | `우나어`·`우리 나이가 어때서`·`케이에이지랩` | **8건** (7,8,20,28,45,65,71,92…) | `M3_BRAND_NAME` `M3_OPERATOR_LEGAL_NAME` | ❌ | ✅(canonical) | ✅ | 🔴 **실제와 다른 서비스명·사업자로 동의 취득** | `curl /terms \| grep -c 우나어` → 0 |
| 32 | `(main)/privacy/page.tsx` | 동일 | **15건** (7,8,19,21,27,39,99,111,214…) | `M3_BRAND_NAME` `M3_CONTACT_EMAIL` | ❌ | ✅ | ✅ | 🔴 동일 | `curl /privacy \| grep -c` → 0 |
| 33 | `(main)/about/page.tsx` | 동일 + 도메인 | **10건** (50,167,175,183,191,199,207,225…) | `M3_BRAND_NAME` `M3_DOMAIN` | ❌ | ✅ | 🔔 | 🟡 **재작성 필요.** D-day 비공개 선택지 있음 | `curl /about` |
| 34 | `src/app/child-safety/page.tsx` | **13,19,20,53,68** | 도메인·앱ID·이메일·운영자명 | `M3_DOMAIN` `M3_APP_ID` `M3_CONTACT_EMAIL` `M3_OPERATOR_NAME` | ❌ | ✅ | ✅ | 🔴 **앱 스토어 심사 대상 문서. 구 정보면 반려** | `curl /child-safety` |

#### G. 설정·자산 (7항목)

| # | 대상 | 라인/내용 | 현재 값 | placeholder | 브전 | 도후 | 당일 | 누락 시 장애 | 검증 |
|---|---|---|---|---|---|---|---|---|---|
| 35 | `next.config.js` | **41** `remotePatterns` | `hostname: 'img.age-doesnt-matter.com'` | `M3_IMAGE_DOMAIN` | ✅ | ✅ | ✅ | 🔴 **next/image가 400 거부 → 이미지 전량 깨짐** | 썸네일 렌더 |
| 36 | `next.config.js` | **115** CSP | `img-src … https://img.age-doesnt-matter.com` | `M3_IMAGE_DOMAIN` | ✅ | ✅ | ✅ | 🔴 브라우저 CSP 차단 | DevTools 콘솔 violation 0 |
| 37 | `next.config.js` | **67, 71** `redirects()` | `www.age-doesnt-matter.com` → 구 도메인 · `age-doesnt-matter.vercel.app` → 구 도메인 | 교체(67) / **제거**(71) | ✅ | ✅ | ✅ | 🔴🔴 **www 접속이 죽은 사이트로 튕김. 오픈 실패** | `curl -sI https://www.$DOMAIN/` |
| 38 | `public/og-cover.png` · `og-image.png` | 동일 파일 (md5 `30daac63…`) | **"우리나이가어때서" 로고+텍스트가 픽셀로 박힘** (실물 확인) | 재제작 | ❌ | — | ✅ | 🔴 **카톡·페북 공유에 구 브랜드 이미지** | 이미지 직접 열람 |
| 39 | `public/logo.png` · `logo-symbol.png` | 동일 파일 (md5 `cc2e1888…`) | **"우리나이가어때서" 텍스트 포함** (실물 확인) | 재제작 | ❌ | — | ✅ | 🔴 JSON-LD logo · 헤더 로고 | 동일 |
| 40 | `public/manifest.json` | `name`·`short_name`·`related_applications` | `"우리나이가어때서"` · `com.agenotmatter.app` | `M3_BRAND_NAME` / 앱 연결 제거 | ❌ | — | ✅ | 🔴 **PWA 홈화면 이름이 구 브랜드** | `curl /manifest.json` |
| 41 | `public/.well-known/assetlinks.json` | `package_name`·지문 | `com.agenotmatter.app` | 앱 제외 시 **파일 제거** | ✅ | — | ✅ | 🟡 구 Android 앱 연결 | `curl /.well-known/assetlinks.json` |

⚠️ **번호 41 vs 항목 35 — 세는 단위가 다르다.**

```
위 표 A~G의 행(변경 지점)   41행   ← D-day에 손댈 실제 위치. 구현자는 이 41행을 본다
M3-OPS-6b 기준 "항목"       35항목 ← 파일·자산 단위로 묶은 수
  코드 파일 24 + 신규 5(웹) + 이미지 자산 4 + 설정 2 = 35
Android 이월(H)              3항목
────────────────────────────────────
전체                        38항목  (§17-1의 상향 정정 수치)

즉 "38항목"은 파일·자산 단위이고, "41행"은 라인 단위다.
⚠️ D-day 체크는 **41행 기준**으로 한다. 항목 단위로 세면 한 파일 안의
   여러 라인(예: layout.tsx 9곳)을 빠뜨릴 수 있다.
```

#### H. 🔵 Android D+30 이월 (3항목) — §17-5① 권고 적용 시 D-day 제외

| # | 파일 | 라인 | 현재 값 | placeholder | 웹 D-day | 비고 |
|---|---|---|---|---|---|---|
| A1 | `src/lib/app-links.ts` **5,66** · `AppDeepLinkHandler.tsx` **17** · `app-login/bridge/route.ts` **8** · `auth/error/AppAuthErrorRedirect.tsx` **11** | 5지점 | `com.agenotmatter.app://` · `PLAY_STORE_BASE` | `M3_APP_ID` | ❌ 제외 | 앱 미출시면 무해 |
| A2 | `capacitor.config.ts` | **14, 15, 19** | `appId` · `appName` · `server.url` | `M3_APP_ID` `M3_BRAND_NAME` `M3_DOMAIN` | ❌ 제외 | 파일 주석에 **"PoC ONLY — NOT for production"** 명시 |
| A3 | `android/app/build.gradle` | **4, 7** | `namespace` · `applicationId` | `M3_APP_ID` | ❌ 제외 | 스토어 재등록 필요 |

```
전체        38항목
웹 D-day    35항목  (A~G)
Android     3항목   (H) → D+30 이월
```

### 17-3. placeholder 목록 (브랜드명 확정 전 사용)

```
M3_BRAND_NAME                      서비스명
M3_DOMAIN                          도메인
M3_APP_NAME                        앱 표시명
M3_APP_ID                          앱 패키지 ID (com.agenotmatter.app 대체)
M3_OPERATOR_NAME                   운영 주체 표기
M3_CONTACT_EMAIL                   문의 이메일

── 법적 표기 (N3) ──
M3_OPERATOR_LEGAL_NAME             법인명
M3_REPRESENTATIVE_NAME             대표자명
M3_BUSINESS_REGISTRATION_NUMBER    사업자등록번호
M3_ECOMMERCE_REGISTRATION          통신판매업 신고번호
M3_BUSINESS_ADDRESS                사업장 주소

── 콘솔 발급 (도메인 확정 후) ──
M3_NAVER_SITE_VERIFICATION         네이버 Search Advisor 인증코드
M3_GOOGLE_SITE_VERIFICATION        Google Search Console 인증코드
M3_ADSENSE_CLIENT_ID               애드센스 pub-id
```

### 17-4. 브랜드명 없이 지금 준비 가능한 것 🟢

```
[ ] 치환 매니페스트 38항목 확정        ← 이 절
[ ] env 매트릭스 확정                  §17-6
[ ] 콘솔 등록 체크리스트               §17-7
[ ] DDL 생성 리허설                    migrate diff는 DB 접속 없음 (§14-5 실증)
[ ] BoardConfig 3행 seed 스크립트 초안  displayName 제외 (§14-2)
[ ] AdminAccount 절차 확인             create-admin.ts 존재 (§14-7)
[ ] 매거진 ①② 초고 작성               브랜드명 불필요 (§15-3)
[ ] IA 확정                            §14-1 완료
[ ] 봇 guard 22단계 설계               M3-BOT-6 완료
[ ] AUTH_SECRET · ADMIN_JWT_SECRET 생성  openssl rand — 브랜드 무관
[ ] 사업자 정보 유지 여부 결정          §17-5 권고 ②
[ ] 브랜드 색상 유지 여부 결정          #FF6F61 유지 시 PWA 아이콘 10개 재사용
[ ] Android 앱 D-day 제외 결정          §17-5 권고 ①
```

**브랜드명 없이도 D-day 준비의 약 70%를 지금 끝낼 수 있다.**

### 17-5. 창업자 결정 · 권고 3건

**① Android 앱은 D-day 범위에서 제외한다 (권고)**

```
근거   스토어 심사로 24시간을 초과한다
       manifest.json related_applications · assetlinks.json ·
       capacitor.config.ts · android/build.gradle 이 전부 구 앱을 가리킨다
조치   D-day에는 웹만 오픈. manifest에서 앱 연결 제거
효과   N5 · N7 · N8 이 D-day 필수에서 빠진다 (38 → 35항목)
```

**② 사업자 정보는 기존 우나어 정보를 복붙하지 않는다 (확정)**

```
🚫 Footer.tsx:57-60을 그대로 복사 금지
   법인·대표·사업자번호·통신판매업 신고번호·주소는 법적 표기다
✅ placeholder로 관리하고, 새 브랜드 기준으로 검토 후 입력한다
⚠️ 통신판매업 신고가 도메인별인지 사업자별인지 확인이 필요하다 (미확인)
```

**③ 네이버 사이트 인증 코드는 신규값으로 교체한다 (확정)**

```
🚫 layout.tsx:67의 기존 코드 2개를 유지 금지
✅ 새 도메인으로 Naver Search Advisor 사이트를 등록한 뒤
   발급받은 신규 코드로 교체한다
⚠️ 이 순서를 지키지 않으면 소유 확인이 실패하고,
   실패해도 사이트는 정상 동작하므로 발견이 늦는다
```

### 17-6. env 매트릭스 보강 (M3-OPS-2 대비 신규 2건)

```
🔴 절대 재사용 금지 — 기존 8 + 신규 2
기존 8   SEARCH_CONSOLE_SITE_URL · NEXT_PUBLIC_APP_URL · SITE_URL
         NEXT_PUBLIC_GA4_ID · GA4_PROPERTY_ID · NEXT_PUBLIC_GTM_ID
         GOOGLE_SERVICE_ACCOUNT_JSON · SHEETS_SCRAPER_ID
신규 2   🔴 NEXT_PUBLIC_GSC_VERIFICATION   (layout.tsx:64 — M3-OPS-2 미포착)
         🔴 NEXT_PUBLIC_ADSENSE_CLIENT_ID  (layout.tsx:66 — 구 pub-id fallback)

⚠️ GHA Secrets는 62개다 (실측). 새 repo 전략이면 전량 재등록이 필요하다.
```

### 17-7. 외부 콘솔 4단계 분류

| 콘솔 | 지금 준비 | 브랜드 후 | 도메인 후 | D-day 당일 |
|---|---|---|---|---|
| GitHub repo | 전략 결정 | — | — | repo 생성 + **Secrets 62개** |
| Supabase | 스키마 준비 ✅ | — | — | project + DDL + seed |
| Vercel | — | — | — | project + 도메인 + env |
| Kakao app | 필요 정보 정리 | 앱 이름 | redirect URI | 앱 생성 + 키 발급 |
| **Naver Search Advisor** | — | — | 사이트 등록 | 🔴 **인증코드 → `layout.tsx:67`** |
| **Google Search Console** | — | — | 속성 추가 | 🔴 **인증코드 → env** |
| GA4 / GTM | — | — | — | 속성 + 측정 ID |
| R2 bucket | 분리 여부 결정 | — | 커스텀 도메인 | 버킷 + 토큰 |
| Slack | 채널 수 결정 | 채널명 | — | 채널 생성 |
| **Android TWA** | 🔔 **D-day 제외 권고** | — | — | (제외 시 없음) |

### 17-8. 🔴 D-day blocker (5건)

```
1. 브랜드명 + 도메인                    최우선. 나머지 대부분이 종속된다
2. naver-site-verification 신규 코드    도메인 후 콘솔에서만 발급
                                        ⚠️ 네이버 유입이 핵심인데 등록이 막힌다
3. 로컬 DB 리허설 수단 부재             psql·docker 없음. 설치 금지
                                        ⚠️ 단 "실패 시 project 재생성"으로 위험은 낮다(§14-6)
4. 사업자 / 통신판매업 정보 확인         법적 사안. 도메인별 재신고 여부 미확인
5. GHA Secrets 62개 재등록              repo 전략 종속
```

### 17-9. 하면 안 되는 것 (M3-OPS-11 보강)

```
🚫 구 네이버 인증 코드 유지             layout.tsx:67 — 조용히 실패한다
🚫 구 사업자 정보를 검토 없이 복붙       법적 표기다
🚫 구 앱 ID / 딥링크 유지               com.agenotmatter.app
🚫 Android 앱을 D-day 범위에 포함        스토어 심사로 24h 초과
🚫 구 애드센스 fallback 유지            layout.tsx:66 — 수익이 구 계정으로
🚫 child-safety 페이지를 구 정보로 방치  앱 심사 반려
🚫 브랜드명 확정 전 도메인 구매          창업자 판단 사항
🚫 판정 전 외부 콘솔 생성
```

### 17-10. 아직 미확정 (추정하지 않음)

| 항목 | 왜 미확정인가 | 확인 방법 |
|---|---|---|
| 통신판매업 신고가 도메인별인가 사업자별인가 | 법적 확인 필요 | 공정거래위원회 또는 관할 구청 |
| `naver-site-verification` 2개 중 유효한 것 | 둘 다 하드코딩돼 있으나 용도 불명 | Search Advisor 콘솔 |
| 애드센스 계정의 다중 사이트 허용 여부 | 같은 계정에 새 도메인 추가 가능한지 미확인 | 애드센스 콘솔 |
| Android 앱 제외 시 N5·N7·N8 무해성 | **[추정]** 앱 미출시 전제 | 앱 배포 계획 확정 후 |
| `public/images/logo.png` · `logo2.png` | 열람하지 않음 (M3-OPS-6b 이월) | 이미지 직접 확인 |

---

## 18. 운영 실행 경로 매니페스트 (OPS-RUNNER-1, 2026-08-20)

> **§17이 "코드 변경 지점"이라면, §18은 "실행 경로"다.**
> D-day에 GHA 26개와 launchd 16개를 각각 어떻게 할지 확정한다.

### 18-1. 현재 판정: **PASS — O1의 stale 실행 문제는 해소됐다**

```
✅ launchd 16개 전부 unao-prod 단일 경로
   WorkingDirectory · script · UNAO_WORKDIR · 로그 경로 전부 unao-prod
✅ unao-ops 참조 0건 · New_Claude_agenotmatter 참조 0건
✅ unao-prod 완전 동기
   브랜치 main · upstream origin/main · dirty 0 · 0 behind / 0 ahead
✅ launchctl 18개 전부 exit=0 (실패 이력 없음)
✅ 자동 sync — com.unao.unao-prod-sync 03:00 `git pull --ff-only`

⚠️ stale 잔재 1건
   unao-ops 디렉터리가 여전히 존재한다.
   브랜치 ops/main · main 대비 **140 behind** · 마지막 커밋 2026-07-30
   → plist 참조가 0건이라 **실행되지는 않는다**. 그러나 디렉터리가 남아 재발 여지가 있다.
   🚫 창업자 지시(O1)에 따라 삭제하지 않는다. 정리 여부는 창업자 결정 사항이다.
```

**"코드는 main에 있는데 실행은 다른 곳을 보는" 경로는 0건이다.**

### 18-2. active runner 총괄

```
GHA          26개 워크플로우 (스케줄 22 · 수동 전용 4)
launchd      16개 (실물 plist 기준, 전부 로드됨)
─────────────────────────────────
합계         42개 실행 경로
```

### 18-3. GHA 실행 경로 표 (26개)

| 워크플로우 | schedule | dispatch | 실행 대상 | write 등급 | **M3 판정** |
|---|---|---|---|---|---|
| `agents-daily.yml` | **45회** | Y | 17 task (§18-3b) | 🔴 DB write | **부분 guard 후 활성화** |
| `agents-cafe-hourly-curation.yml` | 20회 | Y | `content-curate` · `image-route` | 🔴 고객 발행 | 재사용 |
| `agents-cafe-wave.yml` | `*/5` | Y | `wave-process` · `user-post-wave-process` · `seed viral-waves` | 🔴 DB write(봇 댓글) | 🟡 **guard 후 활성화** |
| `agents-sheet-viral.yml` | `*/5` | Y | `seed viral-waves` | 🔴 DB write | 🟡 **guard 후 활성화** ⚠️ cafe-wave와 중복 |
| `agents-seed.yml` | 13회 | Y | `seed scheduler` | 🔴 DB write | 🟡 **guard 후 활성화** |
| `agents-seed-micro.yml` | 6회 | Y | `seed micro` | 🔴 DB write | 🟡 **guard 후 활성화** |
| `agents-scraper.yml` | 10회 | Y | `community sheet-scrape` | 🔴 고객 발행 | 재사용 |
| `agents-scraper-dawn.yml` | 8회 | Y | `cron/runner.ts` (인자 미확정) | 🔴 고객 발행 | 재사용 |
| `agents-cafe-popular-curation.yml` | 3회 | Y | `popular-curate` | 🔴 고객 발행 | 재사용 |
| `agents-cafe.yml` | 3회 | Y | `brief-monitor` · `daily-brief-fallback` · `evening-brief-safety` | 🟡 알림 | 재사용 |
| `agents-social.yml` | 11회 | Y | `cmo` 8 task (X·Threads·IG·FB·Ads) | 🔴 **외부 API write** | 🔴 **분리 필수** |
| `agents-jobs.yml` | 3회 | Y | `coo job-scraper` | 🔴 DB write | 🚫 **제외** (일자리 폐기) |
| `agents-moderation.yml` | 3회 | Y | `coo moderator` | 🔴 DB write | 재사용 |
| `agents-hourly.yml` | `19 */4` | Y | `cdo anomaly-detector` · `cto error-monitor` · `health-check` | 🟡 알림 | 재사용 |
| `agents-weekly.yml` | 4회 | Y | `cron/runner.ts` (인자 미확정) | 🟡 미확정 | 🔵 **검토** |
| `agents-killer-post.yml` | — | Y | `seed killer-post` | 🔴 고객 발행 | 🔵 **검토** |
| `agents-design.yml` | — | Y | `cron/runner.ts` (인자 미확정) | 🟡 미확정 | 🔵 **검토** |
| `admin-kpi-snapshot.yml` | 1회 | Y | `collect-dashboard-snapshot.ts` | 🟡 DB write(스냅샷) | 재사용 |
| `ops-daily-report.yml` | 1회 | Y | `ops-daily-report.ts` | 🟢 read-only | 재사용 |
| `prewarm-detail-pages.yml` | `17,47 * * * *` | Y | `curl` | 🟢 read-only | 재사용 |
| `push-scheduled.yml` | `*/5` | Y | `curl` | 🟡 알림 발송 | 재사용 |
| `quarantine-check.yml` | 주 1회 | Y | `curl` | 🟢 read-only | 재사용 |
| `post-deploy-qa.yml` | — | Y | `qa deploy-audit` · smoke · cron-links | 🟢 read-only | 재사용 |
| **`ci.yml`** | — | — | **가드 5종** | 🟢 read-only | 🔴 **필수 재사용** |
| `lighthouse.yml` | — | — | — | 🟢 | 재사용 |
| `run-script.yml` | — | Y | **임의 스크립트** | 🔴 임의 실행 | 🔵 **검토** |

#### 18-3b. `agents-daily.yml` 17 task

```
🔴 봇 댓글 — guard 후 활성화 (M3-BOT-6 22단계 대상)
   coo:comment-activator · coo:reply-chain-driver
   coo:author-reply-dryrun · coo:connection-facilitator

🔴 고객 발행 / DB write
   cafe_crawler:magazine-generate · coo:content-scheduler
   cmo:health-anxiety-responder · coo:trending-scorer(점수)

🚫 M3 제외
   coo:job-matcher

🟢 read / 알림
   cto:arch-review · cto:count-reconcile · cto:crawler-health
   cto:qa-verify · cto:security-audit · qa:content-audit
   ceo:approval-reminder · skip:skip(no-op)
```

#### 18-3c. `ci.yml` 가드 5종 — 🔴 M3 필수 재사용

```
scripts/check-cron-links.ts          runner ↔ workflow 연결 (orphan 0)
scripts/check-seo-guard.ts           네이버 노출면 보호
scripts/check-ops-typecheck.ts       agents·scripts 타입 회귀
scripts/check-admin-auth-guards.ts   어드민 인증 가드
scripts/check-persona-ssot.ts        페르소나 SSoT 정합

⚠️ M3-BOT-6 19단계의 check-bot-comment-guard.ts 도 여기에 추가된다.
```

### 18-4. launchd 실행 경로 표 (16개)

| # | Label | WorkingDirectory | script | UNAO_WORKDIR | write 등급 | M3 판정 |
|---|---|---|---|---|---|---|
| 1~9 | `com.unao.cafe-crawler-{dawn,morning,lunch,afternoon,evening,09h30,17h30}` · `popular-{morning,afternoon,evening}` | unao-prod | `launchd-wrapper.mjs` | unao-prod | 🔴 DB write | 재사용 |
| 10 | **`com.unao.naver-cafe-sheet-scraper`** | unao-prod | **`launchd-alert.sh`** | unao-prod | 🔴 **고객 발행** | 재사용 ⚠️ wrapper 통일 대상 |
| 11 | **`com.unaeo.session-refresh`** | unao-prod | **`launchd-alert.sh`** | unao-prod | 🟡 쿠키 갱신 | 재사용 ⚠️ 동일 |
| 12 | `com.unaeo.magazine-morning` | unao-prod | `launchd-wrapper.mjs` | unao-prod | 🔴 고객 발행 | 재사용 |
| 13 | `com.unaeo.magazine-late` | unao-prod | `launchd-wrapper.mjs` | unao-prod | 🔴 고객 발행 | 재사용 |
| 14 | **`com.unao.unao-prod-sync`** | unao-prod | `launchd-wrapper.mjs` → `git -C unao-prod pull --ff-only` (03:00) | unao-prod | 🟢 sync | 🔴 **필수 재사용 패턴** |
| 15 | `com.unaeo.opsboard` | unao-prod | (상주 PID 508) | unao-prod | 🟢 read-only | 재사용 |
| 16 | `com.unaoeo.figma-use-mcp` · `figma-ws` | ? | (상주 PID 499·510) | ? | ⚪ 개발도구 | 운영 무관 |

⚠️ **표는 8행이지만 label은 16개다.** 1~9행이 cafe-crawler 10개를, 16행이 figma 2개를 묶었다.

```
cafe-crawler 계열 10   dawn · morning · lunch · afternoon · evening
                       09h30 · 17h30 · popular-morning · popular-afternoon · popular-evening
sheet-scraper           1
session-refresh         1
magazine                2   morning · late
unao-prod-sync          1
opsboard                1
─────────────────────────── 운영 16개
figma-use-mcp · figma-ws  2  ← 개발도구. 운영 무관(운영 16에 미포함)
```

**repo `launchd/` 16개 ↔ 실물 16개 — 파일명 100% 일치** (+ `.bak-20260820` 1개)
⚠️ 내용 diff는 대조하지 않았다(§18-9 미확정).

#### ⚠️ wrapper 2종 혼재 — 잠재 위험

```
launchd-wrapper.mjs   14개 — UNAO_WORKDIR 미설정 시 **FATAL**
launchd-alert.sh       2개 — UNAO_WORKDIR 미설정 시 **old workspace fallback**
                             (naver-cafe-sheet-scraper · session-refresh)

현재는 둘 다 UNAO_WORKDIR이 설정돼 있어 안전하다.
⚠️ 그러나 alert.sh 쪽은 누군가 env를 지우면 **조용히 구 워크스페이스로 간다.**
   O1 사고와 같은 실패 모드다.
```

### 18-5. write runner 분류

```
🔴 customer-facing publish (8)
   naver-cafe-sheet-scraper · magazine-morning · magazine-late
   agents-scraper · agents-scraper-dawn
   agents-cafe-hourly-curation · agents-cafe-popular-curation · agents-killer-post

🔴 DB write — 봇 댓글 (5)   ← M3-BOT-6 22단계 선행 대상
   agents-cafe-wave · agents-sheet-viral · agents-seed · agents-seed-micro
   agents-daily(comment-activator · reply-chain-driver
                author-reply-dryrun · connection-facilitator)

🔴 DB write — 기타 (4)
   cafe-crawler ×10(launchd) · coo:content-scheduler
   coo:job-matcher · cmo:health-anxiety-responder

🔴 external API write (1)
   agents-social — X · Threads · Instagram · Facebook · Google Ads

🟡 notification only (4)
   agents-cafe · agents-hourly · ceo:approval-reminder · push-scheduled

🟢 read-only (7)
   ci · lighthouse · post-deploy-qa · ops-daily-report
   prewarm-detail-pages · quarantine-check · opsboard
```

**DB write 총 19지점은 M3-BOT-2에서 이미 전수 확인돼 있다**(§4 M3-BOT-2 절 참조).

### 18-6. M3 D-day runner 정책

```
🔴 필수 재사용
   ci.yml 가드 5종            check-cron-links · check-seo-guard
                              check-ops-typecheck · check-admin-auth-guards
                              check-persona-ssot
   launchd-wrapper.mjs 패턴   UNAO_WORKDIR 필수화 (미설정 시 FATAL)
   unao-prod-sync 패턴        03:00 자동 git pull --ff-only

🟡 guard 후 활성화 (M3-BOT-6 22단계 완료 전 금지)
   agents-cafe-wave · agents-sheet-viral
   agents-seed · agents-seed-micro
   agents-daily의 봇 댓글 4 task
   ⚠️ D-day에는 봇을 돌리지 않는다(M3-OPS-1). D+1~D+3에 순서대로 투입

🔴 분리 필수
   agents-social              새 브랜드 SNS 계정 전부 신규 발급
                              X · Threads · IG · FB · Google Ads 토큰 재사용 금지

🚫 제외
   agents-jobs                일자리 전략 폐기 확정
   coo:job-matcher            동일

🔵 검토
   run-script.yml             임의 스크립트 실행 — 권한 범위 확인 필요
   agents-killer-post         고객 발행. 새 브랜드 초기에 필요한지 재검토
   agents-design              실행 인자 미확정
   agents-weekly              실행 인자 미확정
```

⚠️ **GHA Secrets 62개 재등록이 선행 조건이다**(§17-8 blocker 5).

### 18-7. 우나어 생존 시에도 가져갈 개선 backlog

> 📌 **이 절은 원본이다. 전체 24건 통합 관리는 §19를 본다.**

```
1. 🔴 ops-doctor 강화 — write runner의 sync 상태 검사
   현재 scripts/ops-doctor.ts:344-349 는 "git 관리 중"이면 PASS다(O1 확인)
   → **behind > 0 이면 FATAL**로 판정해야 한다
   → 이번 감사 기준: unao-prod 0 behind ✅ / unao-ops 140 behind ⚠️

2. 🟡 launchd-alert.sh → launchd-wrapper.mjs 통일
   2개(sheet-scraper · session-refresh)만 alert.sh를 쓴다
   alert.sh는 UNAO_WORKDIR 미설정 시 fallback → 조용히 구 경로로 간다

3. 🟡 agents-sheet-viral 과 agents-cafe-wave 중복 확인
   둘 다 `seed viral-waves`를 `*/5`로 호출한다
   → 동시 실행 시 중복 처리 가능성 (미검증)

4. 🟡 unao-ops 정리 여부 결정
   140 behind · plist 참조 0건 · 재발 여지
   🚫 창업자 지시로 삭제하지 않는다. 결정 사항이다

5. 🟡 run-script.yml 권한 범위 확인
   dispatch 전용이나 무엇이든 실행할 수 있다

6. 🟢 repo plist ↔ 실물 plist 내용 diff 자동 대조
   파일명은 일치하나 내용 검사가 없다
```

### 18-8. 하면 안 되는 것

```
🚫 launchctl load/unload/reload        18개 전부 exit=0 정상. 창업자 영역
🚫 plist 수정                          16개 전부 정합
🚫 unao-ops 삭제                       창업자 지시 (O1)
🚫 New_Claude_agenotmatter 삭제/이동    미커밋 47파일 보유
🚫 unao-prod 수동 git 작업              03:00 자동 sync 대상. 수동 개입 시 pull 충돌
🚫 .bak-20260820 삭제                  O1 통합 시 백업본. 롤백 근거
🚫 workflow_dispatch 실행               전부 write runner
🚫 agents-social 중단                  외부 API 토큰 상태 미확인
```

### 18-9. 아직 미확정 (추정하지 않음)

| 항목 | 왜 미확정인가 | 확인 방법 |
|---|---|---|
| repo plist ↔ 실물 plist 내용 diff | 파일명 일치만 확인 | `diff` 16쌍 대조 |
| `agents-weekly` · `agents-design` · `agents-scraper-dawn` 세부 task | `cron/runner.ts`만 grep에 잡히고 인자를 추출하지 못함 | 워크플로우 전문 정독 |
| `unao-ops`의 `ops/main` 원격 추적 여부 | 로컬 전용 브랜치일 가능성 | `git -C unao-ops branch -vv` |
| `agents-sheet-viral` vs `agents-cafe-wave` 중복 영향 | 둘 다 `*/5`로 `seed viral-waves` 호출 | BotLog 중복 실행 흔적 조회 |
| `run-script.yml` 권한 범위 | 임의 스크립트 실행 가능 | 워크플로우 정독 |
| GHA 최근 실행 성공률 | `gh run list` 미실행 | `gh run list --limit 50` |
| `figma-use-mcp` · `figma-ws` (PID 499·510) | **[추정]** 개발도구이며 운영 무관 | plist 정독 |

---

## 19. 우나어 생존 시 개선 backlog (통합) — UNAO-SURVIVAL-BACKLOG-1/2, 2026-08-20

> **이 절은 M3 준비 중 발견한 "우나어 자체의 문제"를 모은 것이다.**
> M3가 실행되지 않더라도(= 네이버가 회복되더라도) **이 과제들은 그대로 남는다.**
>
> **§14-10 · §18-7은 삭제하지 않는다.** 두 절은 각 감사의 맥락 안에 있는 원본이고,
> 이 §19가 **전체를 P0~P3로 통합한 단일 관리 지점**이다.
> 충돌이 아니라 포함 관계다 — §14-10(7건) + §18-7(6건) ⊂ §19(24건).

### 19-1. 현재 판정

```
전체 과제        25건  (P0-3B에서 P2-9 추가)
문서화됨         13건  (§14-10 7건 + §18-7 6건)
🔴 미문서화      11건  ← 대화에만 있어 세션 종료 시 휘발할 뻔했다

⚠️ 특히 C 카테고리(봇 댓글/BotLog/노출 guard) 5건이 **전부 미문서화**였다.
   M3-BOT 절에 흩어져는 있으나 "우나어 생존 시 과제"로 분류된 적이 없어,
   판정 후 우나어를 고칠 때 놓칠 가능성이 높았다.
```

**카테고리별 문서화 현황**

| 카테고리 | 건수 | 문서화 |
|---|---|---|
| A. 운영 실행 경로 / runner / launchd / GHA | 6 | 6/6 ✅ (§18-7) |
| B. ops-doctor / 재발 방지 guard | 3 | 1/3 ⚠️ |
| **C. 봇 댓글 / BotLog / 노출 guard** | **5** | **0/5 🔴** |
| **D. SEO / canonical / sameAs** | **3** | **0/3 🔴** |
| E. 게시판 IA | 2 | 1/2 |
| F. DB / migration / seed / admin | 6 | 6/6 ✅ (§14-10 · P2-9) |
| G. 외부글 archive / Voice Engine | 2 | 2/2 ✅ (§16) |
| **H. env / secrets / observability** | **1** | **0/1 🔴** |
| **I. 약관 / 사업자 / 신뢰 신호** | **1** | **0/1 🔴** |

### 19-2. 🔴 P0 — 생존 판정 직후 즉시 (4건)

| # | 과제명 | 출처 | AS-IS (실측) | 우나어 적용 | 시점 | 파일 | 검증 | 창업자 결정 |
|---|---|---|---|---|---|---|---|---|
| **P0-1** | **ops-doctor behind 검사 부재** | OPS-RUNNER-1 · §18-7 | `ops-doctor.ts:344-349`가 `isGitRepo()`면 무조건 `PASS`. **HEAD·dirty만 보고 behind를 안 본다** | ✅ 예 | **지금도 가능** | `scripts/ops-doctor.ts` | unao-ops(140 behind)가 FATAL로 뜨는지 | 불필요 |
| **P0-2** | **BotLog 무기록 3경로** | M3-BOT-6 | `comment-activator`·`reply-chain-driver`·`controversy-chain`이 `botLog.create` **0건**. 봇 댓글을 쓰는데 기록이 없다 | ✅ 예 | **지금도 가능** | 위 3파일 | BotLog에 action 기록 확인 | 불필요 |
| **P0-3** | ~~재해 복구 절차 부재~~ → ✅ **문서화 완료 (2026-08-20, P0-3B)** | M3-OPS-7 · §14-10 | ~~DB 소실 시 46모델 복원 절차가 문서화된 적 없었다~~ → `docs/operations/2026-08-20-database-disaster-recovery.md` 신설. S1~S9 시나리오 · 금지 명령 · 검증 쿼리 · 체크리스트. 🔴 감사 중 신규 발견: `seed.ts:135-137` **deleteMany 3건** + `BoardConfig.upsert`가 `update: config`로 전량 덮어씀 | ✅ 예 | ✅ **완료** | `.claude/commands/prisma-guide/` | 절차 문서 존재 | 불필요 |
| **P0-4** | **migration ↔ 스키마 9모델 불일치** | M3-OPS-7 · §14-10 | schema 46 vs migrations 39. `AdminQueue`·`Notice`·`Popup` 등 9모델이 이력에 없다 | ✅ 예 | 🔴 **판정 후** | `prisma/migrations/` | `migrate diff` 46/46 | 필요 |

⚠️ **P0-1은 O1 사고의 직접 재발 방지책이다.** 현재 코드는 stale을 탐지하지 못한다.
⚠️ **P0-1·P0-2·P0-3은 판정 전에도 안전하다.** SEO·DB·고객 화면에 영향이 없다.
🚫 **단 이 문서 작성 시점에는 코드를 수정하지 않는다.** 착수는 창업자 지시 후다.

### 19-3. 🟡 P1 — 생존 판정 후 (8건)

| # | 과제명 | 출처 | AS-IS (실측) | 시점 | 파일 | 검증 |
|---|---|---|---|---|---|---|
| **P1-1** | `launchd-alert.sh` → `wrapper.mjs` 통일 | OPS-RUNNER-1 · §18-7 | 2개만 alert.sh(`naver-cafe-sheet-scraper`·`session-refresh`). **UNAO_WORKDIR 지워지면 구 경로로 조용히 fallback** | 판정 후 | plist 2개 | 로그 첫 줄 workdir |
| **P1-2** | 🔴 **봇 cap 정책 3벌 불일치** | M3-BOT-5 | `constitution.yaml:351`=**5** / `comment-activator:23`=**5** / `wave-processor` globalCap=**20·14·10**. **코드가 헌법값을 4배 초과** | 판정 후 | 위 3파일 | 헌법값과 코드 일치 |
| **P1-3** | 🔴 `USER_POST_WAVE` BotLog에 postId 없음 | M3-BOT-3b | `details: {processed, failed}`만. **사후 추적 불가** — 487건 출처 확정이 어려웠던 원인 | 판정 후 | `user-post-wave-processor.ts:229` | details에 postId 포함 |
| **P1-4** | 🔴 JSON-LD `sameAs` 구 네이버 블로그 | M3-OPS-6 | `(main)/page.tsx:178` — **현재 서비스에도 존재**. 블로그 운영 여부 미확인 | 🚫 판정 후 | `(main)/page.tsx` | `curl \| grep sameAs` |
| **P1-5** | 🔴 `BASE_URL` fallback 37곳 산재 | M3-OPS-6b | `breadcrumb.ts:3` 주석은 *"BASE_URL은 여기 한 곳에서만 관리"* 라는데 실제 **37곳**. **주석이 사실과 다르다** | 🚫 판정 후 | 37파일 | `grep -c` |
| **P1-6** | `BoardConfig` 단일 장애점 | M3-OPS-4 · §14-10 | fallback 없음. 비면 전 게시판 404 | 🚫 판정 후 | `queries/boards.ts` | 빈 상태 렌더 |
| **P1-7** | `agents-sheet-viral` ↔ `agents-cafe-wave` 중복 | OPS-RUNNER-1 · §18-7 | 둘 다 `seed viral-waves`를 `*/5`로 호출 | 판정 후 | 워크플로우 2개 | BotLog 중복 흔적 |
| **P1-8** | 🔴 **외부글 공급원 93% 편중** | M3-OPS-10 | SHEET 2,945건 중 cook82 **53%** + navercafe **40%**. **한 곳 막히면 절반 끊긴다** | 판정 후 | 공급 파이프라인 | 출처 다변화 |

⚠️ **P1-8은 이미 발생한 현재진행형 리스크다.** image-router DAY_CAP 6/6 · navercafe/bboom 공급 중단이 그 증상이다.
→ 근본 해법은 **§19-7 Voice Engine**이다.

### 19-4. 🟢 P2 — D+30 (9건)

| # | 과제명 | 출처 | AS-IS |
|---|---|---|---|
| P2-1 | `prisma-guide`가 Prisma 7 이전 기준 | M3-OPS-7 · §14-10 | `prisma.config.ts` 미반영. **[추정]** 제거된 플래그(`--to-schema-datamodel`) 잔존 |
| P2-2 | `seed.ts` 운영+테스트 데이터 혼재 | M3-OPS-4 · §14-10 | BoardConfig(운영) + 유저·글·댓글(테스트)이 한 파일 |
| P2-3 | `create-admin.ts` 예시 이메일 불일치 | M3-OPS-7b · §14-10 | `admin@unao.com` vs 실제 도메인 |
| P2-4 | 🔴 `create-admin.ts:5` `[WATCH]` 잔재 | M3-OPS-7b | *"2주 모니터링 대상"* 로그. 종료 시점 불명 |
| P2-5 | `run-script.yml` 권한 범위 | OPS-RUNNER-1 · §18-7 | dispatch 전용이나 무엇이든 실행 가능 |
| P2-6 | repo plist ↔ 실물 plist diff 자동 대조 | OPS-RUNNER-1 · §18-7 | 파일명만 일치 확인. 내용 검사 없음 |
| P2-7 | 🔴 `WEEKLY` 숨김이 3곳 분산 | M3-OPS-4 | `schema.prisma` 1 · `board-registry.ts` 3 · `seed.ts` 3 |
| P2-8 | 🔴 `sentiment` 필드 미채움 | M3-OPS-10 | `CafePost.sentiment`가 전부 빈 값. **[추정]** psych-analyzer 미구현 |
| **P2-9** | 🔴 **R2 / Supabase Storage 백업 전략 부재** | P0-3B (2026-08-20) | Supabase DB 백업에 **Storage 객체가 포함되지 않는다**(콘솔 확인: "Storage objects are not included"). 이미지·첨부·썸네일·OG 이미지는 DB 복구로 되살릴 수 없다. R2 버킷 백업 정책도 미확인 |

### 19-5. ⚪ P3 — 관찰·보류 (4건)

| # | 과제명 | 출처 | 비고 |
|---|---|---|---|
| P3-1 | `unao-ops` 정리 여부 | OPS-RUNNER-1 · §18-7 | 140 behind · plist 참조 0건. 🚫 **창업자 지시로 삭제 안 함** |
| P3-2 | 🔴 `Comment`에 생성 경로 필드 없음 | M3-BOT-3b | migration 필요. 487건 출처 확정 불가의 근본 원인 |
| P3-3 | 🔴 `PersonaMemory` 모델 | M3-BOT-1/4 | migration 필요. 봇 장기 기억 |
| P3-4 | `BOARD_REGISTRY`는 잘 설계된 자산 | M3-OPS-4 · §14-10 | 개선 과제가 아니라 **보존 기록**. slug·sitemap·prewarm이 여기서 파생 |

### 19-6. 고아 방지 필드 (전 과제 공통)

```
상태        미착수 24 / ✅ 완료 1 (25건 중)
            ✅ P0-3 재해 복구 절차 문서화 — 2026-08-20 (P0-3B)
               → docs/operations/2026-08-20-database-disaster-recovery.md
다음 트리거  P0-1·P0-2·P0-3  창업자 지시 (판정 전에도 안전)
            그 외 20건       2026-08-22 네이버 수집 재관찰 판정
소유자      Claude(실행) / Codex(검증) / 창업자(승인)
종료 조건   과제별 '검증' 열 통과 + 이 표에서 ✅ 완료로 갱신

⚠️ 이 표는 완료 시 지우지 않고 ✅로 갱신한다. 이력이 남아야 재발을 안다.
```

### 19-7. Voice Engine — M3 전용이 아니다

```
🔴 우나어 생존 시에도 핵심 자산이다.
   §16이 "M3 D+30 과제"로 적었으나, 실제로는 우나어의 P1-8을 푸는 근본 해법이다.

연결
  P1-8  외부글 공급원 93% 편중 (cook82 53% + navercafe 40%)
        → 한 곳 막히면 공급 절반이 끊긴다. 이미 발생 중
  해법  CafePost 31,501건의 비식별 메타로 "주제"를 확보하면
        원문 공급원이 바뀌어도 콘텐츠 기획이 유지된다

시점  D+30 이후. 🚫 D-day·판정 전 사용 금지 (§16-3)
전제  🔔 창업자 결정 — CafePost 비식별 메타 사용 승인 (이월 중)
상세  §16 전체
```

### 19-8. 🚫 우나어가 생존해도 지금 하면 안 되는 것

```
🚫 P1-4 sameAs 제거              SEO 변경. 수집 10건/day라 검증 불가
🚫 P1-5 BASE_URL 37곳 정리        SEO 노출면. CI seo-guard 대상
🚫 P0-4 migration 9모델 정리      DB 이력 조작. 판정 전 변수 추가 금지
🚫 P1-6 BoardConfig fallback      게시판 렌더 로직. 관찰 중 변경 금지
🚫 P1-7 중복 워크플로우 정리       봇 댓글 경로. M3-BOT-6 선행
🚫 P2-7 WEEKLY 정리               enum 변경. 위험 대비 효과 없음
🚫 P3-1 unao-ops 삭제             창업자 지시
🚫 HUMOR 대량 발행                보류 확정 (§11)
🚫 canonical / robots / sitemap 변경  CI seo-guard + 관찰 오염

공통 원칙
  네이버 수집이 10건/day라 **무엇을 바꿔도 검증이 안 된다.**
  변수를 늘리면 원인 규명이 불가능해진다.
```

### 19-9. 🚫 M3 전용 — 우나어에 적용 금지

```
🚫 브랜드 문자열 치환 41지점 (§17)      우나어는 브랜드를 안 바꾼다
🚫 BoardConfig 3행 축소 (§14-2)         HUMOR·LIFE2·JOB을 지우면 현재 콘텐츠가 사라진다
🚫 /jobs notFound (§14-1④)              현재 서비스는 jobs를 운영 중이다
🚫 /community/talk slug 변경 (§14-1②)   기존 URL 색인이 깨진다
🚫 새 Supabase 초기화 (§14-5)           운영 DB에 실행하면 재앙이다
🚫 매거진 3건 전략 (§15)                 우나어 매거진은 262건 자산이 있다
🚫 페르소나 30명 축소 (M3-BOT-4)         우나어는 79명 운영 중이다
🚫 D-day runner 정책 (§18-6)            제외/분리는 새 브랜드 기준이다

⚠️ 예외 — M3-BOT-3 safety guard는 우나어에도 유효하다.
   의료 발화 차단은 브랜드 무관이다.
   다만 M3-BOT-6 22단계 전체를 우나어에 적용하면
   기존 보드 댓글이 급감한다(globalCap 10~20 → 2). 신중해야 한다.
```

### 19-10. 확정 vs 추정 구분

```
✅ 코드·실측으로 확정 (18건)
   ops-doctor:344-349 behind 미검사 · BotLog 0건 3경로
   schema 46 vs migrations 39 · cap 5/5/20·14·10 · USER_POST_WAVE details
   sameAs:178 · BASE_URL fallback 37 · WEEKLY 3곳 · alert.sh 2개
   launchd 16개 unao-prod · unao-ops 140 behind · SHEET 93% 편중
   CafePost 31,501 · ageSignal 50s 18,221 · sentiment 빈 값
   seed.ts 혼재 · create-admin 예시 이메일

⚠️ 추정 (6건)
   [추정] agents-sheet-viral ↔ cafe-wave 중복 영향 — 미검증
   [추정] BoardConfig 비면 전 게시판 404 — 코드상 그렇게 보이나 실행 확인 안 함
   [추정] sentiment 미채움 = psych-analyzer 미구현
   [추정] prisma-guide에 제거된 플래그 잔존 — 전문 재확인 안 함
   [추정] P0 착수 순서의 효과 — 우선순위는 Claude 판단이다
   [추정] sameAs 제거가 SEO에 미치는 영향 — 검증 불가
```

---

## 부록 A — M3-0 실측 데이터 요약

```
[제품]      공개 route 33 · 어드민 20 · API 54
[콘텐츠]    PUBLISHED 10,644  (BOT 72.8% · SHEET 26.6% · USER 0.6%)
           본문 71.4%가 300자 미만 · 일 발행 134건
[참여]      댓글 62,808  (봇 93.5% · 실회원 6.4% · guest 74)
           계정 507  (봇 83 · 실회원 424)
           최근 7일 실회원 글 5건 · 실회원 댓글 446건
[인프라]    GHA 26 workflow · cron 116 · launchd 12 · agents 120파일 · Prisma 46모델
           워크스페이스 3벌 (unao-main 개발 · unao-prod launchd 11 · unao-ops launchd 1)
[SEO]      네이버 색인 0 · 수집 4~14/day 수준으로 축소 · 노출 0
           Google 색인 6,220 / 미색인 15,796 · 28일 클릭 85 (브랜드 45%)
[비용]      ISR Writes $56.10(1위) · Fast Origin Transfer $40.82 · Fluid CPU $16.07
           6월 $69.60 → 8월 $36.64 (약 -47%)
```

## 부록 B — 관련 문서

```
docs/constitution/NORTH_STAR.md          헌법 v5.0
docs/ops/OPERATING_MASTER_HARNESS.md     Codex↔Claude 협업 규약
agents/cook82/README.md                  후보 큐 운영 문서
.claude/rules/agent-lifecycle.md          에이전트 ON/OFF 체크리스트
naver_google/                             네이버 진단 증거 (수정 금지)
vercel 비용/                              Vercel 청구 증거 (수정 금지)
```

---

*최종 갱신 2026-08-20 · 다음 갱신 예정: M3-1 창업자 확정 또는 네이버 수집/색인 전환 관찰 후*
