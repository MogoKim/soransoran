# 소란소란 — Claude Code 지시사항

공통 지침(저장소 정체성 · 권위 문서 · 역할 · 위험 경계 · 기본 검증)은 아래 파일 하나에 있다. 여기 복제하지 않는다.

@AGENTS.md

정본은 [`docs/operations/NORTH-STAR.md`](docs/operations/NORTH-STAR.md) ·
[`docs/operations/2026-09-21-d100-goal-canon.md`](docs/operations/2026-09-21-d100-goal-canon.md) ·
[`docs/operations/CURRENT-MILESTONE.md`](docs/operations/CURRENT-MILESTONE.md) 셋이다(순서·역할은 위 공통 지침).
아래는 **Claude Code 실행에만 필요한 차이**다.

## 프로젝트 개요

- Next.js 14 App Router + TypeScript strict
- Supabase + Prisma (**Raw SQL 절대 금지**)
- NextAuth v5 카카오 전용
- Tailwind + CSS Variables semantic token / Pretendard Variable
- `cn()` = clsx + tailwind-merge / 컴포넌트 PascalCase · 파일 kebab-case

## 제품/브랜드 규칙

- **"시니어·어르신·노인·실버" 절대 금지** → "우리 나이", "우리 또래", "40대 50대 여성", "인생 2막"
- **네비게이션**: 하단 탭바 ✕ → 상단 메뉴 행 + 플로팅 FAB("✏️ 글쓰기")
- **IA 정본**
  - 갱년기톡 · 자유게시판 = **게시판**
  - 매거진 = **콘텐츠 영역** (게시판 아님 · 글쓰기 버튼 노출 금지)
  - 베스트 = **모아보기 영역** (게시판 아님 · 글쓰기 진입점 없음)
- 매거진 글이 커뮤니티 리스트에 섞이지 않게 한다

## 🎨 색상 규칙 (가장 자주 위반되는 지점)

🔴 **정본은 여기가 아니다.** 색과 글자 크기의 단일 진실은
[`docs/operations/soransoran-brand-design-spec.md`](docs/operations/soransoran-brand-design-spec.md) 다
(색 §0~§9 · 타이포 §12). 값이 어긋나면 **그 문서가 맞고 여기가 틀린 것**이다.
아래는 매번 문서를 열지 않도록 둔 요약이며, 고칠 때는 정본을 먼저 고친다.

정의 위치: `src/app/globals.css` (화면 토큰) · `src/lib/brand.ts` (metadata·manifest·OG)
매핑 위치: `tailwind.config.ts`

```
--brand         #FA4601   브랜드 시그니처 · 면(워드마크·포인트·CTA 면)
--brand-ink     #FA4601   🔴 큰 글씨 전용 브랜드색 (18.66px+bold · 24px+)
--brand-strong  #C43300   🔴 작은 글씨 브랜드색 (버튼 라벨·배지·메타)
--link          #C43300   링크 — brand-strong 과 같은 값 · 밑줄 필수
--cta           #FA4601   누르는 것 (FAB·버튼) — --brand 와 같은 원색
--cta-content   #FFFFFF   🔴 고객 primary CTA 의 글자·아이콘 (#FA4601 위 3.53:1)
```

### 🔴 원색 하나로 다 칠하지 않는다 — 크기로 가른다

`#FA4601` 텍스트는 흰 카드 위 **3.53:1** 이다. 큰 글씨(3.0)는 통과하고 작은 글씨(4.5)는 미달한다.
그래서 **읽는 브랜드색이 두 개**다. 헷갈리면 "이 글자가 18.66px 굵은 글씨보다 큰가"를 먼저 묻는다.

| 자리 | 토큰 | 값 |
|---|---|---|
| 워드마크 · 목록 순번 · 댓글 수 (큰 글씨) | `--brand-ink` | `#FA4601` (3.53:1) |
| 버튼 라벨 · 배지 텍스트 · 메타 · 링크 (작은 글씨) | `--brand-strong` · `--link` | `#C43300` (5.50:1) |

### 절대 준수

1. **hex literal 은 `src/app/globals.css` 에만 존재한다.** 컴포넌트에 직접 쓰지 않는다
2. `bg-[#FA4601]` 같은 임의값 클래스 금지 — 어떤 hex 든 마찬가지다
3. **고객 primary CTA·FAB 는 `--cta` 면 + `--cta-content` 흰 글씨**다.
   🔴 이 흰색은 **크기 계약과 한 몸**이다 — `text-lg` + `font-bold` 없이 쓰지 않는다
   (3.53:1 은 큰 굵은 글씨 3.0 기준으로만 통과한다)
4. 🔴 **운영 콘솔 CTA 는 예외 — 흰 글씨를 쓰지 않는다.** 라벨이 17px 이라
   흰색이 본문 4.5 에 미달한다. 거기는 `--text-primary` 먹색(`#FA4601` 위 **4.65:1**)이다
5. 워드마크는 `--brand-ink` 기본 — 지금은 `--brand` 와 같은 값이다
6. FAB · primary button · empty state button 의 **면**은 전부 `--cta` 하나를 쓴다
7. 링크·활성 탭·**작은** 배지 텍스트는 `--brand-strong`(=`--link`)을 쓴다.
   `--brand-ink` 는 큰 글씨에만 쓴다
8. `danger` 는 fill 버튼을 쓰지 않는다 — 외곽선 + 문구 + 확인창을 동반한다

> 🕘 **이전 팔레트는 코랄 `#FF6F61` (CTA `#B64235`) 이었다.**
> `src/app/globals.css` 에서 `#fa4601` 을 들여온 첫 커밋은
> `400994e feat(brand): apply warm monochrome color system` (2026-09-07) 이고,
> 같은 커밋에서 `#ff6f61` 이 사라졌다. 이 문단의 근거는 그 커밋 하나다 —
> 그 밖의 경위는 정본 §1-1 의 기록을 본다.
> 🔴 **이 기록은 소란소란의 옛 팔레트 설명이다.** 우나어(age-doesnt-matter)의 디자인 규칙을
> 평가하거나 변경하는 근거가 아니다. 우나어의 색·문서는 그 저장소의 판단이며 여기서 다루지 않는다.

> 검증: `npm run check:tokens` · `npm run check:brand-colors` · `npm run check:contrast`
> 🔴 **`check:contrast` PASS 는 토큰 조합 검증이지 화면 검증이 아니다.**
> 운영 콘솔은 그 검사의 제외 경로라, 어드민 배지·버튼은 실제 쓰인 조합으로 따로 재야 한다.

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

### 🔴 운영 콘솔은 이 축을 따르지 않는다

`.admin-shell` 이 같은 `--text-*` 토큰을 **다시 정의하고, 그 스코프에 `font-size` 를 직접 건다.**
그래서 고객 "글자 크기" 3단계가 운영 화면에 닿지 않는다.

```
14px  --text-caption   날짜 · 배지 · 표 머리줄
15px  --text-sm        보조 설명 · 라벨
17px  --text-body      본문 · 주요 표 값 · 버튼 라벨   ← .admin-shell 의 font-size
20px  --text-title     섹션 제목
26px  --text-heading   페이지 제목
```

- 🔴 **`font-size` 선언을 지우지 않는다.** 없으면 크기 클래스를 안 붙인 자리가
  `body`(고객값)를 상속해 고객 3단계를 따라간다. 2026-09-17 이전이 그 상태였다
- 🔴 토큰 **이름과 역할**은 고객면과 같다. 값만 다르다 — 새 이름을 만들지 않는다
- 이 크기는 고객면 최소 크기 규칙의 **밖**이다. 위반이 아니다 (정본 §12-2)

## 코딩 원칙

- TypeScript `any` 금지 / 서버 컴포넌트 기본, `'use client'` 최소화
- 이미지는 `next/image` 필수
- 목록·상세 쿼리에 **`UserBlock` 필터를 반드시 적용**한다
  (차단 UI 를 숨기더라도 필터는 넣는다. 저장만 하고 필터가 없으면 미구현보다 나쁘다)
- 활동 숫자(접속자 수 · 실시간 배지 · 총 게시글/회원 수)는 **실제로 커진 뒤에** 넣는다

## 작업 방식

1. **문제 정의 먼저**: 문제 정의 → 원인 분석 → 해결 계획 → 검증 방법
2. **가정 금지**: 함수 동작을 추측하지 말고 Read 로 직접 읽는다
3. **검증 없이 "완료" 금지**: typecheck·build 통과 확인 필수
4. **수동 블로킹 작업 먼저 요청**: DB · Secrets · 외부 콘솔 · `.env.local`
5. **완료 보고**: ① 뭘 했는지 ② 어디에 기록했는지 ③ 앞으로 뭐가 달라지는지
6. **커밋은 파일명 명시.** `git add .` 금지
