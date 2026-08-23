# 소란소란 public launch 이후 세션 핸드오프

> **작성** 2026-08-22 · **대상** 다음 Codex / Claude 세션
> **목적** 이전 대화 전문 없이도 작업을 정확히 이어받는다.
> **기준 커밋** `733f9339a4d7d673e3d107e659b216a64a9c8a4b`

---

## 0. 먼저 할 일 (이 문서를 읽은 직후)

```bash
cd /Users/yanadoo/Documents/soransoran
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
```

기대값과 대조한다.

```
## main...origin/main        (ahead 0 · 작업트리 깨끗)
HEAD        = origin/main = 733f9339a4d7d673e3d107e659b216a64a9c8a4b
```

**문서와 실제가 다르면 실제를 믿고, 문서를 먼저 정정한 뒤 작업한다.**
그 다음 §5의 Batch 1C read-only 감사부터 시작한다.

---

## 1. 현재 운영 상태

### 서비스

| 항목 | 값 |
|---|---|
| 운영 도메인 | **https://soransoran.com** (DNS 연결 완료 · Vercel A 216.198.79.1) |
| repo | `MogoKim/soransoran` (private · 우나어 fork 아님) |
| latest commit | `733f933` — `feat: add PostCard with three-level text hierarchy` |
| 총 커밋 | 12개 · `src` 53파일 · 2,891행 |
| 로컬 경로 | `/Users/yanadoo/Documents/soransoran` |

### 색인 — 🟢 **허용됨** (2026-08-22 전환)

```
SORAN_ALLOW_INDEXING = true   (Vercel Production + Preview)

robots.txt
  User-Agent: *
  Allow: /
  Disallow: /api/
  Disallow: /admin/
  Sitemap: https://soransoran.com/sitemap.xml
```

⚠️ `robots.ts`는 **정적 생성**이다. env를 바꾸면 **캐시 없는 재배포**가 필요하다.

### sitemap / canonical

```
sitemap    홈 + 커뮤니티 2면 + 공개글 (동적, force-dynamic)
           전부 soransoran.com · vercel.app 0건
           매거진 · 베스트는 발행 경로가 없어 제외 (3cbd842)
           2026-08-23 실측 6건 — 글이 삭제되면 즉시 줄어든다(정상)
canonical  색인 대상 경로 개별 지정 · vercel.app 0건
```

### route별 색인 상태 (2026-08-23 실측 · `3cbd842`)

| route | robots meta | canonical | sitemap |
|---|---|---|---|
| `/` | 없음(index) | `/` | ✅ |
| `/community/menopause` · `free` | 없음(index) | 자기 경로 | ✅ |
| `/community/*/[postId]` | 없음(index) | 자기 경로 | ✅ (PUBLISHED만) |
| `/magazine` · `/best` | `noindex, follow` | 자기 경로 유지 | ❌ |
| `/write` · `/login` | `noindex, nofollow` | 상속(무시됨) | ❌ |
| `/admin/reports` | `noindex, nofollow` | 상속(무시됨) | ❌ + robots.txt 차단 |

⚠️ `layout.tsx`의 `canonical: '/'`는 **전역 상속**된다.
색인 대상 페이지는 반드시 자기 경로를 개별 지정한다. 판단 기준은
[SEO 색인 정책](./2026-08-23-soransoran-seo-index-policy.md) 원칙 4·5.

🔴 **`NEXT_PUBLIC_APP_URL`이 비면 `VERCEL_URL`(배포별 URL)로 폴백**된다. Production에 반드시 설정돼 있어야 한다. (`src/lib/brand.ts` `resolveSiteUrl`)

### route 상태 (2026-08-22 실측 · 전부 200)

```
/  /community/menopause  /community/free  /magazine  /best
/write  /login  /terms  /privacy  /admin/reports  /api/auth/csrf
```

### 기능 검증 상태

| 기능 | 상태 | 비고 |
|---|---|---|
| Kakao 로그인 | ✅ 운영 도메인 실사용 확인 | Redirect URI 등록 완료 |
| 글쓰기 | ✅ 실사용 확인 | 로그인 회원만 |
| 댓글 | ✅ 실사용 확인 | 1단만 (대댓글 UI 없음) |
| 신고 | ✅ 실사용 확인 | "신고가 접수됐습니다" 확인 |
| 작성자 삭제 | ✅ 배포 확인 | soft delete · 목록/상세/sitemap에서 제외 확인 |
| `/admin/reports` | ✅ 접근 제어 확인 | 비로그인 차단 · noindex |
| DB | ✅ Supabase `buougdxmfobjilgjnnby` | pooler 6543 + `?pgbouncer=true` / DIRECT 5432 |

---

## 2. 완료된 마일스톤

```
① scaffold                c0960f5  Next.js 14 · 토큰 20개 · 우나어 asset 0건
② URL 안전 fallback        05c2c8c  빈 env 로도 빌드되게 (Vercel 배포 실패 수정)
③ P0 private preview      79bc862  Kakao auth · 글 · 댓글 배선
④ P1 safety controls      8c975e7  rate limit · 금칙어 · 신고
⑤ 검색·공유 표면          e4e0b50  favicon · OG · canonical · 글 sitemap
⑥ hotfix                  d15d2dc  report reasons client-safe
⑦ 법무·운영 방어선         44e33cb  약관 14조 · 개인정보 12항 · admin · error 화면
⑧ 작성자 삭제             a557f4d  soft delete (글 status · 댓글 isDeleted)
⑨ auth 헤더 · canonical    07de222  로그인 상태 UI · 로그아웃 · magazine/best canonical
⑩ 목록 미리보기·시각       9139382  U1 U2
⑪ Batch 1A                052b7fa  PageShell · FAB (Header 11곳 · FAB 2곳 중복 제거)
⑫ Batch 1B                733f933  PostCard 3단 위계
```

### DNS · 색인 (커밋 외)

```
soransoran.com DNS 연결 → 운영 도메인 검증 → SORAN_ALLOW_INDEXING=true → 캐시 없는 재배포
테스트 글 정리 완료 (soft delete)
최소 콘텐츠 2건 발행 (갱년기톡 1 · 자유게시판 1)
```

---

## 3. 지금 진행 중인 제품화 방향

### 원칙

```
1. 우나어 UI/UX 는 적극 참고한다 — 실패를 겪고 고친 값이라 근거가 있다
2. 코드는 복붙하지 않는다 — 패턴만 가져와 소란소란 기준으로 재구성한다
3. 우나어의 SEO/외부글/크롤/봇/광고 의존 구조는 가져오지 않는다
4. 주석 과다 · 하드코딩 · 중복은 초반에 정리한다 (지금이 가장 싸다)
```

### 우나어 참고 위치 (읽기 전용)

```
/Users/yanadoo/Documents/unao-main

가치 높은 레퍼런스
  src/components/features/community/PostCard.tsx   3단 위계 · 덩어리 간격 (설계 근거 주석)
  src/components/layouts/FAB.tsx                   노출 여부 + 목적지 통합 판정
  src/components/layouts/MainLayout.tsx            조립 구조 · skip nav
  src/components/common/FontSizeProvider.tsx       inline script 폴백 일치 경고

가져오지 않을 것
  CommentSection.tsx (636행) · PostWriteForm.tsx (680행) — 게스트/TipTap/업로드 얽힘
  GuestCommentInput · GuestPasswordModal           로그인 회원만 정본
  ListBanner · DetailHeaderBanner · TopPromoBanner  광고
  BoardViewTracker · TrackedPostLink · PostCTA      트래킹
  HOT/FAME 배지 · --gradient-hot/fame               "활발한 척" 금지
  agents/ · workflows · 외부글 수집                 전량
```

### 이미 정리한 것

```
Header 중복 11곳 → PageShell 1곳
FAB 인라인 2곳 → FAB 컴포넌트 1곳 (경로별 목적지 자동)
목록 카드 인라인 → PostCard 컴포넌트
텍스트 위계 2단 → 3단 (--text-secondary 신설, 카드 위 9.08:1)
```

### 코드 품질 현황

```
🟢 색상 hex 리터럴   토큰 파일 외 0건 (npm run check:tokens 가드)
🟢 any               0건
🟢 TODO/FIXME        0건
🟢 제출 버튼 중복     ActionButton 으로 통합 (2843f18)
🟢 textarea 자동확장  useAutoResize 훅으로 통합 (2843f18)
🟢 색인 표면          route별 robots·canonical 정리 (3cbd842)
🟡 에러 문구 분산     "로그인이 필요합니다" 5건/4파일 → messages.ts (Batch 3)
🟡 상세 boardSlug     불일치해도 200 — notFound() 처리 필요 (SEO 정책 §8)
```

---

## 4. 미구현 실측 (2026-08-22 기준)

```
글자 크기 토글 UI    0건   — data-font-size 스크립트만 있고 바꿀 수단이 없다
Upstash 의존성       0개   — rate limit 이 인메모리라 서버리스에서 느슨하다
매거진 DB 조회       0건   — /magazine 이 정적 EmptyState 만 렌더, 발행 경로 없음
대댓글 UI            0건   — schema 에 parentId 는 있으나 화면 없음
```

---

## 5. 다음 우선순위

### 🥇 Batch 1C — 상세 · 댓글 UI (read-only 감사 먼저)

```
목표   글 상세와 댓글이 "읽고 쓰고 싶은" 화면이 되게 한다

먼저 read-only 감사
  소란소란  src/app/community/[boardSlug]/[postId]/page.tsx (123행)
            src/components/features/CommentForm.tsx
            src/lib/queries/posts.ts (getPostDetail)
  우나어    features/community/CommentItem.tsx (359행) — 구조만
            features/community/CommentDock.tsx (169행) — 입력 고정 패턴

감사 후 구현 (별도 승인)
  상세 본문 여백 (leading-relaxed · 문단 간격)
  댓글 목록 컴포넌트 분리
  댓글 입력 UX (모바일 고정 여부 판단)
  대댓글은 이번에도 보류 — 1단이 안정된 뒤

리스크  상세는 canonical·OG가 걸려 있다. metadata 회귀 주의
```

### 🥈 Batch 2 — 글쓰기 UX · 글자크기 · 공통 컴포넌트

```
글자 크기 토글 (작게/기본/크게 · 기본값 기본 · soran-font-size)
  🔴 layout.tsx inline script 폴백과 Provider 기본값이 반드시 같아야 한다
     다르면 첫 페인트에 크기 점프가 생긴다 (우나어 주석 경고)
  🔴 3단계 전부에서 목록·버튼·메뉴·카드 검증 (정본 §8)

글쓰기 최소 길이 안내 (제목 2자 · 본문 10자 — 지금은 제출해야 알 수 있다)
공통 Button / Field 컴포넌트 (CTA 7곳 · input 10곳 중복 해소)
```

### 🥉 Batch 3 — 토큰 · 문구 · 주석 · 중복

```
src/lib/messages.ts 신설 (에러·안내 문구)
status:'PUBLISHED' 필터를 쿼리 헬퍼로 (현재 4곳 분산)
상세 route boardSlug 불일치 시 404 처리 (SEO 정책 §8 · duplicate URL 방지)
board.type as BoardType 단언 제거
layout.tsx "scaffold 단계에서는 CDN" 주석 정정 (실제로는 운영 중)
```

### 이후

```
Upstash rate limit 전환   env 2개 등록 후 (UPSTASH_REDIS_REST_URL / TOKEN)
매거진 발행 경로          구조 배포 완료 (6-D) — 남은 순서
  6-B  전략 문서           ✅ magazine-strategy.md
  6-C  v0 구조 감사        ✅ TS 데이터 파일 + 블록 배열 확정
  6-D  v0 구현             ✅ 목록 + 상세 route (d0516a6 · 9ab299d)
  6-F  제작 운영 전략      ✅ magazine-seo-production-strategy.md
  6-G  topic calendar      주제 큐 + seriesId/order 필드
  6-H  local draft runner  Playwright 초안·이미지 (draft-only · 자동 커밋/푸시 금지)
  6-I  preview QA          글 단위 SEO 체크 자동화
  6-E  첫 글 발행          + /magazine noindex 해제 + sitemap 재포함 (같은 PR)
                          🔴 IA 정본: 매거진에 회원 글쓰기 노출 금지
                          🔴 DB/admin 발행은 보류 (전환 조건: 전략 문서 §6)
Pretendard self-host      현재 CDN · public/fonts/pretendard/README.md 참조
카톡 OG 카드 확인          아직 미검증
```

### ⏸️ 보류

```
Search Console / Naver Search Advisor 등록
  게이트: 공개 회원 글 + 매거진 글 20~30건 (2026-08-23 실측 3건 · 매거진 0건)
  순서:   네이버 먼저 → 구글 → 2주 색인 관찰
  근거·해제 절차: docs/operations/2026-08-23-soransoran-seo-index-policy.md §5
```

⚠️ 색인 0이면 **재제출이 아니라 원인 조사**다.
"수집 요청을 많이 하면 회복된다"는 우나어가 실측으로 폐기한 오해다.

---

## 6. 절대 금지

```
🚫 우나어 repo(/Users/yanadoo/Documents/unao-main) 수정 — 읽기 전용 참고만
🚫 scaffold 재생성
🚫 DB migration / seed / SQL 실행
🚫 secret · password · connection string 출력
🚫 git add .  — 항상 파일명 명시
🚫 승인 없는 push
🚫 Search Console / Naver 작업
🚫 SORAN_ALLOW_INDEXING 임의 변경
🚫 우나어 asset(로고 · OG · favicon · manifest) 복사
🚫 봇 · 자동발행 · 외부글 수집 도입
🚫 "활발한 척" UI (접속자 수 · 실시간 배지 · 가짜 인기글)
```

---

## 7. 작업 규칙

### 커밋 · push

```
1. 변경 후 검증 4종
     npm run typecheck
     npm run lint
     npm run build
     npm run check:tokens
2. git diff --check
3. 파일명 명시 add → git status 로 staged 재확인
4. 커밋
5. push 는 창업자 승인 후

⚠️ git push origin main 은 PreToolUse 훅이 차단한다.
   승인 시 다음 형태를 쓴다.
     git push origin refs/heads/main:refs/heads/main
```

### 로컬 검증의 한계

```
.env.local 에 DIRECT_URL 만 있고 DATABASE_URL · AUTH_SECRET 이 없다.
→ 로컬 next start 에서 /community/* 와 auth 경로가 500 이다. 코드 오류가 아니다.
→ DB 를 쓰는 화면은 배포 후 https://soransoran.com 에서 확인한다.
```

### 배포 후 smoke 기본 세트

```
route 200        / · /community/menopause · /community/free · /write · /login
                 /terms · /privacy · /admin/reports
FAB              홈 /write · 보드 /write?board={slug} · admin·login 0개
중복 렌더        header 1 · footer 1 · main 1
robots           Allow:/ · /api/ · /admin/ · 전체차단 0
색인             / 에 robots meta 없음 (홈 index 유지 — 가장 중요)
                 /write · /login 에 noindex, nofollow
                 /magazine · /best 에 noindex, follow + canonical 유지
                 /community/* · 상세 에 robots meta 없음 · canonical 자기 경로
sitemap          홈 + 커뮤니티 2면 + 공개글만
                 /magazine · /best · /write · /login · /admin 0건
유출             sitemap · canonical 에 vercel.app 0건
```

---

## 8. 관련 문서

| 문서 | 위치 | 내용 |
|---|---|---|
| 브랜드/디자인 정본 | 우나어 repo `docs/operations/soransoran-brand-design-spec.md` | 컬러 토큰 20개 · 워드마크 조건 · 금지 시각 요소 |
| D-7~D+90 작전표 | 우나어 repo `docs/operations/soransoran-d7-dday-milestone.md` | blocker · IA 정본 |
| D-day 운영 기준 | 우나어 repo `docs/operations/m3-new-brand-readiness.md` §13 | 정상/장애 판정 |
| 작업 지침 | 우나어 repo `docs/operations/soransoran-agent-guidelines.md` | 에이전트 규칙 |
| 이 저장소 규칙 | `CLAUDE.md` · `AGENTS.md` | 색상·로고·글자크기·금지사항 |
| **SEO 색인 정책** | `docs/operations/2026-08-23-soransoran-seo-index-policy.md` | 원칙 10개 · route별 정책 · 제출 게이트 · 되돌리기 조건 |
| **매거진 전략** | `docs/operations/2026-08-23-soransoran-magazine-strategy.md` | 운영 원칙 10개 · AI 사용 경계 · 주제 클러스터 · 발행 루틴 · v0 전제 |
| **매거진 SEO 제작 운영** | `docs/operations/2026-08-23-soransoran-magazine-seo-production-strategy.md` | 검색 유입 설계 · 365일 주제 비율 · 시리즈 · 30일 주제안 · 제작 자동화 · 안전장치 |
| 우나어 네이버 색인 붕괴 | 우나어 repo `docs/operations/2026-08-20-naver-survival-representative-index-strategy.md` | 실패 원인 · 폐기된 오해 (읽기 전용) |

⚠️ 정본 문서 4종은 **우나어 repo에 있다**(main 확정본). 소란소란 repo로 옮기지 않았다.

---

## 9. 한 줄 요약

> **소란소란은 launch 했고 색인도 열렸다. 지금은 "돌아가는 서비스"를 "제품"으로 만드는 단계다.**
> 우나어의 UX를 참고하되 코드는 소란소란 기준으로 다시 짠다. 다음은 Batch 1C 상세·댓글 감사다.
