# Original Post 레인 정본 (2026-09-02)

> **전체 현재 상태**: [Master Operating System](./MASTER-OPERATING-SYSTEM.md)
> 이 문서는 Original Post Lane의 상세 계약 정본이다. 날짜가 붙은 DB 수치와 구현 상태표는
> 역사 스냅샷이며, 현재 상태는 Master와 main/DB 실측을 따른다.
>
> **이 문서의 역할**: Original Post 레인의 **파이프라인 · 현재 위치 · 다음 순서**의 단일 지도.
> 상위: [Micro Seed Lane 헌법](../constitution/MICRO_SEED_LANE_CONSTITUTION.md) **§10-5 레인 분기** ·
> [Persona Network 전략](2026-08-29-persona-network-strategy.md) **§4 ④ 가장 적합한 페르소나가 게시글 발행** ·
> [Persona 아키텍처](2026-08-30-persona-architecture-design.md) **§9 Persona Matching**
>
> 🔴 **왜 새 문서인가**
> PR #291 · #295 · #300 · #303 · #305 가 main 에 들어갔고 전용 테이블 · 전용 gate · 전용 스크립트가 생겼는데
> **이 레인을 이름으로 부르는 문서가 없었다.** 헌법(1,933줄)이나 아키텍처(846줄) 안에 넣으면 묻힌다.
>
> 🔴 **운영 문서는 코드를 따라간다.** 이 문서와 실제가 어긋나면 **실측을 믿고 이 문서를 갱신한다.**

---

## §0 🔴 한 문장

**Original Post 는 "운영 계정이 AI 글을 올리는 레인" 이 아니다.
가장 잘 맞는 페르소나가 자기 경험처럼 가져가서 쓰는 글이고,
2026-09-03 현재 그 경로가 끝까지 연결돼 실제로 2건이 나갔다.**

> 🔴 **갱신 이력 (2026-09-03)**: 초판은 *"지금은 그 앞 절반만 만들어져 있다"* 였다.
> 그 뒤 PR #309 · #313 · #317 · #318 · #321 · #323 · #325 · #326 이 main 에 들어가
> **⑥ Persona Matching 과 ⑦ Persona Publish 가 완성됐고 공개 발행 2건이 검증됐다.**
> 남은 것은 ⑧(댓글 · 반응)과 **속도**다 — 속도 전략 · cap ladder · PR 마일스톤은
> [자동화 전환 정본](2026-09-03-controlled-activity-automation-strategy.md)이 정한다.

---

## §1 Micro Seed 와 무엇이 다른가

두 레인을 한 게이트로 운영하면 *"이 글은 원문인가 오리지널인가"* 를 사후에 아무도 답할 수 없다
(헌법 §10-5 "무너지는 지점").

| | **Micro Seed** | **Original Post** |
|---|---|---|
| 본문 | **원문 그대로** (정책 7) | **Derived** — 원문은 재료일 뿐 |
| 검색 | 🔴 **영구 noindex** (정책 8·10) | 🟢 **index 가능** |
| `isMicroSeed` | `true` | `false` |
| `permanentNoindex` | `true` | **`false`** |
| 작성자 | 시스템 User 1개 | 🔴 **페르소나** (§4) |
| 원장 | `MicroSeedCandidate` | `OriginalPostApprovalQueue` |
| 승인 | Google Sheet | 어드민 화면 + 결정 스크립트 |
| 상태 | ✅ 운영 중 (5건 발행) | ✅ **운영 중 (2건 발행)** — 댓글 · 반응은 미착수 |

### 🟡 세 번째 레인 후보 — Growth Issue (**미구현 · 전략만**)

| | **Micro Seed** | **Original Post** | 🟡 **Growth Issue** |
|---|---|---|---|
| 상태 | ✅ 운영 중 | ✅ 운영 중 | 🔴 **미구현 — 코드 없음** |
| 소재 | 생활 원문 | 생활 원문(재료) | 🔵 연예 · 방송 · 셀럽 **한정** |
| 목적 | 초기 밀도 | 커뮤니티 대화 | 검색 **유입** |
| 개방 | — | — | 🔔 **별도 cap · 별도 승인 · 별도 감사** |

생활 Original 레인에서 자동 제외되는 **연예 · 방송 · 셀럽** 원문이 유입 자산일 수 있다는 것이
이 레인의 근거다. 다만 **두 레인을 섞으면 정체성이 무너진다** — 레인을 나누는 이유가 그것이다.

```
🚫 정치 · 진영 · 이념 · 정치인 · 공직자는 이 레인에도 들어오지 않는다.
   Growth 도 shadow 도 아니다 — 소란소란은 가져가지 않는다.
   유입이 좋아도 커뮤니티가 진영 싸움으로 변질되기 때문이다.
```

🔴 연예 · 방송 · 셀럽도 **비난 · 단정 · 루머 · 사생활 추측 · 외모 비하 · 가족 공격은 금지**이고,
형식은 "논란 정리" 가 아니라 **"우리 또래는 어떻게 보나"** 대화형이다.
원문 이미지 활용은 **향후 설계 항목**이며 지금 구현하지 않는다.

🔴 **지금은 아무것도 만들지 않았다.** 분류기 · cap · 감사 경로가 전부 없고,
착수하려면 별도 PR 과 창업자 승인이 필요하다.
원칙 전문: [Raw 공급망 설계 §4-C](2026-09-03-raw-supply-chain-design.md).

### 🔴 왜 이 레인만 index 가 되는가

헌법 §10-5:

> **"원문 그대로" 와 "검색 노출" 은 함께 갈 수 없다.** 둘 중 하나를 고르는 것이 레인 분리다.
> ❌ Derived 를 거치지 않고 원문을 다듬어 index 레인에 올린다 → §10-5 위반. **index 레인은 Derived 만 쓴다.**

Original Post 는 정확히 그 Derived 레인이라서 `permanentNoindex = false` 가 **맞다.**
바꿔 말하면 **Derived 가 아니게 되는 순간 index 자격도 사라진다.** 이것이 Originality Gate 가 존재하는 이유다.

---

## §2 파이프라인 전체

```
①  크롤 / 수집          82cook · 네이버 카페 → MicroSeedRawContent
                        🟡 지금은 수동. 수집 자동화는 열기로 개정됐다 (§7)
        ↓
②  Voice Engine         말투 · 사건 구조 · 반응 지도
    + Originality        원문에서 얼마나 멀어졌나
        ↓
③  Gate                 BLOCK 7 / HOLD 11 / PASS
        ↓
④  Approval Queue       OriginalPostApprovalQueue
                        🔴 BLOCK 은 적재하지 않는다 — 원문 조각이 든 레코드다
        ↓
⑤  Founder Decision     APPROVED · DECLINED · EDITED
        ↓
⑥  Persona Matching     하드필터 9축 + 점수 5축 · planBatch 순차 배정
                        🔴 실패하면 발행하지 않는다 (§5)
        ↓
⑦  Persona Publish      Post.authorId = 그 페르소나의 User · Post.personaId 기록
        ↓  ◀━━━━━━━━━━━━━ 🟢 여기까지 구현 · 검증 완료 (2026-09-03 · 발행 2건)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        ↓
⑧  Persona Comments     🔜 **다음 작업.** 생성기만 있고 분산기가 없다
    / Reactions         🟡 좋아요 · 베스트는 controlled scaffold 로 재분류 (§6)
```

🔴 **⑥ 을 건너뛰고 ⑦ 로 갈 수 없다.** 근거는 §4 · §5.
이 원칙은 지금도 코드로 강제된다 — `judgePublish` 가 `NO_MATCH` 를 막는다.

---

## §3 현재 상태 (2026-09-03 실측)

### main 반영

| PR | 무엇을 |
|---|---|
| **#291** | `closingIntent` — 원문이 어떻게 닫히는가. 억지 CTA 제거 |
| **#295** | `titleShape` (사건형 · 주접형 · 담백형) + **URL 2분** (출처 금지 / 소재 링크 조건부 허용) |
| **#300** | **Originality Gate** — BLOCK 7종 / HOLD 11종 / PASS |
| **#303** | **`OriginalPostApprovalQueue`** (migration 0022) + 읽기 전용 어드민 |
| **#305** | **결정 스크립트** — APPROVED / DECLINED / EDITED |
| **#309 · #313** | **Persona Matching** — 하드필터 · 점수 · `planBatch` 순차 배정 |
| **#311 · #315 · #317 · #318** | `childrenAgeBands` · 말투/리듬 DB 이관 · 길이 밴드 한국어 정규화 · `noGoTopics` 보류 |
| **#321** | **P07 · P10 · P15 · P17 활성화** |
| **#323 · #325** | **매칭 결과 저장** (migration 0023 · `matchedPersonaId` · `matchedAt` · `matchMeta`) |
| **#326** | 🟢 **Persona Publish** — 3축 전부 false · 트랜잭션 3 write · cap |

### DB

```
MicroSeedRawContent            15   (82cook 14 · navercafe:remonterrace 1)
MicroSeedCandidate             15   (Micro Seed 레인 · PUBLISHED 5 · HOLD 10)
Post                           35   (PUBLISHED 25)
OriginalPostApprovalQueue       7
  └ PUBLISHED                   2   🟢 발행 완료
  └ APPROVED                    5   (PASS 2 · HOLD 3)
  └ matchedPersonaId            5
  └ createdPostId               2
Post.personaId 있는 글          2   P05(447자) · P10(293자) · 둘 다 FREE
Persona active                  5   P05 · P07 · P10 · P15 · P17
PersonaActivityLog              post 2 · comment 1
Memory 4종                      🔴 전부 0행 (Self · Community · Negative 1 · UserRelationship · Mood)
```

### 🟢 발행 2건 검증 결과

```
isMicroSeed false · permanentNoindex false · indexPromotionBlocked false
sourceUrl NULL · sourceArticleId NULL · sheetCandidateId NULL
authorId = 페르소나 User · personaId 기록됨
sitemap 포함 · meta robots index, follow
```

**index 레인의 첫 자동 생성 글 2건이 사고 없이 나갔다.**

> 우나어 색인이 4,600 → 0 이 된 것은 품질 문제가 아니라
> **원문을 SEO 노출 방식으로 다룬 구조**의 문제였다 (헌법 §10-2).
> 이 레인은 Derived 이고 출처 필드를 채우지 않기 때문에 그 구조를 반복하지 않는다.

### 🔴 그러나 지금 상태는 "됐다" 가 아니라 "너무 느리다"

```
공개 발행       1/day        (오늘 소진)
주간 여력       주 5건        active 5명 × POST_CAP_PER_WEEK 1
원문 재고       15건          shadow 100/day 에 턱없이 부족
댓글 0개 글     20 / 25 = 80%
```

속도 전략 · cap ladder · 병목 14개 · PR-S1~S8 은
[자동화 전환 정본](2026-09-03-controlled-activity-automation-strategy.md)이 정한다.

---

## §4 🔴 작성자는 페르소나다

### 이것은 새 결정이 아니다

| 근거 | 내용 |
|---|---|
| [전략 §4](2026-08-29-persona-network-strategy.md) | **"④ 가장 적합한 페르소나가 게시글 발행"** |
| [아키텍처 §11](2026-08-30-persona-architecture-design.md) | `Post.personaId` 🆕 *"헌법에 없음 — **글도 만들기 때문**"* |
| 〃 §5 | `Persona.userId @unique → User` — *"`Post.authorId` NOT NULL 제약 때문에 **페르소나마다 User 레코드 필수**"* |
| 헌법 §12 M4 | *"**시스템 User 1개를 쓰면 같은 작성자의 글이 반복 노출된다** … 다건 발행을 열기 전에 M4 Persona OS 가 필요하다"* |

**Persona Bot 은 댓글봇이 아니다.** 글 배포 · 댓글 · 반응 · 관계/기억을 포함한 커뮤니티 네트워크이며
([전략 §5](2026-08-29-persona-network-strategy.md): *"글만 있고 반응이 없으면 커뮤니티가 아니라 게시판이다"*),
Original Post 는 그 네트워크가 **배포하는 콘텐츠**다.

### 🟡 운영 전용 계정은 최종안이 아니다 — fallback 으로만

> 🔴 **"오리지널 글 전용 시스템 계정" 을 최종안처럼 쓰지 않는다.**
> 헌법 §12 M4 가 *"시스템 User 1개를 쓰면 같은 작성자의 글이 반복 노출된다"* 라고
> **이미 그 방식을 반대 근거로 들고 있다.**

| 안 | 지위 |
|---|---|
| **페르소나 발행** | 🟢 **최종안** |
| 운영 전용 계정 발행 | 🟡 **fallback / 초기 임시안** — Persona OS 착수가 늦어지고 색인 검증이 급할 때 **1~2건 한정**. 다건 발행에는 쓰지 않는다 |

fallback 을 쓰기로 한다면 그것은 **별도 창업자 결정**이며, 이 문서에 채택 사실과 건수 상한을 적는다.

---

## §5 🔴 Persona Matching — 정체성 충돌 방지

### 핵심은 점수가 아니라 모순이다

[아키텍처 §9](2026-08-30-persona-architecture-design.md) 가 매칭 점수(0~100)를 이미 정의했다.
그 표에서 **"생활사 정합성 25 · 🔴 모순이면 0점 · 즉시 탈락"** 이 이 레인에서는 가장 중요한 축이다.

> **과거에 30살 딸이 있다고 한 페르소나가 고3 딸 이야기를 쓰면 안 된다.**

이건 감점 사유가 아니라 **탈락 사유**다. 한 번 어긋나면 그 페르소나의 모든 과거 글이 함께 거짓이 된다.

### 대조해야 하는 축

글이 요구하는 조건 ↔ 페르소나의 Identity + SelfMemory 를 **전부** 본다.

```
□ 가족 구성        배우자 · 자녀 유무 · 동거 여부 · 부모 돌봄
□ 자녀 나이대      🔴 과거 발언과 산술적으로 맞는가 (30살 딸 → 고3 딸 불가)
□ 결혼 상태        비혼 · 기혼 · 사별 · 이혼
□ 지역             글이 지역을 특정하는가
□ 직업 / 일        재직 · 자영 · 전업 · 은퇴
□ 건강             갱년기 단계 · 지병 · 수술 이력
□ 경제 상황        글이 소비 수준을 드러내는가
□ 과거 발언        🔴 SelfMemory — 이 페르소나가 전에 무엇을 사실로 말했나
□ noGo             이 페르소나가 다루지 않기로 한 소재
```

🔴 **`noGo` 와 `자녀 나이대` 와 `과거 발언` 셋은 점수가 아니라 하드 필터다.**

### 🔴 매칭 실패 시 발행하지 않는다

```
조건을 만족하는 페르소나가 없다
        ↓
🔴 억지로 배정하지 않는다.  글을 고쳐서 맞추지도 않는다.
        ↓
대기열에 APPROVED 로 남겨 둔다 — 페르소나가 늘면 다시 본다
```

**억지 배정은 글 한 건을 살리고 페르소나 하나를 영구히 망가뜨리는 거래다.**
`APPROVED` 는 "발행해도 된다" 는 뜻이지 "반드시 발행한다" 는 뜻이 아니다.

### 🟡 아직 정하지 않은 것

- 매칭 결과를 어디에 남기나 (`OriginalPostApprovalQueue` 컬럼 추가 vs 별도 테이블)
- SelfMemory 에서 "산술적 모순" 을 어떻게 판정하나 (구조화된 사실 vs 문장 검색)
- 한 페르소나가 며칠에 한 번 글을 쓰나 (활동 분산 — 아키텍처 §9 의 15점 축)

---

## §6 🔴 발행 이후 — 별도 정책이 필요하다

⑧ 단계(다른 페르소나의 댓글 · 좋아요 · 베스트)는 **이 문서가 세부를 정하지 않는다.**
개방 순서와 조건은 [자동화 전환 정본 §8](2026-09-03-controlled-activity-automation-strategy.md)이 정한다.

| 항목 | 지위 (2026-09-03 개정) |
|---|---|
| 다른 페르소나의 **댓글** | 🟡 생성기 있음(`persona-comment-generate.mts` · `--limit 1`) · **분산기 미착수** — PR-S6 |
| **좋아요 자동화** | 🟡 **controlled scaffold 로 재분류** — 금지가 아니라 조건부. 댓글 안정 이후 · PR-S7 |
| **베스트 유도** | 🟡 **controlled scaffold 로 재분류** — 같은 조건. 🔴 댓글 0개 best 를 만들지 않는다 |

> 🔴 **개정 이유 (2026-09-03)**: 초판은 좋아요·베스트를 *"정책 미확정 — 구현 금지"* 로 두면서
> **착수 조건을 이미 적어 두었다** — 상한 · kill switch · 사후 감사 · 실회원 반응 대비 비율 상한.
> **조건이 적혀 있다는 것은 열 수 있다는 뜻이다.** 창업자 결정으로 controlled scaffold 로 재분류한다.
> 다만 **순서는 바뀌지 않는다** — 댓글이 먼저다.

### 왜 나누는가

댓글은 **대화**지만, 좋아요·베스트는 **순위 조작**으로 읽힌다.
같은 "페르소나 반응" 이라도 외부에서 보이는 성격이 다르다.

> 페르소나는 [외부 비공개](2026-08-29-persona-network-strategy.md#10)다.
> 고객은 상대가 페르소나임을 모른 채 읽는다 — **잘못된 발화를 걸러낼 외부 눈이 없다.**
> 그 상태에서 인기 지표까지 페르소나가 만들면, 그건 커뮤니티 온기가 아니라 **공개 조작**이다.

착수 전에 필요한 것: 상한 · kill switch · 사후 감사 · 실회원 반응 대비 비율 상한.

---

## §7 크롤 — 🟡 수집 자동화는 열고, 발행 자동화는 닫아 둔다 (2026-09-03 개정)

```
🟡 지금         수동. 사람이 목록을 보고 고른 뒤 건별로 fetch · import
🟡 열자고 제안   크롤 · Raw Vault 적재의 cron / workflow    ← PR-S2 · 🔴 헌법 개정 승인 후
🟢 열림 (09-07) 발행 cron — 헌법 §6-9-F 2026-09-07 개정 6조건 하에서만 · PR #440
🔴 여전히 닫음   댓글 cron · reaction · best
```

🔴 **헌법 §6-9-F 가 이 문서보다 상위다.** PR-S1 은 헌법을 수정하지 않았다 —
**창업자가 §6-9-F · §12-2 개정을 승인하기 전까지 수집 cron 도 금지다.**

> 🔴 **개정 이유**: 초판과 헌법 §6-9-F 의 *"cron · workflow 는 붙이지 않는다"* 는
> **"발행 자동화를 막는다" 는 뜻이지 "수집을 막는다" 는 뜻이 아니다.**
> Raw Vault 적재는 `status` 를 HOLD 로만 만들고 `Post` 생성 경로가 코드에 없다 —
> 고객 화면과 완전히 분리돼 있다. 그런데 이 금지선 때문에 **원문 재고가 15건에서 멈췄고,
> 그것이 지금 전체 속도의 1위 병목이다.**
> 근거와 범위는 [자동화 전환 정본 §7](2026-09-03-controlled-activity-automation-strategy.md).

### 실행 환경 분리

| 소스 | 환경 | 이유 |
|---|---|---|
| 네이버 카페 | 🔴 **로컬 launchd 전용** | 쿠키를 GHA Secrets 에 올리지 않는다 |
| 82cook | 🟢 **GHA 가능** | 로그인이 없다. Mac 이 꺼져도 절반은 산다 |

### 🔴 적재기가 1건씩만 받는다 — 의도된 가드다

```
micro-seed-import-82cook-live.mts   --apply --limit=1 이 둘 다 있어야 적재
```

**조용히 우회하지 않는다.** PR-S2 에서 `--apply --batch=N` 이라는 **별도 이중 스위치**로
개정하고, 적재 대상은 여전히 `status=HOLD` 로만 만든다.

### 🔴 82cook 짧은 글은 결함이 아니다

실측: 자유게시판 313건 중 1인칭 생활 글은 74건이고, **본문이 짧은 글이 다수**다.

> 🔴 **짧은 글은 우리 타겟 커뮤니티의 실제 글쓰기 특성이다.**
> 긴 글만 고르면 표본이 우리 사용자와 달라진다.

| 기준 | 값 |
|---|---|
| 생성 · 검수 대상 하한 | **본문 120자 이상** |
| 짧은 글 | 🟢 **테스트 대상에 반드시 포함** |
| 댓글 수 | 🔴 **길이 대리 지표로 쓰지 않는다** — 실측 상관 -0.00 |
| 제목 → 길이 상관 | 0.36 — 예측이 아니라 **실측 길이로 고른다** |

---

## §8 설계 완료 vs 구현 완료

**둘을 같은 칸에 적지 않는다.** 설계가 끝난 것을 구현됐다고 읽으면 다음 사람이 없는 코드를 부른다.

**추가로 "구현됨" 과 "운영 검증됨" 과 "고객 화면 검증됨" 도 나눈다.**
코드가 있다는 것과 실제로 한 번 돌려 봤다는 것은 다르다.

| 항목 | 설계 | 구현 | 운영 검증 | 고객 화면 | 근거 |
|---|---|---|---|---|---|
| Voice Engine (말투 · 사건 구조) | ✅ | 🟢 부분 | 🟢 초안 48건 | — | 프롬프트 연결은 말투 샘플 2개뿐 |
| Originality Gate | ✅ | ✅ | ✅ PASS 4 · HOLD 3 | — | PR #300 |
| Approval Queue | ✅ | ✅ | ✅ 7건 | — | PR #303 · migration 0022 |
| 어드민 검수 화면 (읽기 전용) | ✅ | ✅ | ✅ | — | PR #303 · #325 |
| Founder Decision | ✅ | ✅ | ✅ 7건 | — | PR #305 |
| **Persona Matching** | ✅ | ✅ | ✅ **배정 5건 · 편중 0** | — | PR #309 · #313 · #317 |
| **Match Store** | ✅ | ✅ | ✅ | — | PR #323 · #325 · migration 0023 |
| **Persona Publish** | ✅ | ✅ | ✅ **발행 2건** | 🟢 **검증 완료** | PR #326 |
| Persona 5명 활성 | ✅ | ✅ | ✅ AuditLog 25행 | — | PR #311 · #315 · #321 |
| **topic-role 매칭** | ✅ (pool §6-1) | 🔴 **미착수** | — | — | 🔴 문서에만. 오배정 1건 실측 |
| **persona-first generation** | ✅ | 🔴 미착수 | — | — | 지금은 생성 후 매칭 |
| **Persona 댓글 분산** | ✅ (반응 지도) | 🟡 **생성기만** | 🟡 1건 | 🟡 | 분산기 없음 · PR-S6 |
| **좋아요 · 베스트** | 🟡 **조건만** | 🔴 미착수 | — | — | controlled scaffold 재분류 (§6) |
| Relationship / Self Memory | ✅ | 🟠 **스키마만** | 🔴 **0행** | — | 아키텍처 §7 |
| **발행 스케줄러** | ✅ | ✅ **완료** | 🟡 dry-run 만 | 🟡 | `auto-publish.yml` 00:05 KST · PR #440 · 첫 실행 09-08 |
| **일일 리포트 · 관제** | 🔴 없음 | 🔴 없음 | — | — | 🔴 **멈출 기준 없음** — 스케줄러가 도는데 관제가 없다 |
| **REAL_MEMBER 가드** | ✅ | ✅ **완료** | ✅ | — | 🔴 정본은 `Account` — `providerId` 는 adapter 가 채우지 않는다 (2026-09-08) |
| takedown 정합성 | 🟡 부분 | 🔴 미착수 | — | — | queue↔post 불일치 |
| Voice egress 재발 방지 | 🟡 부분 | 🔴 미착수 | — | — | §9 |

---


### 🔴 persona post 레일과 SEO content 레일을 섞지 않는다 (2026-09-07 추가)

이 레인(Original Post)은 **community persona 레일**이다. 페르소나가 작성자이고,
`/community/free` 에 사람이 쓴 글처럼 놓인다. **그래서 양이 곧 위험이다.**

```
community persona 레일   1 → 3 → 5/day     ← 이 레인. 자연스러움이 상한을 정한다
SEO / indexable 레일     100~200/day 가능   ← 다른 레일. 아직 설계 없음
```

| 판단 기준 | community persona 레일인가 |
|---|---|
| 작성자가 페르소나인가 | 예 → 이 레인 |
| `/community/*` 에 놓이는가 | 예 → 이 레인 |
| 회원이 "사람이 쓴 글" 로 읽는가 | 예 → 이 레인 |

🔴 **셋 중 하나라도 예면 `POST_CAP_PER_WEEK` 이 상한이다.**
페르소나 5명 × 주 1건 = 주 5건이고, 이걸 늘리는 방법은 cap 상수가 아니라 **페르소나 수**다
(자동화 전환 정본 §5 — "ladder 의 진짜 이름은 페르소나 수 ladder 다").

🔴 **SEO 대량 콘텐츠를 이 레인에 넣지 마라.** 한 사람이 하루 20건을 쓰는 순간
페르소나는 사람이 아니게 되고, 이 레인이 지켜온 것(정체성·자연스러움)이 통째로 무너진다.
대량 레일이 필요하면 **별도 레일을 설계**한다 — 그 설계는 이 문서의 범위가 아니다.

## §9 다음 우선순위

🔴 **2026-09-03 개정.** 초판의 1·2번(Matching 설계 · Publish 구현)은 **완료됐다.**
이후 순서는 [자동화 전환 정본 §10](2026-09-03-controlled-activity-automation-strategy.md)의 PR-S 묶음을 따른다.

| 순위 | PR | 왜 지금 | 고객 화면 |
|---|---|---|---|
| **1** | **S1 전략 정본화** | 문서가 실제보다 뒤처져 다음 사람이 있는 코드를 다시 짠다 | 없음 |
| **2** | **S2 Raw 공급망** | 🔴 병목 1위. 원문 15건으로는 아무것도 못 늘린다 | 없음 |
| **3** | **S3 publish `--id` + cap ladder** | 지정 발행 · 3/day 준비 | 🔴 있음 |
| **4** | **S4 persona 20명 + topic-role** | 🔴 주간 여력 5건 병목 · 오배정 방지 (REAL_MEMBER 가드 정정은 2026-09-08 완료) | 🟡 간접 |
| **5** | **S5 persona-first shadow 100/day** | S4 뒤라야 의미가 있다 | 없음 |
| **6** | **S6 댓글 분산 + Memory** | 🔴 댓글 0개 80% — 재방문이 여기서 끊긴다 | 🔴 있음 |
| **7** | **S8 일일 리포트 · 관제** | 🔴 멈출 기준이 없다. S3 와 병행 가능 | 없음 |
| **8** | **S7 reaction / best** | 🔴 S6 안정 이후 | 🔴 있음 |
| — | Voice egress 재발 방지 | **별도 운영 이슈.** Voice/M3 **재개 전**에 처리한다 | — |

### 🔴 순서를 지키는 것이 이 문서의 목적이다

초판이 *"PR-OP-D 로 직행하지 않는다"* 라고 막았던 이유는 유효했다 —
매칭 없이 발행부터 짰다면 작성자는 **운영 전용 계정**이 됐을 것이고,
그 계정이 사실상 표준이 되어 §4 의 최종안이 밀렸을 것이다.
**실제로는 순서를 지켰고, 그 결과 발행 2건이 전부 페르소나 작성자로 나갔다.**

같은 이유로 지금은 **S4 를 S5 보다 앞에** 둔다.
topic-role 없이 persona-first 생성을 하면 **먼저 정해도 똑같이 틀린다.**

---

## §10 창업자 결정

### ✅ 해결됨 (2026-09-03)

| # | 결정 | 결론 |
|---|---|---|
| 1 | **작성자** | 🟢 **매칭된 페르소나** — `Post.authorId = matchedPersona.userId` · `personaId` 기록 |
| 2 | **게시판** | 🟢 **`FREE`** — `ORIGINAL_POST_BOARD` 상수 |
| 3 | `permanentNoindex = false` | 🟢 확정 (§1 근거) |
| 4 | **출처 필드** | 🟢 **채우지 않는다** — `FORBIDDEN_POST_KEYS` 로 강제. 추적은 `sourceRawContentId` |
| 5 | **발행 cap** | 🟢 **하루 1건** (`DAILY_PUBLISH_CAP`) — 상향은 ladder 로 (아래 7번) |
| 6 | **HOLD 3건 발행 여부** | 🟢 **PASS 먼저** — `FIRST_PUBLISH_VERDICT = 'PASS'`. HOLD 3건은 대기열에 남아 있다 |

### 🟡 미해결 — 속도 결정

세부는 [자동화 전환 정본 §12](2026-09-03-controlled-activity-automation-strategy.md).

| # | 결정 | 제안 |
|---|---|---|
| 7 | 공개 발행 **cap ladder** 1 → 3 → 5 | 🟢 채택. 8/day 는 페르소나 56명이 필요해 보류 |
| 8 | **persona 20명** 확장 | 🟢 승인 — topic-role · REAL_MEMBER 정정과 **같은 PR** |
| 9 | 100/day 를 **shadow 생성 목표**로 확정 | 🟢 확정. 공개 발행 목표가 아니다 |
| 10 | 네이버=로컬 / 82cook=GHA | 🟢 채택 |
| 11 | 댓글 scaffold 를 **공개 글 5건 전후** 개방 | 🟢 개방 |
| 12 | reaction/best 를 controlled scaffold 로 | 🟢 재분류 · 구현은 댓글 안정 이후 |

### 🟡 남은 레인 내부 결정

| # | 결정 | 상태 |
|---|---|---|
| 13 | **HOLD 3건**(P17 배정 1 · 미배정 2)을 어떻게 할 것인가 | 🔴 미정 — 발행 · 수정 후 발행 · 폐기 |
| 14 | **takedown 정합성** — 글을 내리면 queue 를 어떤 상태로 | 🔴 미정 — `TAKEDOWN` enum 추가 시 `ALTER TYPE` 이 트랜잭션 밖이어야 한다 |

---

## §11 관련 문서

| 문서 | 정본 역할 |
|---|---|
| [MICRO_SEED_LANE_CONSTITUTION.md](../constitution/MICRO_SEED_LANE_CONSTITUTION.md) | §10-5 레인 분기 · §12 M4 |
| [2026-08-29-persona-network-strategy.md](2026-08-29-persona-network-strategy.md) | 페르소나 전략 · 공개 정책 |
| [2026-08-30-persona-architecture-design.md](2026-08-30-persona-architecture-design.md) | §9 Matching · §10 생성/분배 |
| [2026-08-30-persona-safety-originality-gate-design.md](2026-08-30-persona-safety-originality-gate-design.md) | Safety Gate |
| [2026-08-26-soransoran-milestones.md](2026-08-26-soransoran-milestones.md) | 큰 마일스톤 지도 |
| [**2026-09-03-controlled-activity-automation-strategy.md**](2026-09-03-controlled-activity-automation-strategy.md) | 🔴 **속도 전략 · cap ladder · persona 확장 · PR-S1~S8** |
| **이 문서** | **Original Post 레인 파이프라인 · 순서** |
