# 소란소란 마일스톤 정본 (2026-08-26 재정렬)

> **이 문서의 역할**: 큰 마일스톤 · 목적 · 남은 작업 · 금지선 · 우선순위의 **단일 지도**.
> Micro Seed M1 운영 레일이 완료되어 다음 큰 덩어리로 넘어가기 전에 정렬한다.
>
> 🔴 **운영 문서는 코드를 따라간다.** 값과 상태는 실측으로 확인한 것이지만,
> 판정의 정본은 언제나 코드 · fixture · DB · Sheet 다.
> 이 문서와 실제가 어긋나면 **실측을 믿고 이 문서를 갱신한다.**
>
> 🔴 **자주 만들지 않는다.** 큰 덩어리가 끝난 시점에만 갱신한다.

---

## 0. 문서 지도 — 어느 문서가 무엇의 정본인가

| 문서 | 정본 역할 | 위치 |
|---|---|---|
| `NORTH_STAR.md` | 목적 · 본질 | **unao-main** ⚠️ |
| `m3-new-brand-readiness.md` | 전략 · 판단 기준 | **unao-main** ⚠️ |
| `soransoran-d7-dday-milestone.md` | 실행 작전표 | **unao-main** ⚠️ |
| `MICRO_SEED_LANE_CONSTITUTION.md` | Micro Seed · Voice 정책 헌법 | soransoran |
| `2026-08-26-micro-seed-m1-runbook.md` | 실제 운영 절차 · 장애 대응 | soransoran |
| `2026-08-29-persona-network-strategy.md` | 페르소나 전략 · 공개 정책 | soransoran |
| `2026-08-30-persona-architecture-design.md` | **§9 Persona Matching** · 생성 · 분배 | soransoran |
| **`2026-09-02-original-post-lane-strategy.md`** | **Original Post 레인 파이프라인 · 순서** 🆕 | soransoran |
| **이 문서** | **큰 마일스톤 지도** | soransoran |

> ⚠️ **위 세 문서는 `unao-main` 레포에 있고 이번 정렬에서 수정하지 않았다.**
> 소란소란이 production 운영 단계로 들어온 상태가 아직 반영되지 않았을 수 있다 —
> **참조 문서이며 별도 갱신이 필요하다.** 특히:
>
> - `2026-08-22-soransoran-current-state.md` 는 *"production 배포 완료 상태가 아니다"* ·
>   *"다음 gate는 auth+DB 최소 기능"* · `robots.txt: Disallow: /` 로 남아 있다.
>   **현재와 충돌한다** — 아래 §1 참조. (그 파일은 unao-main 에서 **미추적** 상태다)
> - `m3-new-brand-readiness.md` §0 은 이미 *"보험을 넘어 독립 성장 엔진 검증 단계"* 로 갱신돼 있으나,
>   Micro Seed 운영 검증 완료는 반영 전이다.
> - `soransoran-d7-dday-milestone.md` 의 "크롤러/시트 OFF" 원칙은 **일반 대량 자동화 금지**로 유효하다.
>   Micro Seed 는 그 예외가 아니라 **다른 범주**다 — §5 참조.

---

## 1. 현재 실측 상태 (2026-09-02 갱신)

```
── Micro Seed 레인 (원문 그대로 · 영구 noindex) ──
Micro Seed 발행      5건
Candidate 15 · RawContent 15 · Post 32 (USER 27 · SYSTEM/micro-seed 5)
Sheet                 15건 · HOLD 10 · PUBLISHED 5 · divergence 0

── Original Post 레인 (Derived · index 가능) 🆕 ──
OriginalPostApprovalQueue   7건 · 🟢 전부 APPROVED
  └ createdPostId            0   🔴 발행 경로 없음
  └ decidedBy             founder · 2026-09-02 16:33 KST
Post.personaId 있는 글        0
```

> 🔴 **두 레인은 다른 것이다.** Micro Seed 는 원문 그대로 · noindex,
> Original Post 는 Derived · index 가능 · **페르소나가 작성자**다.
> 정본: [`2026-09-02-original-post-lane-strategy.md`](2026-09-02-original-post-lane-strategy.md)

**2026-08-26 시점 값**(발행 4 · Candidate 4 · RawContent 4)은 위 값으로 대체됐다.

| 축 | 실측 |
|---|---|
| 커뮤니티 노출 | `/community/free` 목록에 4건 전부 · 상세 HTTP 200 |
| 검색 색인 차단 | `<meta name="robots" content="noindex, follow">` |
| sitemap | 11개 URL 중 Micro Seed **0건** |
| JSON-LD | `application/ld+json` **0건** |
| OG image | generic 라우트(`/opengraph-image`) — 글별 생성 없음 |
| 현존 표면 | `/best` 200 · `/search` 404 · `/trending` 404 (아직 없음) |

**운영 레일 검증 완료**: 82cook collect → fetch → import → 승인 → publish → recover.
**PR #64 검증 완료**: 예약 제안 기본 8분 (승인+sync 실측 14초).

> row2 는 사람이 Sheet 17열을 손으로 채웠다.
> **row3~row5 는 사람이 Sheet 에 한 글자도 입력하지 않았다.**

---

## 2. 운영 마일스톤 M1~M10

> 🔴 **2026-08-27 개정.** 초판은 M1~M7 이었다. S-0/L-0 감사에서 우나어에
> **원문 33,031건 · 댓글 원문 154,872개**가 이미 있음을 실측해, Voice Engine 을
> 한 덩어리(구 M4)로 두던 것을 **자산화 → 데이터셋 → 분석기 → LLM** 으로 쪼갰다.
> 근거: [`2026-08-27-voice-engine-legacy-data-strategy.md`](./2026-08-27-voice-engine-legacy-data-strategy.md)

| M | 이름 | 상태 |
|---|---|---|
| **M1** | Micro Seed 운영 레일 | ✅ **완료** (발행 4건 · divergence 0) |
| **M2** | Source Quality Engine (Q-1) | ✅ **1차 완료** (fixture 31건 CI) |
| **M3** | Founder Gate (approve-live) | ✅ **1차 완료** (fixture 14건 CI) |
| **M4** | Voice Engine Contract | 🟡 VE-0 완료 · **legacy 반영 완료** |
| **M5** | **Legacy Data Vault** | 🔜 **다음 핵심** — 우나어 원문 33,031 · 댓글 154,872 자산화 |
| **M6** | Derived Voice Dataset | 원문 · 댓글을 **직접 복제하지 않고** 말투 · 감정 · 반응 신호로 변환 |
| **M7** | Offline Voice Analyzer | **AI vs human 차이** · 자연스러움 · 복제 위험 · **과교정 위험** 분석 |
| **M8** | LLM Voice Engine v0 | 충분한 구조와 샘플 이후 **제한적으로** |
| **M9** | Original Content Lane | Derived 기반 오리지널 콘텐츠 |
| **M10** | Comment / Conversation Engine | **댓글 말투와 반응 구조** 기반 |

> 🔴 **M7 이 M8 앞에 있는 이유**: AI 글과 사람 글의 차이를 **먼저 규칙으로 재 보고**,
> 그 기준이 선 다음에 LLM 을 붙인다. 기준 없이 LLM 을 부르면
> 무엇이 좋아졌는지 판정할 방법이 없다.
> 판정 축: [`2026-08-27-voice-engine-style-strategy.md`](./2026-08-27-voice-engine-style-strategy.md) §3

**구 번호 대응**: 구 M4(Voice Engine v0) → **M4~M8** · 구 M5(Comment) → **M10** ·
구 M6(Multi-source) → M5 에 흡수(우나어가 두 번째 source 다) · 구 M7(Semi-auto) → 유지되나 후순위.

> 🔴 이 번호는 **운영 마일스톤**이다. 헌법 §12 의 마일스톤 번호와 **다르다** — §3 매핑 참조.

---

### (아래는 초판 M1~M7 서술 — 내용은 유효하며 위 표로 재배치했다)

### M1 — Micro Seed Operating Rail ✅ **완료 · 운영 검증됨**

**목적**: 원문 후보를 창업자 승인 아래 커뮤니티에 발행하는 레일을 세운다.

**근거**: 발행 4건 · noindex · sitemap 제외 · recover divergence 0 · 목록 노출 확인.

**산출물**: collector(82cook) · importer · publisher · recover scanner · Sheet 승인 동기화 ·
fixture 5종(read 65 · plan 58 · validate 29 · plan-wiring 17 · collect-check 17) · M1 runbook.

### M2 — Source Quality Engine 🔜 **다음 착수**

**목적**: 좋은 후보를 **빠르게** 고른다. 지금은 사람이 제목만 보고 매번 눈으로 거른다.

**왜 지금인가**: 목록 25건 실측에서 **정치·실명 소재 24%** · 댓글 0건 44%.
후보가 늘수록 선별이 병목이 되고, 잘못 고르면 우리 이름으로 나간다.

**Q-1 이 첫 PR이다** — 그리고 **단순 필터가 아니라 Source Quality Engine v0 의 시작**이다.
품질 신호를 코드로 정의하는 첫 걸음이고, 여기서 정한 축이 M3 자동 큐의 입력이 된다.

| 신호 | 단계 | 방식 |
|---|---|---|
| 댓글 수 | collect | 플래그 |
| 제목 정치·실명 | collect | 🟡 **플래그만** (자동 거부 ✕) |
| 제목 낚시성 | collect | 플래그 |
| `sourceBoardName` 범위 | collect | **거부** |
| 본문 길이 | fetch | 플래그 |
| 링크 비중 | fetch | 플래그 |
| 이미지 흔적 | fetch | **거부** |
| 금칙어 | import | **거부** (현행 `guardMicroSeedCandidate`) |

> 🔴 **정치성 자동 거부는 넣지 않는다.** 경계 사례에서 오탐이 나고,
> **조용히 버려진 글은 아무도 모른다.** 플래그로 보여주고 사람이 고르게 한다.

### M3 — Auto Candidate Queue / Founder Gate 개선

**목적**: 좋은 후보만 Sheet 에 `HOLD` 로 **자동 적재**하고, 창업자는 **최종 승인만** 한다.

**포함**: 품질 통과분 자동 적재 · **승인 전용 명령**(현재 없음 — runbook §5-2 한계) ·
승인 UX(원격 승인 경로) · 큐 상태 가시화.

### M4 — Voice Engine v0

**목적**: 40대 후반~60대 초반 여성의 **실제 원문 데이터**에서 말투 · 리듬 · 생활감 패턴을 추출해
소란소란 톤으로 제목 · 본문 · 댓글 초안을 만든다.

> 🔴 **원문 복제가 아니라 Derived Vault 기반 고유화다.**
>
> **2026-09-02 갱신**: Raw(`MicroSeedRawContent` 15) · Derived(gold 135 · silver 1,065 ·
> story_topic 1,304) · Publishing Input(초안 48건 → `OriginalPostApprovalQueue` 7건)
> 3계층이 **모두 가동한다.** 남은 것은 **작성자를 정하는 Persona Matching** 이다 —
> [Original Post 레인](2026-09-02-original-post-lane-strategy.md) 참조.

### M5 — Comment / Conversation Engine

**목적**: 글 아래 **대화 흐름**과 **재방문 이유**를 만든다.

**포함**: 원문 댓글 일부 + 페르소나 보완 댓글 · 댓글 출처 역추적(§11-2 는 **댓글 단위** 역조회를 요구한다).

> ⚠️ 현재 `MicroSeedRawContent.rawComments` 는 JSONB 다. 댓글 하나만 내릴 수 없으므로
> **별도 테이블 승격이 선행되어야 한다**(헌법 §5-2 주석).

### M6 — Multi-source Expansion

**목적**: 82cook 이후 출처를 넓힌다.

**source stage**: `shadow → publishable → core → production`

> 🔴 **네이버 카페는 82cook 과 같은 구조를 재사용할 수 있으나 별도 트랙이다.**
> 우나어 크롤러는 창업자 **개인 Chrome 프로필의 로그인 쿠키**(`NID_AUT`/`NID_SES`)로
> 회원 전용 글을 읽는다. soransoran 은 그 경로를 들이지 않았다(row2 는 창업자가 본문을 직접 제공).
> **로그인 세션 · 이용약관 · 신뢰 리스크를 먼저 정리해야 한다.**

### M7 — Semi-auto Daily Ops

**목적**: 하루 루프를 반복 가능하게 만든다.

```
후보 수집 → 품질 플래그 → 적재 → 승인 → 발행 → 검증 → 회고
```

> 🔴 **자동화 개방은 §6-9-F 를 따른다.** M1 은 수동 실행이고 cron · workflow 를 붙이지 않았다.
> 여는 순서: `read-only inventory → dry-run → HOLD append → founder PENDING → 1건 publish → limited publish`

---

## 3. 헌법 마일스톤과의 매핑

> 🔴 **번호가 충돌한다.** 헌법 §12 는 Micro Seed 레인 내부 구현 순서이고,
> 위 M1~M7 은 제품 운영 마일스톤이다. **같은 번호가 다른 것을 가리킨다.**
> 헌법을 인용할 때는 반드시 `헌법 M3` 처럼 출처를 붙인다.

| 헌법 §12 | 상태 | 운영 마일스톤 |
|---|---|---|
| Pre-M0 Safety Contract | ✅ 완료 | M1 에 흡수 |
| M0 Schema & Gate Foundation | ✅ 완료 (3축 · CI guard) | M1 |
| M1 Google Sheet Founder Gate | ✅ 완료 (8상태 · ID 양방향 · cap) | M1 |
| M2 Micro Seed MVP | ✅ **완료** (§12-0 실측) | M1 |
| M3 Comment Activation Engine | ⬜ 미착수 | **M5** |
| M4 Persona OS | 🟡 **설계 완료 · 구현 미착수** (pool · identity · gate · 대기열 있음 / **Matching 미착수**) | **M4~M5** |
| M5 Voice Vault | 🟢 가동 (gold 135 · silver 1,065 · story 1,304) | **M4** |
| M6 Voice Engine LLM | 🟢 **부분 가동** — 초안 48건 생성 · Originality Gate | **M4** |
| M7 Scale / Cost / QA | ⬜ 미착수 | **M7** |

> 🔴 **설계 완료와 구현 완료를 같은 칸에 적지 않는다.** 설계가 끝난 것을 구현됐다고 읽으면
> 다음 사람이 없는 코드를 부른다. 항목별 대조표는
> [Original Post 레인 §8](2026-09-02-original-post-lane-strategy.md) 에 있다.

**헌법에 없고 운영에만 있는 것** 추가: **Original Post 레인** — 헌법 §10-5 가 경계만 정하고
파이프라인은 정하지 않았다. 정본은 [`2026-09-02-original-post-lane-strategy.md`](2026-09-02-original-post-lane-strategy.md).

**헌법에 없고 운영에만 있는 것**: M2 Source Quality Engine · M3 Auto Candidate Queue · M6 Multi-source.
운영에서 필요가 드러난 것들이며, 정책이 필요해지면 그때 헌법에 절을 신설한다.

---

## 4. 우선순위

> 🔴 **2026-08-27 개정.** 1·2 는 완료됐다.

| 순위 | 작업 | 상태 | 근거 |
|---|---|---|---|
| ~~1~~ | Q-1 품질 플래그 (M2) | ✅ 완료 | PR #72 · #75 |
| ~~2~~ | 승인 전용 명령 (M3) | ✅ 완료 | PR #78 |
| ~~3~~ | 우나어 심층 데이터 감사 · Voice 자산 schema (M5) | ✅ 완료 | voice_gold 135 · silver 1,065 · story_topic 1,304 |
| ~~4~~ | Original Post 생성 · Gate · 대기열 · 결정 | ✅ 완료 | PR #291 · #295 · #300 · #303 · #305 |
| **1** | 🔴 **Persona Matching 설계** | 🔜 | ⑥ 없이 ⑦ 로 가면 정체성이 무너진다. **되돌릴 수 없다** |
| **2** | **Persona Publish** (PR-OP-D) | 대기 | 1 이 끝난 뒤. 🔴 지금 직행 금지 |
| 3 | Persona 댓글 (반응 지도) | 대기 | 글만 있으면 게시판이지 커뮤니티가 아니다 |
| — | Voice egress 재발 방지 | ⏸️ | **별도 운영 이슈.** Voice/M3 **재개 전** 처리 · 위 1~2 보다 앞서지 않는다 |
| — | 좋아요 · 베스트 자동화 | 🔴 **금지** | 정책 미확정. 공개 조작으로 읽힌다 |

> 🔴 **지금 PR-OP-D 로 직행하지 않는다.**
> 발행 코드를 먼저 짜면 작성자를 정해야 하고, 그때 손에 잡히는 답은 **운영 전용 계정**이다.
> 한 번 그렇게 발행하면 그 계정이 사실상 표준이 되고, **페르소나 발행이라는 최종안이 밀린다.**
> 상세: [Original Post 레인 §9](2026-09-02-original-post-lane-strategy.md)

---

## 5. 금지선 (현재 유효)

| 금지 | 근거 |
|---|---|
| cron · workflow 자동화 | 헌법 §6-9-F — M1 은 수동 실행 |
| 대량 자동 크롤링 · 시트 대량 발행 | D-day 작전표 원칙 (유효) |
| 네이버 개인 로그인 쿠키 사용 | 개인 자격증명 · 이용약관 |
| 이미지 포함 원문 재발행 | 롤백 사고 이력 |
| `PUBLISHED` 를 다른 상태로 되돌리기 | 헌법 R9 · §6-4 (비가역) |
| 3축 플래그를 Sheet · 후보 필드로 노출 | 헌법 §6-7-B — 사람 손 하나로 무너진다 |
| 정치성 **자동 거부** | 오탐이 조용히 좋은 글을 버린다 (§2 M2) |
| 🔴 **정체성 매칭 없이 오리지널 글 발행** | 억지 배정은 페르소나의 **모든 과거 글**을 거짓으로 만든다 |
| 🔴 **페르소나 좋아요 · 베스트 유도** | 정책 미확정. 댓글은 대화지만 인기 지표는 **공개 조작**으로 읽힌다 |

> 🔴 **"크롤러/시트 OFF" 와 Micro Seed 는 다른 범주다.**
> 그 원칙은 **대량 자동 수집·발행**을 막는다.
> Micro Seed 는 `noindex` · internal · 창업자 승인 · cap(burst 1 / soft 3 / hard 10) 아래
> **사람이 한 건씩 여는 제한 seed 레일**이다. 예외가 아니라 성질이 다르다.

---

## 6. 남은 한계 (2026-09-02 갱신)

- ~~품질 플래그 없음~~ → ✅ 완료 (M2)
- ~~승인 전용 명령 없음~~ → ✅ 완료 (M3)
- ~~Voice Engine 미착수~~ → 🟢 **부분 가동** — 초안 생성 · Originality Gate · 대기열 · 결정
- 🔴 **Persona Matching 미착수** → **최우선.** 이것 없이는 오리지널 글의 작성자를 정할 수 없다
- 🔴 **Original Post 발행 경로 없음** — `APPROVED` 7건이 대기 중 (`createdPostId` 전부 null)
- 🟡 **좋아요 · 베스트 정책 없음** — 구현 금지 상태
- Comment Engine 미착수 (`rawComments` 테이블 승격 선행) → **M5**
- 네이버 카페 세션 · 정책 판단 필요 → **M6**
- 크롤 자동화 없음 (**의도된 상태** — 지금은 소재 테스트용 수동 절차) → **M7**
- Voice egress 재발 방지 미착수 → **별도 운영 이슈.** Voice/M3 재개 전 처리
- `2026-08-22-current-state.md` 등 unao-main 문서 3종 갱신 필요 → §0
