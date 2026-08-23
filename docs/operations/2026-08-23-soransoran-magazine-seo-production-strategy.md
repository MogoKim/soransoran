# 소란소란 매거진 SEO 제작 운영 전략서

> 작성일: 2026-08-23 · 기준 커밋: `9ab299d`
> 성격: **제작 운영 전략서**. 무엇을 · 어떤 순서로 · 어떤 게이트를 거쳐 만들 것인가.
> 콘텐츠 원칙은 [매거진 전략](./2026-08-23-soransoran-magazine-strategy.md),
> 색인 규칙은 [SEO 색인 정책](./2026-08-23-soransoran-seo-index-policy.md)이 정본이다.
> 이 문서는 그 둘을 **다시 정의하지 않고 실행 계획만** 담는다.

---

## 1. 한 줄 판정

> 우나어는 3,000페이지를 만들고도 **88~90%가 노출 0**이었다.
> 원인은 색인 설정이 아니라 **권위 부재 + 얇은 볼륨 + 검색어와 무관한 제목**이었다.
> 소란소란은 **아무도 검색하지 않는 글을 많이 쓰는 대신, 실제로 검색되는 질문에 답하는 글을 적게 쓴다.**

우나어 진단서(`docs/analysis/seo-organic-diagnosis-2026-06-15.md`)의 결론이 이 전략의 출발점이다.

```
외부 백링크        총 5개 (에디토리얼 0)
발견 vs 노출       발견 3,000+ / 6주 노출 383회  →  88~90% 노출 0
브랜드 의존        전체 클릭의 63%가 브랜드 검색
매거진 성적        전부 0클릭
근본 원인 3위      "제목이 에세이형이라 아무도 검색하지 않는다"
```

세 번째가 우리가 **글 한 편 단위에서 통제 가능한 유일한 변수**다.

---

## 2. 목표 — 검색 유입 → 커뮤니티 전환 → 재방문

```
검색 유입        롱테일 질문 정확매칭으로 1페이지 진입
   ↓
커뮤니티 전환    글 끝에서 관련 게시판으로 넘긴다 (전략 원칙 9)
   ↓
재방문           댓글·글쓰기 경험 → 주간 재방문 참여 유저
```

**DAU 1만은 매거진 트래픽의 결과가 아니라 커뮤니티 참여의 결과다.**
매거진이 월 10만 유입을 만들어도 전원이 읽고 나가면 DAU는 늘지 않는다.
그래서 이 전략서의 모든 글에는 **CTA board가 필수 필드**다(§8·§12).

### 측정 지표

| 지표 | 의미 | 확인처 |
|---|---|---|
| 비브랜드 클릭 비중 | 검색 엔진이 우리를 주제로 인식하는가 | GSC 검색어 (제출 후) |
| 매거진 → 커뮤니티 이동 | 전환이 실제로 일어나는가 | 내부 링크 클릭 (수동 관찰) |
| 주간 재방문 참여 유저 | **North Star** | DB 조회 |
| 색인된 글 / 발행한 글 | 얇은 글을 만들고 있지 않은가 | GSC 페이지 리포트 |

⚠️ **페이지 수를 지표로 삼지 않는다.** 우나어가 3,000페이지로 실패한 지점이다.

---

## 3. Google / Naver 공식 기준 요약

| 기준 | 실무 번역 |
|---|---|
| **Helpful content** — 사람을 위해 쓰였는가 | 검색엔진용 키워드 나열이 아니라, 실제 질문에 답하는 글 |
| **E-E-A-T** — 경험·전문성·권위·신뢰 | 편집팀 명시 · 의료 안전 문구 · 출처 없는 수치 금지 |
| **YMYL** — 건강·돈은 더 엄격 | 진단·치료·약 권유 금지(전략 원칙 8). 클러스터 절반이 여기 해당 |
| **중복·유사 콘텐츠** | 같은 주제를 제목만 바꿔 반복하지 않는다 |
| **크롤 예산** | 빈 페이지·저품질 페이지를 sitemap에 넣지 않는다 (SEO 정책 원칙 3) |
| **Naver — 문서 원본성** | 외부글 재작성이 원본성 신호를 무너뜨린다 (우나어 F1) |
| **Naver — 대표 문서 판정** | 무엇이 우리 원본인지 명확해야 색인된다 (우나어 F2) |

---

## 4. 우나어 실패에서 버릴 것

| # | 실패 | 소란소란 대응 |
|---|---|---|
| **L1** | **볼륨 우선** — 1일 3편 × 365일 = 1,095편 목표 | **1일 1편**에서 시작. 검수 못 하면 발행하지 않는다 |
| **L2** | **에세이형 제목** — "내 몸이 안 이뤄짐" 류. 아무도 검색 안 함 | **검색 질문 그대로 제목에** (§8) |
| **L3** | **외부글 수집·재작성** | 금지 (전략 원칙 2) |
| **L4** | **자동 발행 파이프라인** — 생성→발행이 사람 없이 이어짐 | **draft-only**. 사람 승인 없이 공개 경로 없음 (§10) |
| **L5** | **얇은 글 3,000편** → 사이트 품질 신호 희석 | 글 수를 목표로 삼지 않음 |
| **L6** | **네비게이션 내부링크만** (47,124개인데 전부 메뉴) | **본문 contextual 링크** + 시리즈 이전/다음 (§7) |
| **L7** | **광고가 본문을 끊음** | 광고 0건 |
| **L8** | **구글 색인 API 자동 호출** | 제출 자체를 보류(게이트 미달) |

---

## 5. 우나어 자산에서 가져올 것

**코드를 복사하지 않는다. 판단 기준만 가져온다.**

| 자산 | 가져올 것 |
|---|---|
| `longtail-keywords.ts` | **선정 기준**: 월 100~500회 · 경쟁 낮음 · 질문/비교/상황/계산/방법형 · "50·60대가 실제로 치는 검색어" |
| `keyword-research/scorer.ts` | **의도 분류**(정보/질문/방법/비교/계산) · **민감도 등급**(none/low/medium/high) · 민감 키워드는 제목 순화 |
| `series-plan.ts` | `seriesId` · 회차 순서 · 분기 태깅 개념. **48시리즈 × 5편 = 240편 규모는 버린다** |
| `prompt.ts` | 글 규칙: **"시니어·어르신" 금지** · 표 금지 · H1 금지(시스템 렌더) · 팁은 "오늘 당장 할 1가지" · 연도 하드코딩 금지 |
| 진단서 Phase 1 | **키워드-퍼스트 전환**(트렌드 제안 → 미사용 정확매칭 쿼리) · **필라 + 본문 contextual 링크** |
| `chatgpt-scraper.ts` | **미로그인이면 즉시 중단** — 무한 대기 금지. 로컬 `storageState` 로만 세션 처리 |
| `local-image-generator.ts` | **업로드 실패 시 임시 URL 저장 금지, null 반환** — 반쪽 산출물을 남기지 않는다 |

---

## 6. 365일 주제 전략

### 6.1 전체를 갱년기/건강으로 채우지 않는다

갱년기는 **진입 검색어**이지 서비스 정체성이 아니다.
건강 일색이면 ① YMYL 리스크가 사이트 전체로 번지고 ② 40대 중반 사용자가 "나는 아직"이라며 이탈하며
③ 같은 주제 반복이 중복 신호가 된다.

### 6.2 비율

| 기간 | 갱년기·건강·관리 | 돈·일 | 관계·가족 | 일상·살림 | 마음·자기 |
|---|---|---|---|---|---|
| **초반 60일** | **50%** | 15% | 15% | 10% | 10% |
| 61~180일 | 35% | 20% | 20% | 15% | 10% |
| 181~365일 | **25%** | 25% | 20% | 15% | 15% |

**초반 60일에만 건강 비중을 높이는 이유**: 갱년기 롱테일이 경쟁이 가장 낮고 검색 의도가 명확해
저권위 신규 도메인이 1페이지에 들어갈 확률이 가장 높다. 발판을 만든 뒤 주제를 넓힌다.

### 6.3 클러스터 매핑

매거진 전략 §4.1의 8개 클러스터를 위 비율에 배분한다.

```
갱년기·건강·관리   menopause-symptom · sleep · clinic · daily
돈·일              money-work
관계·가족          family · relationship
마음·자기          emotion
```

---

## 7. 시리즈 전략

### 7.1 혼합 리듬

```
주 5편 기준
  시리즈 2편 (같은 시리즈의 연속 회차)
  단발  3편 (독립 롱테일 질문)
```

**시리즈만 하면** 검색 진입면이 좁아지고, **단발만 하면** 체류·회귀가 없다.
시리즈는 5편 완결을 기본으로 한다. 우나어의 48시리즈 × 5편(240편) 규모는 v0에서 감당할 수 없다.

**초반 60일 권장**: 시리즈 **3개**(갱년기 기초 5편 · 수면 5편 · 병원 가기 5편) + 단발 나머지.

### 7.2 내부링크 구조 (L6 대응)

```
시리즈 글        ← 이전 회차 · 다음 회차 · 시리즈 목차
     ↓
같은 클러스터 단발 글 2~3개 (관련글)
     ↓
커뮤니티 게시판 (CTA)
```

**네비게이션 링크가 아니라 본문·하단의 contextual 링크**여야 한다.
우나어는 내부링크 47,124개 중 대부분이 메뉴라 SEO 신호가 되지 못했다.

### 7.3 필드 정책

현재 `MagazineArticle`(`src/content/magazine/types.ts`)에는 시리즈 필드가 없다.
**6-G에서 아래를 추가한다** — 이 문서는 정책만 정한다.

| 필드 | 정책 |
|---|---|
| `seriesId` | 영문 kebab-case. 없으면 단발 글 |
| `order` | 1부터. 같은 `seriesId` 안에서 유일 |
| previous / next | **저장하지 않는다.** `seriesId` + `order`로 계산한다(중복 진실 방지) |
| related | **저장하지 않는다.** 같은 cluster에서 계산한다(이미 `getRelatedMagazineArticles`) |
| 시리즈 목차 | `seriesId`로 필터해 렌더 |

⚠️ **previous/next/related를 데이터로 저장하면 글이 늘 때마다 손으로 고쳐야 하고 반드시 어긋난다.**

---

## 8. 30일 주제 큐 (day 1 = 3번째 글)

> **정본은 `drafts/magazine/topic-queue.ts`** 다. 이 표는 읽기용 요약이다.
> 둘이 어긋나면 `topic-queue.ts` 를 따른다.

### 8.1 이미 발행된 2건 (큐에 포함하지 않는다)

| slug | 시리즈 | 발행 |
|---|---|---|
| `when-does-menopause-start` | `menopause-basic` #1 | 2026-08-23 |
| `menopause-waking-up-at-3am` | `menopause-basic` #2 | 2026-08-23 |

⚠️ **`menopause-basic` 의 다음 order 는 3부터다.** 초판 주제안은 2편을 단발·`sleep` 으로
잡고 있었으나, 실제 발행에서 시리즈 #2 · `menopause-symptom` 으로 확정됐다.

### 8.2 큐 30건

`title` 은 우나어 L2(에세이형 제목)를 피해 **검색어를 그대로** 둔다.
`risk` 는 매거진 전략 원칙 5 · §5.1 의 검수 깊이를 정한다.

| day | title | slug | cluster | series #order | intent | risk | img |
|---|---|---|---|---|---|---|---|
| 1 | 갱년기 안면홍조 언제까지 계속되나요 | `hot-flash-how-long` | menopause-symptom | menopause-basic #3 | 질문 | MED | REQ |
| 2 | 나이 들면 잠이 줄어드는 게 정상인가요 | `less-sleep-with-age` | sleep | sleep-series #1 | 질문 | MED | REQ |
| 3 | 국민연금 조기수령 60세와 65세 어느 쪽이 유리한가요 | `pension-early-vs-normal` | money-work | — | 비교 | MED | OPT |
| 4 | 갱년기 이유 없이 눈물이 날 때 | `menopause-tears` | emotion | — | 상황 | MED | OPT |
| 5 | 갱년기 이후 살이 잘 안 빠지는 이유 | `weight-harder-after-menopause` | daily | body-change #1 | 질문 | MED | REQ |
| 6 | 남편이 갱년기를 이해 못 할 때 | `husband-doesnt-understand` | family | — | 상황 | LOW | OPT |
| 7 | 자다가 식은땀으로 깰 때 | `night-sweats-waking` | sleep | sleep-series #2 | 상황 | MED | OPT |
| 8 | 갱년기 관절이 아픈데 운동해도 되나요 | `menopause-joint-pain-exercise` | menopause-symptom | menopause-basic #4 | 질문 | MED | OPT |
| 9 | 50대 재취업 어디부터 알아봐야 하나요 | `rehire-where-to-start` | money-work | — | 방법 | LOW | OPT |
| **10** | **갱년기 증상 무슨 과에 가야 하나요** | `which-clinic-menopause` | clinic | — | 질문 | **HIGH** | REQ |
| 11 | 갱년기 피부가 갑자기 건조해질 때 | `dry-skin-menopause` | daily | body-change #2 | 상황 | MED | OPT |
| 12 | 낮잠이 밤잠을 방해할까요 | `does-nap-affect-sleep` | sleep | sleep-series #3 | 질문 | LOW | OPT |
| 13 | 50대에 친구가 줄어드는 이유 | `fewer-friends-50s` | relationship | — | 질문 | LOW | REQ |
| 14 | 뱃살만 늘어나는 것 같을 때 | `belly-fat-menopause` | daily | body-change #3 | 상황 | MED | OPT |
| 15 | 퇴직 후 건강보험료는 얼마나 나오나요 | `health-insurance-after-retire` | money-work | — | 계산 | MED | OPT |
| 16 | 요즘 아무것도 하기 싫을 때 | `no-motivation-50s` | emotion | — | 상황 | MED | OPT |
| 17 | 잠이 안 올 때 하면 안 되는 것 | `what-not-to-do-when-cant-sleep` | sleep | sleep-series #4 | 방법 | MED | OPT |
| **18** | **50대 건강검진 꼭 챙겨야 할 항목** | `checkup-items-50s` | clinic | — | 방법 | **HIGH** | REQ |
| 19 | 자녀가 독립한 뒤 집이 조용할 때 | `empty-nest-quiet` | family | — | 상황 | LOW | OPT |
| 20 | 갱년기에 머리카락이 빠질 때 | `hair-loss-menopause` | menopause-symptom | — | 상황 | MED | OPT |
| 21 | 50대 걷기 하루 몇 분이 적당할까요 | `walking-minutes-50s` | daily | — | 계산 | LOW | OPT |
| **22** | **갱년기 심장이 두근거릴 때** | `palpitations-menopause` | menopause-symptom | — | 상황 | **HIGH** | REQ |
| 23 | 잠자리 습관을 바꿔 본 2주 | `sleep-habit-two-weeks` | sleep | sleep-series #5 | 방법 | LOW | REQ |
| 24 | 주부로 지내다 다시 일하려면 | `back-to-work-homemaker` | money-work | — | 방법 | LOW | OPT |
| 25 | 기억력이 떨어진 것 같을 때 | `memory-worry-menopause` | emotion | — | 상황 | MED | OPT |
| 26 | 모임에 나가기 싫어질 때 | `avoiding-gatherings` | relationship | — | 상황 | LOW | OPT |
| 27 | 저녁 식사를 바꿔 본 2주 | `dinner-change-two-weeks` | daily | body-change #4 | 방법 | LOW | OPT |
| **28** | **퇴직금 IRP에 넣으면 세금이 얼마나 줄어드나요** | `irp-tax-benefit` | money-work | — | 계산 | **HIGH** | OPT |
| 29 | 갱년기가 끝나면 몸은 어떻게 달라지나요 | `after-menopause-body` | menopause-symptom | menopause-basic #5 | 질문 | MED | REQ |
| 30 | 갱년기에 운동을 다시 시작하며 | `restart-exercise-menopause` | daily | body-change #5 | 방법 | LOW | OPT |

### 8.3 배분 검증

| 축 | §6.2 목표(초반 60일) | 이번 큐 | |
|---|---|---|---|
| 갱년기·건강·관리 | 50% | 16건 (53%) | ✅ |
| 돈·일 | 15% | 5건 (17%) | ✅ |
| 관계·가족 | 15% | 4건 (13%) | ✅ |
| 일상·살림 | 10% | 2건 (7%) | 🟡 |
| 마음·자기 | 10% | 3건 (10%) | ✅ |
| 시리즈 비율 | 40%(§7.1) | 13건 (43%) | ✅ |

**risk 분포**: LOW 11건(37%) · MEDIUM 15건(50%) · **HIGH 4건(13%)**
**이미지 REQUIRED**: 9건(30%) — 시리즈 첫 편 · HIGH · 주간 대표글

### 8.4 HIGH 배치 규칙

```
30일 큐에서 HIGH ≤ 6건
연속 3일 HIGH 금지
주당 HIGH ≤ 2건
```

이번 큐의 HIGH 는 day 10 · 18 · 22 · 28 로 **최소 간격 4일**이다.
상한을 넘으면 월 1회 큐 승인 단계에서 되돌린다.

### 8.5 알려진 불일치 2건

**① `daily` 가 두 축에 걸친다.** §6.3 매핑은 `daily` 를 "갱년기·건강·관리"에 넣어
"일상·살림 10%"에 대응하는 클러스터가 없다. 이 큐는 `daily` 를
건강관리(체중·피부) 3건 + 일상(걷기·식사 루틴) 2건으로 나눠 썼다.

**② "피부"에 해당하는 클러스터가 없다.** 8개 클러스터(전략 §4.1) 어디에도 없어
`daily` 에 넣었다. 3~4건 이상 쌓이면 클러스터 신설을 검토한다.

### 8.6 31~60일

§6.2 비율을 유지하며 `clinic-visit` 시리즈 5편과 `money-work` 시리즈 1개를 추가한다.
`clinic-visit` 를 초반 30일에 넣지 않은 이유는 **HIGH 가 5건 몰리기 때문**이다(§8.4).

---

## 9. Playwright 로컬 제작 자동화 설계

### 9.0 도구별 역할 — 자동화 전에 먼저 고정한다

역할 분리의 정본은 **매거진 전략 §3.0** 이다. 여기서는 제작 단계별로 어느 도구가 붙는지만 본다.

| 단계 | 주체 | 산출물 |
|---|---|---|
| ① 주제 선택 | **창업자** (월 1회 큐 승인) | `drafts/magazine/topic-queue.ts` 의 day N |
| ② 의도 분석 · 구조 · 리스크 | **Claude 채팅** | 검색 의도 · h2 구조안 · 위험 문장 후보 · **ChatGPT 원고 지시서** |
| ③ 최종 원고 작성 | **ChatGPT 채팅** | 본문 초안 (소란소란 톤 · AI티 제거된 상태) |
| ④ hero 이미지 | **ChatGPT 채팅** | 1200×675 webp |
| ⑤ 파일화 | **Claude Code** | `drafts/magazine/{slug}/article-draft.ts` |
| ⑥ 자동 QA · 검증 | **Claude Code** | QA 결과 (PASS/FAIL/WARN) |
| ⑦ 검수 패킷 | **Claude Code** | 요약 5줄 · 위험 문장 5개 · 이미지 · 권장 판단 |
| ⑧ **승인** | **창업자** ★ | 승인 / 수정 요청 / 폐기 |
| ⑨ 발행 준비 | **Claude Code** | `articles.ts` 반영 → **창업자 승인 후** push |

**②와 ③을 다른 도구에 두는 것이 핵심이다.**
같은 도구가 원고도 쓰고 위험 문장도 뽑으면, 위험하다고 판단한 문장은 애초에 안 썼을 것이므로
검수 자료가 자기 검열의 결과물이 된다. **작성자와 분석자가 달라야 §11 QA 가 실제 검증이 된다.**

**Claude Code 는 ⑤~⑨만 한다.** 원고를 새로 쓰지 않는다.
파일을 고칠 수 있는 유일한 주체에게 작성 권한까지 주면
"쓴 사람이 곧 커밋하는 사람"이 되어 원칙 4(자동 발행 경로 없음)가 무너진다.

### 9.0-1 단계별 산출물 파일

정본 구조는 매거진 전략 §5.0 이다. 도구별로 어떤 파일이 나오는지만 다시 적는다.

```
drafts/magazine/{slug}/
  brief.md            Claude 채팅   — 의도 분석 · 구조안 · ChatGPT 원고 지시서
  article-draft.ts    ChatGPT       — 최종 원고
  review.ts           Claude 채팅   — 요약 5줄 · 위험 문장 5개 · 리스크 · 확인 항목
  image-prompts.md    Claude 채팅   — hero 프롬프트 (REQUIRED 일 때만)

drafts/magazine/_template/review.ts    복사해서 쓰는 템플릿
```

**`seo-qa.md` 는 새 글부터 만들지 않는다.** QA 는 `scripts/magazine-qa.mjs` 가 돌리고,
사람이 읽는 형태는 검수 패킷이 만든다. 기존 2건은 발행 시점 스냅샷이라 그대로 둔다.

**Claude Code 는 `review.ts` 를 쓰지 않는다.** 읽고 검증하고 조립한다.
`riskSentences` 가 원고 본문에 그대로 있는지 대조하는 검사로 이 경계를 기계가 지킨다.

### 9.1 무엇을 자동화하고 무엇을 자동화하지 않는가

```
자동화한다
  승인된 topic queue 에서 오늘 항목 선택
  Claude/ChatGPT 웹 UI 로 초안 생성 · 편집 요청
  이미지 생성 요청 · 내려받기
  draft 파일 저장
  preview QA 실행

자동화하지 않는다
  topic calendar 자체를 AI 가 임의 생성·변경   ← 큐는 사람이 만든다
  원고 검수
  발행 · 커밋 · push
  색인 전환(noindex 해제) · 검색엔진 제출
  articles.ts 변경
```

**Playwright 는 창업자의 손을 대신하는 제작 보조자이지, 발행자가 아니다.**
매거진 전략 §3 "로컬 Playwright 자동화의 조건"을 전부 충족할 때만 쓴다.

주제 큐(§8)는 **사람이 만들고 사람이 고친다.** 자동화는 그 큐에서 오늘 것을 꺼내 쓸 뿐이다.
AI 가 주제를 스스로 정하기 시작하면 우나어의 "트렌드 제안 기반 자동 생성"으로 되돌아간다.

### 9.2 실제 흐름 — 창업자 복붙 0

**창업자가 brief 를 ChatGPT 창에 옮겨 붙이지 않는다.** 그 노동을 만들면 하루 1건이 유지되지 않는다.

| # | 단계 | 주체 | 산출물 |
|---|---|---|---|
| 1 | 큐에서 오늘 항목 확인 | Claude Code | topic-queue 의 day N |
| 2 | brief.md · review.ts 파일화 | Claude Code | `drafts/magazine/{slug}/` |
| 3 | ChatGPT 탭에 brief 투입 | **MCP Playwright** | — |
| 4 | 응답 완료 대기 (polling) | MCP Playwright | — |
| 5 | **원고를 blob download 로 회수** | MCP Playwright | `.playwright-mcp/{slug}.md` |
| 6 | 마크다운 → `article-draft.ts` | `scripts/magazine-md-to-draft.mjs` | `drafts/magazine/{slug}/article-draft.ts` |
| 7 | hero 이미지 생성·회수 (REQUIRED 만) | MCP Playwright | `public/magazine/{slug}/hero.webp` |
| 8 | riskSentences ↔ 원고 대조 | `scripts/magazine-packet.mjs` | — |
| 9 | 자동 QA | `scripts/magazine-qa.mjs` | — |
| 10 | 검수 패킷 | `scripts/magazine-packet.mjs` | 패킷 1장 |
| 11 | **승인** | **창업자** ★ | — |
| 12 | `articles.ts` 반영 → 승인 후 push | Claude Code | — |

**5번이 이 설계의 핵심이다.** 원고를 Claude Code 의 컨텍스트로 읽어와 다시 타이핑하면
오탈자 교정·문장 다듬기가 끼어들 여지가 구조적으로 열린다.
blob download 로 파일이 직행하면 **Claude Code 가 원고를 읽지 않고도 제자리에 놓인다.**
"Claude Code 는 최종 원고를 쓰지 않는다"가 규율이 아니라 **구조로 보장된다.**

**6번도 같은 이유로 규칙을 좁게 잡았다.** 변환기는 표·코드블록·외부 링크·이미지·h1 을
만나면 **추측해서 고치지 않고 그 줄을 짚어 되돌린다.** 추측하는 순간 원고에 개입한 것이다.

**창업자가 하는 일은 셋뿐이다.**

```
① ChatGPT 탭을 열어 로그인 상태로 둔다        1회 · 세션이 살아 있는 동안 계속 유효
② 이미지 인상 판정 "40대 후반으로 보이는가"    글당 약 10초 · REQUIRED 글만
③ 검수 패킷 승인                              LOW 30초 / MEDIUM 2분 / HIGH 10~15분
```

### 9.3 실패 시 동작 (우나어 교훈)

| 실패 | 동작 |
|---|---|
| ChatGPT/Claude 미로그인 | **즉시 중단**. 무한 대기 금지 (`chatgpt-scraper.ts:108-111`) |
| 이미지 생성 실패 | **draft를 이미지 없이 남긴다.** 임시/외부 URL로 채우지 않는다 (`local-image-generator.ts:181`) |
| QA 실패 | draft 유지 + 실패 항목 기록. **자동 재시도 금지** |
| 어느 단계든 실패 | **다음 단계로 진행하지 않는다.** 그날은 발행하지 않아도 된다 |

### 9.4 playwright 를 npm 에 설치하지 않는다 (6-H-2 확정)

도입 여부를 6-H 에서 판단하기로 했던 항목이다. **설치하지 않는 쪽으로 확정했다.**
MCP Playwright 로 Claude Code 가 대화 턴에서 브라우저를 조작한다.

| | npm 설치 + 러너 스크립트 | **MCP Playwright (채택)** |
|---|---|---|
| 새 의존성 | playwright + 브라우저 바이너리 | **0** |
| 세션 | `storageState` 파일을 로컬에 둬야 함 | **창업자 Chrome 세션 그대로** |
| CI 유출 | package.json 에 있으면 CI 도 설치 가능 | **구조적으로 불가** — MCP 는 CI 에 없다 |
| 검증 | 미검증 | **6-H-0.1 · 6-H-1 에서 3회 성공** |
| §10 "서버·CI·크론 금지" | 규칙으로만 통제 | **물리적으로 보장** |

`storageState` 를 파일로 떨어뜨리지 않는 것도 이 선택의 이득이다 —
**credentials·secret 을 코드·repo 에 두지 않는다**가 자동으로 지켜진다.

- **창업자 로컬 머신에서만 돈다.** CI·서버·크론에 올리지 않는다.
- 매거진 전략 §3 "로컬 Playwright 자동화의 조건" 7항을 **전부** 충족해야 실행 가능하다.
- 실패 시 동작은 §9.3 을 따른다. **재시도하지 않는다.**

---

## 10. 기술 안전장치

```
🚫 Claude 채팅이 최종 원고 작성     — 원고는 ChatGPT. 분석·지시서까지가 Claude 몫 (§9.0)
🚫 Claude Code 가 원고 작성        — 받은 것을 형식화·검증만 한다
🚫 자동 공개                       — 창업자 승인 없이 공개되는 경로를 만들지 않는다
🚫 자동 commit                     — 사람이 diff 를 본 뒤에만
🚫 자동 push                       — 창업자 승인 후 Claude Code 가
🚫 자동 noindex 해제               — 첫 글 발행 PR 에서 사람이 (D6)
🚫 자동 Search Console/Naver 제출  — 게이트 미달. 보류 (SEO 정책 §5)
🚫 자동 sitemap 조작
🚫 서버·CI·크론에서 실행
✅ draft-only                      — 산출물은 drafts/ 에만 쓴다
✅ 실패 시 보류                     — 로그인·이미지·QA 실패는 전부 중단
```

**draft-only 원칙**: 자동화가 쓸 수 있는 경로는 `drafts/` 뿐이다.
`src/content/magazine/articles.ts`는 **사람이 승인한 뒤에만** 바뀐다.
이 경계가 매거진 전략 원칙 4·5를 물리적으로 강제한다.

---

## 11. 글 단위 SEO QA

**자동 검사는 `scripts/magazine-qa.mjs` 가 한다.** 아래 체크리스트를 손으로 확인하지 않는다.

```bash
node scripts/magazine-qa.mjs                    # 발행 글 + draft + 충돌 검사
node scripts/magazine-qa.mjs --published        # 발행 글만
node scripts/magazine-qa.mjs --draft <경로>      # 특정 draft
node scripts/magazine-qa.mjs --json             # 다른 도구가 읽는 JSON 출력
```

FAIL 이 하나라도 있으면 종료 코드 1이고, 그 글은 **창업자에게 올리지 않는다**(전략 §5).
`runQa()` 가 export 돼 있어 검수 패킷 생성기가 import 해서 결과를 그대로 쓴다.

아래는 검사 항목의 근거 목록이다. 스크립트와 어긋나면 스크립트가 정본이다.

발행 전 전부 통과해야 한다.

```
□ title        검색 질문과 정확매칭 · 기존 글과 중복 0
□ description  직접 작성 · 기존 글과 중복 0 · 본문 자동 절단 아님
□ H1           페이지에 1개 (본문 블록에 h1 없음 — h2 부터)
□ alt          모든 이미지 (타입이 강제)
□ canonical    /magazine/{slug} 자기 경로
□ sitemap      실제 공개 글만
□ CTA          커뮤니티 게시판 링크 1개 이상
□ 의료 문구    medical: true 면 자동 부착 확인
□ 금지 표현    "시니어·어르신·노인·실버" 0건
□ 내부 링크    같은 클러스터 관련글 또는 시리즈 이전/다음
□ 분량         너무 짧지 않게. 답이 되는 만큼
```

**title·description 중복 검사가 가장 중요하다** — 우나어 duplicate 24건(F3)의 재발 방지다.

---

## 12. 소개 / CTA 템플릿

### 글 말미 CTA (전략 §4.2 5단의 마지막)

```
갱년기톡 CTA
  비슷한 증상을 겪는 분들이 갱년기톡에서 이야기를 나누고 있어요.
  여러분은 어떠셨나요? → [갱년기톡 바로가기]

자유게시판 CTA
  이런 고민, 혼자만의 것이 아니에요.
  자유게시판에서 또래들의 이야기를 들어보세요. → [자유게시판 바로가기]
```

### 소란소란 한 줄 소개 (필요 시 하단)

```
소란소란은 40대 50대 여성이 갱년기와 사는 이야기를 나누는 커뮤니티입니다.
```

⚠️ CTA는 **본문 흐름의 결론**이어야 한다. 광고 배너처럼 끼워 넣지 않는다.

---

## 13. 다음 구현 배치

```
6-G  topic calendar      §8 주제 큐 + seriesId/order 필드 (§7.3)
6-H  local draft runner  Playwright 초안·이미지 (§9) · draft-only (§10)
6-I  preview QA          §11 체크리스트 자동 검사
6-E  첫 글 발행          + /magazine noindex 해제 + sitemap 재포함 (같은 PR · D6)
```

**6-E 를 마지막에 두는 이유**: 첫 글은 제작 파이프라인이 갖춰진 뒤 그 파이프라인으로 만드는 것이 맞다.
다만 창업자가 원고를 먼저 쓰겠다면 **6-E 를 앞당겨도 된다** — 6-D 구조가 이미 배포돼 있다.

⚠️ Search Console / Naver 제출은 계속 보류한다.
게이트는 **4개 조건 AND** 다(SEO 정책 §5) — sitemap 상세 20건 · **회원 원본 글 10건** ·
최근 14일 내 회원 글 3건 · 노출면 감사 PASS.
매거진을 30건 채워도 **조건 B(회원 글 10건)는 열리지 않는다.**

---

## 14. 관련 문서

| 문서 | 역할 |
|---|---|
| `2026-08-23-soransoran-magazine-strategy.md` | **콘텐츠 원칙 정본** — 운영 원칙 10개 · AI 경계 · 발행 루틴 |
| `2026-08-23-soransoran-seo-index-policy.md` | **색인 규칙 정본** — route별 정책 · 제출 게이트 |
| `2026-08-22-soransoran-public-launch-handoff.md` | 현재 상태 스냅샷 |
| 우나어 `docs/analysis/seo-organic-diagnosis-2026-06-15.md` | 실패 진단 (읽기 전용) |
| 우나어 `docs/handover-magazine.md` | 자동화 운영 이력 (읽기 전용) |
