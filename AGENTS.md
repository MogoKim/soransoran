# 소란소란 — 에이전트 지침

> 이 저장소는 **소란소란(soransoran.com)** 전용이다.
> 우나어(age-doesnt-matter) 저장소의 지침을 그대로 적용하지 않는다.

## 0. 역할

- **창업자**: 방향 결정 · 외부 콘솔 작업 · merge 및 배포 승인
- **Codex**: 운영 마스터 — 목적·PASS 기준 정의 · 검증
- **Claude**: 실행 — read-only 진단 → 승인 → 구현 → PR

read-only 진단 → 승인 → 구현 순서를 지킨다.
**merge 와 production 배포는 창업자 승인 전 금지한다.**

## 1. 서비스 정의

```
브랜드    소란소란
도메인    soransoran.com
대상      40대 중반~60대 중반 여성 (핵심 50대)
시작점    갱년기
본질      커뮤니티. 병원 정보 사이트가 아니다
```

## 2. 절대 원칙

### 실제 유저 참여는 열고, 봇이 활발한 척하는 것은 막는다

```
✅ 켠다   실제 회원 글쓰기 · 댓글
🔴 끈다   봇 커뮤니티 글·댓글 자동화 · 봇 대댓글 · 봇 연결촉진

정상 상태  봇 글·댓글 0건
관찰 대상  실제 회원 글·댓글 0건 — 참여 미발생. 봇으로 채우지 않는다
```

### 우나어와의 분리

```
🔴 분리한다   repo · DB · 계정 · 도메인 · 인프라 · 콘텐츠
              로고 · OG · favicon · manifest · public asset
              verification · AdSense · Kakao 앱 · localStorage 키

✅ 참고한다   Next.js/Prisma/Auth/UI 패턴 · 디자인 시스템 뼈대
              메인 브랜드 컬러 #FF6F61 (임시 채택 · 교체 가능 구조)
```

⚠️ **"컬러를 재사용한다"와 "자산을 재사용한다"는 다르다.**

## 3. 금지 사항

```
🚫 우나어 repo fork / branch 에서 소란소란 구현
🚫 우나어 public asset · manifest · OG · favicon 복사
🚫 우나어 .env 값 · token · DATABASE_URL · Kakao callback 사용
🚫 우나어 naver-site-verification · GSC · AdSense 값 복사
🚫 우나어 sitemap / robots / canonical 그대로 복사
🚫 우나어 agents / workflows / migrations / seed 복사
🚫 우나어 콘텐츠 복붙
🚫 #FF6F61 을 globals.css 밖에 리터럴로 작성
🚫 "시니어 · 어르신 · 노인 · 실버" 표현 (주석 포함)
🚫 prisma migrate / db push / db seed
🚫 git add . (항상 파일명 명시)
🚫 준비되지 않은 상태의 production 배포
```

## 4. 색인 정책

```
preview 기간    SORAN_ALLOW_INDEXING 미설정 = 전체 disallow
production      go 판정 후에만 true 로 해제
검색엔진 등록    D+1 에 한다. 배포 당일에 하지 않는다
```

미완성 사이트를 검색엔진이 먼저 보면 초기 신뢰가 깎인다.

## 5. 검증

```bash
npm run typecheck
npm run lint
npm run build
npm run check:tokens
```

배포 전 추가: 모바일 767px · 터치 타겟 52px · 글자 크기 3단계 · 실기기 로그인/글쓰기

## 6. 상세 규칙

색상 · 로고 · 글자 크기 · IA · 금지 시각 요소는 [`CLAUDE.md`](./CLAUDE.md) 를 따른다.
