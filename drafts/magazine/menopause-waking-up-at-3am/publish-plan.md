# 발행 계획 — 6-E-5

> 창업자 승인 **후에** 실행한다. 이 문서는 계획이지 실행이 아니다.
> 색인 규칙은 [SEO 색인 정책](../../../docs/operations/2026-08-23-soransoran-seo-index-policy.md) 이 정본.

---

## 0. 선행 조건

```
□ 창업자가 article-draft.ts 전문을 읽고 승인
□ seo-qa.md "사실관계 확인 항목" 5개 완료
□ seo-qa.md "발행 전 눈으로 확인할 문장 5개" 확인
□ 시리즈 UI 포함 여부 결정 (§3 — 이번 발행의 유일한 실질 결정)
□ hero 이미지 생성·내려받기 완료 (image-prompts.md 1번)
□ publishedAt 날짜 확정 (현재 초안 2026-08-23. 발행이 밀리면 그날로 바꾼다)
```

**하나라도 미완이면 시작하지 않는다.**

---

## 1. 변경할 파일 (2개 · 한 PR)

| # | 파일 | 변경 |
|---|---|---|
| 1 | `src/content/magazine/articles.ts` | `MAGAZINE_ARTICLE_RECORD` 에 `'menopause-waking-up-at-3am'` 키로 글 1건 추가 |
| 2 | `public/magazine/menopause-waking-up-at-3am/hero.webp` | hero 이미지 추가 |

첫 글(6-E-1)은 4파일이었으나 이번은 2파일이다. 색인 전환(D6)이 첫 글 PR에서 이미 끝났기 때문이다.

### 변경하지 않는 파일 — 실측으로 확인함

| 파일 | 왜 안 건드리는가 |
|---|---|
| `src/app/sitemap.ts` | **글 추가만으로 자동 포함된다.** `getAllMagazineArticles().map(...)` 로 매거진 URL을 동적 생성한다(`sitemap.ts:56-61`). 손으로 URL을 넣는 구조가 아니다 |
| `src/app/magazine/page.tsx` | 이미 index 상태(`robots` 지정 없음 · canonical `/magazine`). 6-E-1에서 전환 완료 |
| `src/app/magazine/[slug]/page.tsx` | canonical·OG·twitter 전부 `article` 데이터에서 파생. 글이 늘어도 무변경 (6-E-3 구현) |
| `src/app/robots.ts` | 절대 건드리지 않는다 |
| `src/content/magazine/types.ts` | 시리즈 필드가 이미 있다 (6-G-1) |

⚠️ **단, §3에서 시리즈 UI를 함께 넣기로 하면 `[slug]/page.tsx` 가 변경 대상에 추가된다.**

---

## 2. 절차

```
① article-draft.ts 의 DRAFT 객체를 articles.ts 의 레코드에 추가한다
   - slug 는 레코드 key 로 둔다 (객체 안에 slug 필드를 넣지 않는다)
   - 기존 첫 글 항목은 건드리지 않는다
② hero.webp 를 public/magazine/menopause-waking-up-at-3am/ 에 저장
③ articles.ts 의 heroImage 에 src·alt·width(1200)·height(675) 를 전부 채운다
④ 검증: npm run typecheck / lint / build / check:tokens / git diff --check
⑤ 변경 파일 2개(또는 §3 선택 시 3개) 명시 add → 커밋 → 창업자 승인 후 push
```

⚠️ `git add .` 금지. 파일명 명시.

---

## 3. 결정이 필요한 것 — 시리즈 UI

**현재 상태(실측)**: 6-G-1에서 `getSeriesArticles`·`getAdjacentMagazineArticles` 를 만들었으나
**어느 화면에서도 쓰이지 않는다**(`src/` 사용처 0건). `MagazineSeries` 는 타입만 있고 레코드가 없다.

이 글이 시리즈 2편이 되는 순간 처음으로 "이전 글" 대상이 생긴다. 두 갈래다.

| 안 | 내용 | 장점 | 부담 |
|---|---|---|---|
| **A. 글만 발행** | articles.ts + hero 만. 시리즈 UI는 별도 배치 | 변경 2파일 · 리스크 최소 | 시리즈 데이터가 화면에 안 보이는 상태가 이어짐 |
| **B. 시리즈 UI 동시 발행** | `[slug]/page.tsx` 에 이전/다음 링크 추가 | 두 글이 서로 이어짐. 내부링크가 실제로 생김(제작 전략 §7.2) | 변경 3파일 · UI 검증 추가 |

**권장: A.** 이유 — `cluster: 'menopause-symptom'` 덕분에 **관련글로 이미 두 글이 상호 연결된다**(seo-qa ②).
내부링크가 0인 상태가 아니므로 급하지 않고, 시리즈 UI는 3편째부터 값이 커진다.
`MAGAZINE_SERIES` 레코드·시리즈 목차까지 함께 설계하는 편이 낫다(6-G-2 범위).

B를 택하면 `getAdjacentMagazineArticles(article)` 반환값이 `{}` 일 때 섹션을 렌더하지 않는지 반드시 확인한다.

---

## 4. 배포 후 PASS 기준

| # | 확인 | 기대 |
|---|---|---|
| 1 | `/magazine/menopause-waking-up-at-3am` | 200 · canonical **자기 경로** · robots meta 0건 |
| 2 | `/magazine` 목록 | 카드 **2개** 렌더 · 최신 글이 위 (publishedAt desc) |
| 3 | `og:image` | `https://soransoran.com/magazine/menopause-waking-up-at-3am/hero.webp` |
| 4 | `og:image:width` / `height` | 1200 / 675 |
| 5 | `og:image:alt` | 존재 · 무의미한 값 아님 |
| 6 | `twitter:card` | `summary_large_image` |
| 7 | `article:published_time` | 확정한 publishedAt |
| 8 | `/sitemap.xml` | 새 글 URL **자동 포함** · 총 8 URL (기존 7 + 1) |
| 9 | `/robots.txt` | **무변경** |
| 10 | 첫 글 `/magazine/when-does-menopause-start` | 200 유지 · 관련글에 새 글 **노출**(같은 cluster) |
| 11 | 의료 문구 | 하단에 상담 권장 문구 렌더 (`medical: true`) |
| 12 | 없는 slug | 404 유지 (`force-dynamic` + `notFound()`) |
| 13 | vercel.app 유출 | 전 표면 0건 |
| 14 | 모바일 390px | 가로 스크롤 0 · CTA 터치 52px 이상 |

---

## 5. 되돌리기

문제 발견 시 **`git revert`** 로 2파일을 함께 되돌린다.
글만 빼고 이미지를 남기면 참조 없는 파일이 남고, 이미지만 빼면 빌드가 막힌다(`MagazineImage` 필수 필드).

---

## 6. 계속 금지

```
🚫 Search Console / Naver 제출
   게이트: 공개 회원 글 + 매거진 글 20~30건
   현재 회원 글 3 + 매거진 1 = 4건. 이 글을 내도 5건이다 — 제출하지 않는다 (SEO 정책 §5)
🚫 SORAN_ALLOW_INDEXING 변경
🚫 robots.ts 수정
🚫 /magazine index 상태 변경 (현재 index 유지)
🚫 JSON-LD 구현 (별도 배치)
🚫 자동 발행 · 자동 commit · 자동 push
```

---

## 7. 이 글 이후

- **6-G-2** 60일 주제 큐 코드화 — 이 글이 `menopause-basic` #2가 되면서
  전략서 §8의 #2(안면홍조, day 4)가 #3으로 밀린다. 큐에 반영 필요 (seo-qa ④)
- **시리즈 UI + `MAGAZINE_SERIES` 레코드** — §3에서 A를 택했다면 여기서 처리
- **JSON-LD `Article`** — 글 5건 전까지가 소급 작업을 피할 마지노선
