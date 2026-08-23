# 발행 계획 — 6-E-1

> 창업자 승인 **후에** 실행한다. 이 문서는 계획이지 실행이 아니다.
> 색인 규칙은 [SEO 색인 정책](../../../docs/operations/2026-08-23-soransoran-seo-index-policy.md) 이 정본.

---

## 0. 선행 조건

```
□ 창업자가 article-draft.ts 전문을 읽고 승인
□ seo-qa.md 의 "창업자 확인 항목" 7개 완료
□ 이미지 사용 여부 결정 (없이 발행도 가능)
□ publishedAt 날짜 확정
```

**하나라도 미완이면 시작하지 않는다.**

---

## 1. 변경할 파일 (4개 · 한 PR)

| # | 파일 | 변경 |
|---|---|---|
| 1 | `src/content/magazine/articles.ts` | `MAGAZINE_ARTICLE_RECORD` 에 `'when-does-menopause-start'` 키로 글 1건 추가 |
| 2 | `public/magazine/when-does-menopause-start/` | 이미지 추가 (선택) |
| 3 | `src/app/magazine/page.tsx` | `robots: { index: false, follow: true }` **한 줄 제거** |
| 4 | `src/app/sitemap.ts` | `/magazine` + 매거진 글 URL 포함 |

**쪼개지 않는다.** 먼저 noindex 를 풀면 빈 페이지가 색인되고,
먼저 글만 올리면 색인되지 않는 글이 생긴다 (전략 D6).

---

## 2. 절차

```
① article-draft.ts 의 DRAFT 객체를 articles.ts 로 옮긴다
   - slug 는 레코드 key 로 (객체 안에 slug 필드를 두지 않는다)
   - heroImage 는 이미지를 넣을 때만
② 이미지가 있으면 public/magazine/when-does-menopause-start/ 에 커밋
③ magazine/page.tsx 의 robots 줄 제거 · canonical '/magazine' 은 유지
④ sitemap.ts 에 매거진 포함
   - 정적: COMMUNITY_BOARDS → MENU_BOARDS 로 되돌리거나 /magazine 만 추가
   - 동적: getAllMagazineArticles() 로 글 URL 생성
⑤ 검증 5종
⑥ 4파일 명시 add → 커밋 → 창업자 승인 후 push
```

⚠️ `robots.ts` 는 건드리지 않는다. `SORAN_ALLOW_INDEXING` 도 변경하지 않는다.

---

## 3. 배포 후 PASS 기준

| # | 확인 | 기대 |
|---|---|---|
| 1 | `/magazine` | 200 · **robots meta 없음** · canonical `/magazine` |
| 2 | `/magazine` 목록 | 첫 글 카드 1개 렌더 |
| 3 | `/magazine/when-does-menopause-start` | 200 · canonical **자기 경로** · robots meta 없음 |
| 4 | 없는 slug | 404 유지 |
| 5 | `/sitemap.xml` | `/magazine` **포함** · 첫 글 URL **포함** |
| 6 | `/robots.txt` | **무변경** (`Allow: /` · `Disallow: /api/` · `/admin/`) |
| 7 | vercel.app 유출 | 전 표면 **0건** |
| 8 | 의료 문구 | 상세 하단에 상담 권장 문구 렌더 (`medical: true`) |
| 9 | `/` · `/community/*` | robots meta 없음 유지 (홈 index 회귀 없음) |
| 10 | 이미지 | 넣었다면 alt 존재 · 안 넣었으면 레이아웃 정상 |

---

## 4. 되돌리기

발행 후 문제가 발견되면 **`git revert`** 로 4파일을 함께 되돌린다.
글만 빼고 noindex 를 두면 빈 페이지가 색인된 상태가 남는다.

---

## 5. 계속 금지

```
🚫 Search Console / Naver 제출
   게이트: 공개 회원 글 + 매거진 글 20~30건 (현재 회원 글 3 + 매거진 0)
   첫 글을 냈다고 제출하지 않는다 — SEO 정책 §5
🚫 SORAN_ALLOW_INDEXING 변경
🚫 robots.ts 수정
🚫 자동 발행 · 자동 commit · 자동 push
```
