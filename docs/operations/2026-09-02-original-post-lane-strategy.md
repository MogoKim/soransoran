# Original Post 레인 정본 (2026-09-02)

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
가장 잘 맞는 페르소나가 자기 경험처럼 가져가서 쓰는 글이고, 지금은 그 앞 절반만 만들어져 있다.**

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
| 상태 | ✅ 운영 중 (5건 발행) | 🟡 **Founder Decision 까지** |

### 🔴 왜 이 레인만 index 가 되는가

헌법 §10-5:

> **"원문 그대로" 와 "검색 노출" 은 함께 갈 수 없다.** 둘 중 하나를 고르는 것이 레인 분리다.
> ❌ Derived 를 거치지 않고 원문을 다듬어 index 레인에 올린다 → §10-5 위반. **index 레인은 Derived 만 쓴다.**

Original Post 는 정확히 그 Derived 레인이라서 `permanentNoindex = false` 가 **맞다.**
바꿔 말하면 **Derived 가 아니게 되는 순간 index 자격도 사라진다.** 이것이 Originality Gate 가 존재하는 이유다.

---

## §2 파이프라인 전체

```
①  크롤 / 수집          82cook → MicroSeedRawContent
                        🔴 production 자동화가 아니다 — 소재 테스트용 수동 절차 (§7)
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
        ↓  ◀━━━━━━━━━━━━━ 🔴 여기까지 구현됨 (2026-09-02)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        ↓
⑥  Persona Matching     🔜 **다음 작업.** 누가 이 글을 자기 경험으로 쓸 수 있나
                        🔴 실패하면 발행하지 않는다 (§5)
        ↓
⑦  Persona Publish      Post.authorId = 그 페르소나의 User · Post.personaId 기록
        ↓
⑧  Persona Comments     다른 페르소나의 댓글 · 반응
    / Reactions         🔴 좋아요 · 베스트 유도는 **정책 미확정** (§6)
```

🔴 **⑥ 을 건너뛰고 ⑦ 로 갈 수 없다.** 근거는 §4 · §5.

---

## §3 현재 상태 (2026-09-02 실측)

### main 반영

| PR | 무엇을 |
|---|---|
| **#291** | `closingIntent` — 원문이 어떻게 닫히는가. 억지 CTA 제거 |
| **#295** | `titleShape` (사건형 · 주접형 · 담백형) + **URL 2분** (출처 금지 / 소재 링크 조건부 허용) |
| **#300** | **Originality Gate** — BLOCK 7종 / HOLD 11종 / PASS |
| **#303** | **`OriginalPostApprovalQueue`** (migration 0022) + 읽기 전용 어드민 |
| **#305** | **결정 스크립트** — APPROVED / DECLINED / EDITED |

### DB

```
MicroSeedRawContent            15
MicroSeedCandidate             15   (Micro Seed 레인 · PUBLISHED 5)
Post                           32   (USER 27 · SYSTEM/micro-seed 5)
OriginalPostApprovalQueue       7   🟢 전부 APPROVED
  └ createdPostId               0   🔴 발행된 것 없음
  └ decidedBy                founder · 2026-09-02 16:33 KST
Post.personaId 있는 글          0
```

🔴 **발행 경로는 존재하지 않는다.** `APPROVED` 7건은 어디에도 나가지 않았다.

### 🔴 초안 7건이 index 레인의 첫 자동 생성 글이 된다

현재 색인되는 Post 26건은 **전부 `source = USER`** 다.
SYSTEM 글 5건은 전부 micro-seed(noindex).
즉 이 7건이 **sitemap 에 들어가는 첫 자동 생성 글**이다. 실수의 무게가 다르다.

> 우나어 색인이 4,600 → 0 이 된 것은 품질 문제가 아니라
> **원문을 SEO 노출 방식으로 다룬 구조**의 문제였다 (헌법 §10-2).

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

⑧ 단계(다른 페르소나의 댓글 · 좋아요 · 베스트 유도)는 **이 문서가 승인하지 않는다.**

| 항목 | 지위 |
|---|---|
| 다른 페르소나의 **댓글** | 🟡 설계는 있음([아키텍처 §10-2](2026-08-30-persona-architecture-design.md) 반응 지도) · **구현 미착수** |
| **좋아요 자동화** | 🔴 **정책 미확정 — 구현 금지** |
| **베스트 유도** | 🔴 **정책 미확정 — 구현 금지** |

### 왜 나누는가

댓글은 **대화**지만, 좋아요·베스트는 **순위 조작**으로 읽힌다.
같은 "페르소나 반응" 이라도 외부에서 보이는 성격이 다르다.

> 페르소나는 [외부 비공개](2026-08-29-persona-network-strategy.md#10)다.
> 고객은 상대가 페르소나임을 모른 채 읽는다 — **잘못된 발화를 걸러낼 외부 눈이 없다.**
> 그 상태에서 인기 지표까지 페르소나가 만들면, 그건 커뮤니티 온기가 아니라 **공개 조작**이다.

착수 전에 필요한 것: 상한 · kill switch · 사후 감사 · 실회원 반응 대비 비율 상한.

---

## §7 크롤은 아직 production 자동화가 아니다

```
🟢 지금        소재 테스트 · 샘플 공급용 **수동 절차**
               사람이 목록을 보고 고른 뒤 건별로 fetch · import
🔴 아직 아님    cron · workflow · 자동 수집
```

헌법 §6-9-F · [마일스톤 §5 금지선](2026-08-26-soransoran-milestones.md) 이 그대로 적용된다.

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

| 항목 | 설계 | 구현 | 근거 |
|---|---|---|---|
| Voice Engine (말투 · 사건 구조) | ✅ | 🟢 부분 | 초안 48건 생성 |
| Originality Gate | ✅ | ✅ | PR #300 |
| Approval Queue | ✅ | ✅ | PR #303 · migration 0022 |
| 어드민 검수 화면 (읽기 전용) | ✅ | ✅ | PR #303 |
| Founder Decision | ✅ | ✅ | PR #305 |
| **Persona Matching** | 🟡 **부분** (아키텍처 §9 점수표) | 🔴 **미착수** | 정체성 충돌 축 미확정 (§5) |
| **Persona Publish** | 🔴 **미착수** | 🔴 **미착수** | 작성자 · 게시판 · cap 미확정 |
| Persona 댓글 | ✅ (반응 지도) | 🔴 미착수 | 아키텍처 §10-2 |
| **좋아요 · 베스트** | 🔴 **정책 없음** | 🔴 **금지** | §6 |
| Relationship / Self Memory | ✅ | 🔴 미착수 | 아키텍처 §7 |
| Voice egress 재발 방지 | 🟡 부분 | 🔴 미착수 | §9 |

---

## §9 다음 우선순위

| 순위 | 작업 | 왜 지금 |
|---|---|---|
| **1** | 🔴 **Persona Matching 설계** | ⑥ 없이 ⑦ 로 가면 정체성이 무너진다. 되돌릴 수 없다 |
| **2** | Persona Publish 구현 (PR-OP-D) | 1 이 끝난 뒤 |
| **3** | Persona 댓글 (⑧ 앞 절반) | 글만 있으면 게시판이지 커뮤니티가 아니다 |
| — | Voice egress 재발 방지 | **별도 운영 이슈.** Voice/M3 **재개 전**에 처리한다. 이 레인의 발행 설계보다 앞서지 않는다 |
| — | 좋아요 · 베스트 | 🔴 정책 확정 전 착수 금지 |

### 🔴 지금 PR-OP-D 로 직행하지 않는다

발행 코드를 먼저 짜면 작성자를 정해야 하고, 그때 손에 잡히는 답은 **운영 전용 계정**이다.
그렇게 한 번 발행하면 그 계정이 사실상 표준이 되고 §4 의 최종안이 밀린다.
**순서를 지키는 것이 이 문서의 목적이다.**

---

## §10 발행 전 창업자 결정 (미해결)

| # | 결정 | 상태 |
|---|---|---|
| 1 | **작성자** — 어느 페르소나가 쓰나 | 🔴 §5 매칭 설계 후 |
| 2 | **게시판** — `FREE` / `MENOPAUSE` | 🟡 미정 |
| 3 | `permanentNoindex = false` | 🟢 **확정** (§1 근거) |
| 4 | **출처 필드**(`sourceUrl` 등) 채울 것인가 | 🟡 제안: **채우지 않는다** — 색인되는 글에 82cook URL 을 붙이지 않는다. 추적은 대기열의 `sourceRawContentId` |
| 5 | **발행 cap** | 🟡 제안: 하루 1건 (`CAPS.burst`) |
| 6 | **HOLD 3건 발행 여부** | 🟡 제안: PASS 4건 먼저 |

---

## §11 관련 문서

| 문서 | 정본 역할 |
|---|---|
| [MICRO_SEED_LANE_CONSTITUTION.md](../constitution/MICRO_SEED_LANE_CONSTITUTION.md) | §10-5 레인 분기 · §12 M4 |
| [2026-08-29-persona-network-strategy.md](2026-08-29-persona-network-strategy.md) | 페르소나 전략 · 공개 정책 |
| [2026-08-30-persona-architecture-design.md](2026-08-30-persona-architecture-design.md) | §9 Matching · §10 생성/분배 |
| [2026-08-30-persona-safety-originality-gate-design.md](2026-08-30-persona-safety-originality-gate-design.md) | Safety Gate |
| [2026-08-26-soransoran-milestones.md](2026-08-26-soransoran-milestones.md) | 큰 마일스톤 지도 |
| **이 문서** | **Original Post 레인 파이프라인 · 순서** |
