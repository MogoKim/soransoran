# 소란소란 — 에이전트 공통 지침 (얇은 라우터)

> 이 저장소는 **소란소란(soransoran.com)** 전용이다. 우나어(age-doesnt-matter) 저장소의 지침을 그대로 적용하지 않는다.
> 이 파일은 정본으로 안내만 한다. 정책 · 목표 수치 · 현재 상태를 여기 복제하지 않는다 — 복제하면 한쪽이 낡고,
> 낡은 쪽이 먼저 읽힌다.

## 🔴 0순위 — 저장소 정체성을 먼저 확인한다

계획·진단·수정 전에 `git rev-parse --show-toplevel`, `git remote get-url origin`,
`node -p "require('./package.json').name"`을 확인한다. 의도한 `soransoran*` worktree가 아니거나 package name이
`soransoran`이 아니면 중단한다. `unao-main`·`age-doesnt-matter`에서 소란소란 명령·DB/env 접근·문서 수정을 하지 않는다.
문서별 권한과 역사 분류는 [`docs/operations/D100-DOCUMENT-INVENTORY.md`](docs/operations/D100-DOCUMENT-INVENTORY.md)를 따른다.

## 🔴 권위 문서 — 작업 시작 전에 읽는다

[`docs/operations/README.md`](docs/operations/README.md) 가 **권위 인덱스 하나**다. 정책이 충돌하면 앞 문서가 이긴다.

1. [`docs/operations/NORTH-STAR.md`](docs/operations/NORTH-STAR.md) — 고객 · 본질 · 장기 North Star · 영구 안전장치
2. [`docs/operations/2026-09-21-d100-goal-canon.md`](docs/operations/2026-09-21-d100-goal-canon.md) — D100 정책. 목표 수치의 정본은 [`2026-09-21-d100-goal-canon.md`](docs/operations/2026-09-21-d100-goal-canon.md) 하나다
3. [`docs/operations/CURRENT-MILESTONE.md`](docs/operations/CURRENT-MILESTONE.md) — as-of 가 붙은 현재 main/runtime/stage/blocker와 다음 critical path

- [`docs/operations/MASTER-OPERATING-SYSTEM.md`](docs/operations/MASTER-OPERATING-SYSTEM.md)는 필요할 때만 여는 기술 지도와 역사다. 기본 필독이 아니고 정책·현재 상태 권위가 아니다.
- 영역 작업은 README 「영역 프로젝트 정본」의 문서를 함께 읽는다. 매거진의 검색 키워드·주제·시리즈·관련 글·SEO 성장
  작업은 [`docs/operations/M-GRAPH-PROJECT-CHARTER.md`](docs/operations/M-GRAPH-PROJECT-CHARTER.md)를 먼저 읽는다.
- 저장소 밖 handoff · 감사 보고서 · 외부 agent memory 는 정본이 아니다.
- 오늘의 단계 · runtime SHA · job 상태는 문서 기억이 아니라 `StageDecision` 행 하나, `launchctl`, runtime pin 으로
  확인한다. D100 자동 일정 owner 는 상시 호스트의 launchd 하나다.

## 0. 역할과 소유권

- **창업자**: 목적 · 브랜드 · 예산 · credential · 법률 · 하드웨어 · 비가역 정책 결정
- **Codex**: 운영 마스터 — 목적 · 우선순위 · 병렬 분해 · PASS 기준 · 비용/위험 경계 · 완료 판정
- **Claude Code**: 실행 — 진단 · 구현 · 검사 · PR · 허용된 merge/배포 · 운영 관측 · rollback 준비를 끝까지 수행

- 같은 파일은 한 agent만 쓴다. 다른 agent 의 worktree · 미커밋 변경을 덮어쓰거나 정리하지 않는다.
- 창업자에게 PR마다 merge·배포 승인을 요청하지 않는다. 최신 정본 안의 가역 변경이고 exact head · 필수 CI ·
  배포 전 점검 · rollback 이 green 이면 Codex 가 순서를 정하고 Claude Code 가 실행한다. 새 비용 상한 · credential ·
  DB migration · 법률·브랜드 정책 · host 최종 cutover 는 창업자 결정을 받는다.

## 1. 위험 경계

```
✅ 켠다   실제 회원 글쓰기 · 댓글 · 관리형 공개 글 · Persona 댓글(승인된 목표 — D100 canon)
🔴 끈다   가짜 접속자 수 · 가짜 실시간 지표 · 붉은 알림 도트 남발
🔴 끈다   실제 회원 원문을 건드리는 모든 자동화
```

```
🚫 우나어 repo fork / branch 에서 소란소란 구현
🚫 우나어 public asset · manifest · OG · favicon · .env 값 · token · DATABASE_URL · Kakao callback ·
   naver-site-verification · GSC · AdSense · sitemap/robots/canonical · agents · workflows · migrations · seed · 콘텐츠 복사
🚫 "시니어 · 어르신 · 노인 · 실버" 표현 (주석 포함)
🚫 hex 색상 리터럴을 src/app/globals.css 밖에 작성 — 색·글자 정본은 docs/operations/soransoran-brand-design-spec.md
🚫 prisma migrate / db push / db seed · Raw SQL
🚫 git add . (항상 파일명 명시) · amend · force push · bare git stash
🚫 수동 stage·env·장부 조작으로 단계 증거 만들기 · 준비되지 않은 production 배포
```

색인: preview 기간 `SORAN_ALLOW_INDEXING` 미설정 = 전체 disallow. production 은 go 판정 뒤에만 해제한다.

## 2. 기본 검증

```bash
npm run typecheck
npm run lint
npm run build
npm run check:tokens
```

문서를 고쳤으면 `npm run master:doc-check` 를 함께 돌린다. 배포 전: 모바일 767px · 터치 타겟 52px · 글자 크기 3단계 ·
실기기 로그인/글쓰기.

Claude Code 전용 실행 규칙은 [`CLAUDE.md`](./CLAUDE.md) 에 있다.
