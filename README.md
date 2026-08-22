# 소란소란

> 40대 50대 여성이 이야기하는 곳

갱년기를 시작점으로 하는 여성 커뮤니티입니다.
병원 정보 사이트가 아니라 **커뮤니티**입니다.

- 도메인: soransoran.com
- SEO title: `소란소란 - 40대 50대 여성을 위한 커뮤니티`
- 대상: 40대 중반~60대 중반 여성 (핵심 50대)

## 기술 스택

| 영역 | 선택 |
|---|---|
| 프레임워크 | Next.js 14 App Router · TypeScript strict |
| 스타일 | Tailwind CSS + CSS Variables semantic token |
| 폰트 | Pretendard Variable |
| DB | Supabase + Prisma (Raw SQL 금지) |
| 인증 | NextAuth v5 · 카카오 전용 |

## 시작하기

```bash
npm install
cp .env.example .env.local   # 값을 채운다 (커밋 금지)
npm run dev
```

## 검증 명령

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # next lint
npm run build        # prisma generate && next build
npm run check:tokens # 색상 리터럴 가드
```

## 색상 규칙 (중요)

색은 **semantic token 으로만** 사용합니다. hex 를 컴포넌트에 직접 쓰지 않습니다.

| 토큰 | 값 | 역할 |
|---|---|---|
| `--brand` | `#FF6F61` | 브랜드 시그니처 — **비텍스트 전용** |
| `--brand-ink` | `#9A3A31` | 읽는 브랜드색 (링크·워드마크·배지 텍스트) |
| `--cta` | `#B64235` | 누르는 것 (FAB · 버튼) — 흰 글씨 5.50:1 |

🔴 `#FF6F61` 은 배경 위 대비가 2.60:1 입니다.
**일반 텍스트 · 흰 글씨 CTA · 정보 전달 그래픽에 쓰지 않습니다.**

전체 토큰과 근거는 `src/app/globals.css` 와 브랜드 정본 문서를 참조하세요.

## 우나어와의 관계

소란소란은 우나어(age-doesnt-matter)의 fork 가 아닙니다.
검증된 구조와 패턴만 선별 참고했고, 자산·인프라·도메인은 완전히 분리했습니다.

가져오지 않은 것: 로고 · OG · favicon · manifest · public asset · env · DB ·
Kakao 앱 · 검색엔진 verification · 봇/워크플로우 · 콘텐츠.
