# 소란소란 — 에이전트 지침

> 이 저장소는 **소란소란(soransoran.com)** 전용이다.
> 우나어(age-doesnt-matter) 저장소의 지침을 그대로 적용하지 않는다.

## 🔴 작업 시작 전 반드시 읽는다 — 운영 정본

| 문서 | 무엇 |
|---|---|
| [`docs/operations/NORTH-STAR.md`](docs/operations/NORTH-STAR.md) | 고객 · 본질 · 장기 North Star · 판단 우선순위 · 영구 안전장치 · 임시 제한 |
| [`docs/operations/2026-09-21-d100-goal-canon.md`](docs/operations/2026-09-21-d100-goal-canon.md) | D3→D100 자동 운영 목표 · 생동감 · Persona 용량 · 단계 PASS 계약 |
| [`docs/operations/CURRENT-MILESTONE.md`](docs/operations/CURRENT-MILESTONE.md) | 지금 분기 목표 · 지금 병목 · 임시 제한의 종료 조건 · 완료 지표 |

🔴 **이 세 문서의 내용을 여기 복제하지 않는다.** 복제하면 반드시 한쪽이 낡고,
낡은 쪽이 먼저 읽힌다. 값이 필요하면 그 문서를 연다.

🔴 **매거진의 검색 키워드·주제 선정·시리즈·관련 글·SEO 성장 작업은 반드시**
[`docs/operations/M-GRAPH-PROJECT-CHARTER.md`](docs/operations/M-GRAPH-PROJECT-CHARTER.md)를 먼저 읽는다.
이 문서가 M-GRAPH 전략 정본이며, M-AUTO의 실행·안전 정본을 대체하지 않는다.

## 0. 역할

- **창업자**: 목적·브랜드·예산·credential·법률·하드웨어·비가역 정책 결정
- **Codex**: 운영 마스터 — 목적·우선순위·병렬 분해·PASS 기준·비용/위험 경계·완료 판정
- **Claude Code**: 실행 — 진단·구현·검사·PR·허용된 merge/배포·운영 관측·rollback 준비

진단 → 문제 계약 확정 → 구현 → 검증 → 운영 증명 순서를 지킨다. 다만 예약 관측 때문에
겹치지 않는 구현을 멈추지 않는다. 같은 파일은 한 agent만 쓰고, 다른 파일 집합은 병렬화한다.

창업자에게 PR마다 merge·배포 승인을 요청하지 않는다. 최신 정본 안의 가역 변경이고 exact head,
필수 CI, 통합 트리, 배포 전 점검과 rollback이 모두 green이면 Codex가 순서를 정하고 Claude Code가
끝까지 실행할 수 있다. 새 비용 상한, credential, DB migration, 법률·브랜드 정책, host 최종
cutover처럼 외부 권한이나 비가역성이 있는 변경은 창업자 결정을 받는다.

## 1. 서비스 정의

```
브랜드    소란소란
도메인    soransoran.com
대상      40대 중반~60대 중반 여성 (핵심 50대)
시작점    갱년기
본질      커뮤니티. 병원 정보 사이트가 아니다
```

## 2. 절대 원칙

### 실제 유저 참여는 열고, 활발한 척하는 지표는 막는다

```
✅ 켠다   실제 회원 글쓰기 · 댓글
✅ 켠다   관리형 공개 글 · Persona 댓글 — 🔴 승인된 단기 목표다 (CURRENT-MILESTONE)
🔴 끈다   가짜 접속자 수 · 가짜 실시간 지표 · 붉은 알림 도트 남발
🔴 끈다   실제 회원 원문을 건드리는 모든 자동화
```

🔴 **"빈 커뮤니티를 채우는 것"과 "붐비는 척하는 것"은 다르다.**
처음 온 사람이 읽을 글과 사람 같은 반응은 **있어야 한다** — 그것이 본질이다.
없는 접속자 수를 띄우는 것은 다른 일이고, 그것만 금지다.

목표 수치와 단계(`shadow` → `bootstrap-review` → `bootstrap-auto`)는
[`CURRENT-MILESTONE.md`](docs/operations/CURRENT-MILESTONE.md) 하나에만 적는다.

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
