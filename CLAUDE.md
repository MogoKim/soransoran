# 소란소란 — Claude Code 지시사항

## 프로젝트 개요

- 서비스: **소란소란** | 도메인: soransoran.com
- 본질: **40대 중반~60대 중반 여성 커뮤니티** (핵심 타겟 50대). 시작점은 갱년기
- Next.js 14 App Router + TypeScript strict
- Supabase + Prisma (**Raw SQL 절대 금지**)
- NextAuth v5 카카오 전용
- Tailwind + CSS Variables semantic token / Pretendard Variable
- `cn()` = clsx + tailwind-merge / 컴포넌트 PascalCase · 파일 kebab-case

## 🔴 이 저장소는 우나어가 아니다

- **우나어(age-doesnt-matter) repo 를 fork 하지 않았다.** 구조와 패턴만 선별 참고했다.
- 우나어의 **자산·인프라·도메인·계정은 완전히 분리**되어 있다.
- 우나어 repo 파일을 이 저장소로 복사할 때는 **반드시 브랜드 문자열을 제거**하고 이식한다.

### 절대 가져오지 않는 것

```
로고 · OG · favicon · manifest · public asset · 3원 심볼
.env 값 · token · DATABASE_URL · Kakao client id/secret/callback
naver-site-verification · GSC · AdSense ID
sitemap/robots/canonical 을 그대로 복사하는 행위
agents/ · .github/workflows/ · prisma/migrations/ · seed.ts
우나어 게시글·매거진 콘텐츠
unao-* localStorage 키
"시니어·어르신·노인·실버" 표현 (코드 주석 포함)
```

## 판단 기준

- **North Star**: 주간 재방문 참여 유저 수 (재방문 + 글/댓글 1회 이상 고유 사용자)
- **본질은 커뮤니티다.** 병원 정보 사이트도, 일자리 플랫폼도 아니다
- **"실제 유저 참여는 열고, 봇이 활발한 척하는 것은 막는다"**
- 헷갈리면 묻는다: *"이 작업이 회원이 댓글을 쓰게 만드는 데 기여하는가?"*

## 제품/브랜드 규칙

- **"시니어·어르신·노인·실버" 절대 금지** → "우리 나이", "우리 또래", "40대 50대 여성", "인생 2막"
- **네비게이션**: 하단 탭바 ✕ → 상단 메뉴 행 + 플로팅 FAB("✏️ 글쓰기")
- **IA 정본**
  - 갱년기톡 · 자유게시판 = **게시판**
  - 매거진 = **콘텐츠 영역** (게시판 아님 · 글쓰기 버튼 노출 금지)
  - 베스트 = **모아보기 영역** (게시판 아님 · 글쓰기 진입점 없음)
- 매거진 글이 커뮤니티 리스트에 섞이지 않게 한다

## 🎨 색상 규칙 (가장 자주 위반되는 지점)

```
--brand      #FF6F61   브랜드 시그니처
--brand-ink  #FF6F61   읽는 브랜드색 (링크·워드마크·배지 텍스트) — brand 와 같은 원색
--link       #FF6F61   링크 — brand-ink 와 같은 값
--cta        #B64235   누르는 것 (FAB·버튼) 흰 글씨 5.50:1
```

### 절대 준수

1. **hex literal 은 `src/app/globals.css` 에만 존재한다.** 컴포넌트에 직접 쓰지 않는다
2. `bg-[#FF6F61]` 같은 임의값 클래스 금지
3. `#FF6F61` 은 읽는 브랜드색이다. 다만 **흰 글씨 CTA**에는 여전히 쓰지 않는다
   (대비 낮음 — 바탕 2.46:1 · 카드 2.73:1 · 배지면 2.33:1. 원색감 우선 결정, 2026-08-29)
4. 워드마크는 `--brand-ink` 기본 — 지금은 `--brand` 와 같은 값이다
5. FAB · primary button · empty state button 은 **전부 `--cta` 하나**를 쓴다
6. 링크·활성 탭·배지 텍스트는 **전부 `--brand-ink` 하나**를 쓴다
7. `danger` 는 fill 버튼을 쓰지 않는다 — 아이콘 + 문구 + 확인 모달을 동반한다

> 검증: `npm run check:tokens`

### 로고

- **`src/components/brand/Logo.tsx` 가 단일 진입점이다**
- 페이지·컴포넌트에서 로고를 직접 마크업하지 않는다
- 헤더 로고 슬롯은 **가로형**이다. 정사각 슬롯 금지

## 글자 크기 3단계

```
선택지  작게 / 기본 / 크게      기본값  기본
저장키  soran-font-size (단일 키) — unao-* 금지
하한    "작게" 는 16px 아래로 내리지 않는다
```

변경 시 **3단계 전부**에서 검증: 게시글 목록 말줄임 · 버튼 텍스트 넘침 ·
메뉴 한 줄 유지 · 카드 높이 · 모바일 767px.

## 🚫 활발한 척 금지

```
❌ 접속자 수 / "지금 N명이 보고 있어요"
❌ 실시간 활동 배지 · 총 게시글 수 · 회원 수
❌ 붉은 알림 도트 남발
❌ 봇 글·댓글로 채우기
```

초기에는 숫자가 작다. 숫자는 **실제로 커진 뒤에** 넣는다.

## 코딩 원칙

- TypeScript `any` 금지 / 서버 컴포넌트 기본, `'use client'` 최소화
- 이미지는 `next/image` 필수
- **DB 스키마 변경**: `prisma migrate` · `db push` · `db seed` **금지**
- 목록·상세 쿼리에 **`UserBlock` 필터를 반드시 적용**한다
  (차단 UI 를 숨기더라도 필터는 넣는다. 저장만 하고 필터가 없으면 미구현보다 나쁘다)

## 검증 명령 (코드 변경 후 반드시)

```bash
npm run typecheck     # tsc --noEmit
npm run lint
npm run build
npm run check:tokens  # 색상 리터럴 가드
```

배포 전: 모바일 767px 반응형 · 터치 타겟 52px · 글자 크기 3단계 확인

## 작업 방식

1. **문제 정의 먼저**: 문제 정의 → 원인 분석 → 해결 계획 → 검증 방법
2. **가정 금지**: 함수 동작을 추측하지 말고 Read 로 직접 읽는다
3. **검증 없이 "완료" 금지**: typecheck·build 통과 확인 필수
4. **수동 블로킹 작업 먼저 요청**: DB · Secrets · 외부 콘솔 · `.env.local`
5. **완료 보고**: ① 뭘 했는지 ② 어디에 기록했는지 ③ 앞으로 뭐가 달라지는지
6. **커밋은 파일명 명시.** `git add .` 금지
