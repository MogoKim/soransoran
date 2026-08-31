# Persona DB 모델 설계

> 작성 2026-08-31 · 상태 **설계 · schema/migration 미착수**
> 선행: [Pool 설계](2026-08-30-persona-pool-design.md) · [MVP 활성화](2026-08-30-persona-mvp-activation-design.md) ·
> [Gate ⑥ 닉네임 충돌](2026-08-31-persona-gate6-nickname-collision-design.md)
> 정책 정본: [전략 §10](2026-08-29-persona-network-strategy.md) 외부 비공개 / 내부 어드민 명확 구분

---

## §1 이 문서가 푸는 것

```
🔴 Gate ⑥-B 의 B3 대조 집합이 비어 있다
   loadPersonaDisplayNames() 가 빈 배열을 돌려준다 — Persona 모델이 없기 때문이다.
   지금 이름을 배정하면 페르소나끼리 겹쳐도 잡지 못한다.
```

**작명보다 모델이 먼저다.** 이 문서는 모델을 확정하고, schema 작성은 승인 후에 한다.

### 🔴 이 문서가 하지 않는 것

```
🔴 prisma/schema.prisma 수정 · migration 생성 · DB write
🔴 displayName 실제 작명 · Persona seed 생성 · Persona Bot 생성
🔴 댓글/글 생성 실험 · 자동 발행 연결 · 고객 화면 UI 수정
```

---

## §2 🔴 기존 스키마가 이미 정한 것 — 실측

새 모델을 얹기 전에 **이 저장소가 이미 세워 둔 원칙**을 확인했다.

### §2-1 축을 섞지 않는다 (schema.prisma 41~44행 주석)

```
🔴 AuthorSource 를 확장하지 않는다. 두 질문은 다른 축이다.
   AuthorSource  = "사람이 썼나"        (USER / SYSTEM)
   CommentOrigin = "어느 레인에서 왔나" (MEMBER / PERSONA / MICRO_SEED_VERBATIM)
   한 필드가 두 질문에 답하게 하면 분류가 무너진다.
```

**Persona 도 같은 규칙을 따른다.** `personaId` 는 **세 번째 축**이다 —
*"누가 썼나"*. 앞의 두 축 어느 쪽에도 넣지 않는다.

### §2-2 🔴 Post 에는 PERSONA 를 표현할 방법이 지금 없다

| 모델 | 갖고 있는 축 |
|---|---|
| `Comment` | `source AuthorSource` + **`commentOrigin CommentOrigin`** (MEMBER / PERSONA / MICRO_SEED_VERBATIM) |
| `Post` | `source AuthorSource` **만** |

🔴 **비대칭이다.** 댓글은 PERSONA 를 기록할 수 있는데 글은 못 한다.
Persona Network 는 글도 만든다([전략 §11](2026-08-29-persona-network-strategy.md)).
**이 공백을 메우지 않으면 페르소나 글은 실회원 글과 DB 에서 구분되지 않는다.**

### §2-3 탈퇴는 지금 막혀 있다

```prisma
authorId String
author   User @relation(fields: [authorId], references: [id])   // onDelete 미지정 = Restrict
```

주석이 이유를 적어 뒀다 — *"회원 탈퇴/익명화 정책은 private preview 범위 밖"*.
🔴 **글이 있는 회원은 삭제 자체가 실패한다.**
그래서 §8 의 "탈퇴 시 memory 즉시 삭제" 는 **User 삭제와 다른 경로**여야 한다.

---

## §3 Persona 기본 모델

### §3-1 🔴 `User` 와 분리하되 1:1 로 잇는다

```
Persona  ──@unique userId──▶  User
```

| 왜 분리하는가 | |
|---|---|
| 🔴 **`User` 에 필드를 얹으면 실회원 행에 전부 nullable 로 붙는다** | 4명짜리 테이블에 20개 컬럼이 늘어나고, 회원 조회마다 딸려 온다 |
| 🔴 **고객 화면 코드가 Persona 를 모르게 유지한다** | `display-name.ts` 는 `User` 만 본다. 그대로 두면 페르소나가 자동으로 일반 회원처럼 보인다 |
| **탈퇴·차단·신고 로직을 건드리지 않는다** | 실회원 경로가 Persona 필드를 만나지 않는다 |

| 왜 1:1 로 잇는가 | |
|---|---|
| `Post.authorId` · `Comment.authorId` 가 **NOT NULL** 이다 | 페르소나도 `User` 행이 있어야 글을 쓸 수 있다 |
| `User.nickname` 의 `@unique` 가 1차 방어선이 된다 | 완전 일치만 막지만 없는 것보다 낫다 (Gate ⑥-B §9) |

🔴 **`User` 에 `isPersona` 플래그를 두지 않는다.** `Persona.userId` 의 존재 여부가 답이고,
플래그를 따로 두면 두 값이 어긋나는 날이 온다.

### §3-2 필드 후보

| 그룹 | 필드 | 비고 |
|---|---|---|
| **식별** | `id` | |
| | `code` | 🔴 `P01`~ 내부 코드 · **unique** · **외부 노출 금지** |
| | `userId` | `@unique → User` |
| | `displayName` | 🔴 **§4 참조** — `User.nickname` 과 이중 저장하지 않는다 |
| **상태** | `status` | `draft` / `active` / `paused` / `retired` — §5 |
| | `activatedAt` · `pausedAt` · `retiredAt` | 상태 전환 시각 |
| **정체성** | `identity` | 7층 구조 §1 — Json |
| | `ageBand` · `region` · `lifeStage` | 🔴 밴드·구분값만. 정확한 나이·시·구 금지 |
| **말투** | `voiceCore` | §6 |
| | `voiceVariations` | §6 |
| **운영** | `activityRhythm` | §6 |
| | `dailyCap` · `weeklyCap` · `silenceRate` | §7 |
| | `noGoTopics` · `noGoExpressions` · `forbiddenReactionRoles` | §6 |
| **감사** | `createdAt` · `updatedAt` | |

🔴 `mood` 는 여기 두지 않는다 — **날마다 바뀌는 상태**다. §6-2.

---

## §4 `displayName` 저장 위치 — 🔴 한 곳에만 둔다

세 가지가 가능한데 **하나만 정본이어야** 한다.

| 안 | 문제 |
|---|---|
| `User.nickname` 에만 | 🔴 어드민이 `Persona` 만 보고 이름을 알 수 없다 |
| `Persona.displayName` 에만 | 🔴 고객 화면(`display-name.ts`)이 이름을 못 찾는다 |
| **둘 다** | 🔴 **어긋난다.** 한쪽만 바꾸는 날이 반드시 온다 |

### 🟡 권고 — `User.nickname` 이 정본, `Persona.displayName` 은 두지 않는다

```
고객 화면   User.nickname       ← display-name.ts 가 이미 읽는다. 코드 변경 0
어드민     Persona ⟶ User.nickname 을 join 해서 보여준다
Gate ⑥-B   B3 대조도 join 으로 읽는다
```

🔴 **대신 `Persona.retiredDisplayNames String[]` 를 둔다.**
`retired` 로 바뀔 때 `User.nickname` 을 비우거나 바꾸면 그 이름이 사라지는데,
**폐기한 이름은 대조 집합에 남아야 한다**(Gate ⑥ 설계 §10). §9 참조.

🔴 **이 문서는 이름을 짓지 않는다.** 작명은 Gate ⑥-B 가 붙은 뒤다.

---

## §5 `status` — 4단계

```
draft ──▶ active ──▶ paused ──▶ active
                 └──▶ retired  (되돌리지 않는다)
```

| 값 | 뜻 | 발화 |
|---|---|---|
| `draft` | 정의만 있고 켜지 않았다 | ❌ |
| `active` | 운영 중 | 🟢 |
| `paused` | 일시 중지 — 운영자가 언제든 | ❌ |
| `retired` | 은퇴 | ❌ |

🔴 **`retired` → `active` 는 막는다.** 은퇴한 이름이 다시 나타나면 회원이 혼동한다.
되살리려면 새 `code` 로 새로 만든다.

🔴 **`status` 만으로 발화를 막지 않는다.** kill switch 는 별도다 — §7-2.

---

## §6 정체성 · 말투 · 리듬 · 기억

### §6-1 Json 으로 두는 것과 컬럼으로 빼는 것

```
🟢 컬럼    조회·필터·정렬에 쓰는 것        status · code · ageBand · dailyCap
🟢 Json    통째로 읽고 통째로 쓰는 것       identity · voiceCore · voiceVariations
                                          activityRhythm · noGo*
```

🔴 **`voiceVariations` 를 테이블로 빼지 않는다.** 페르소나당 3~5개이고 항상 함께 읽는다.
테이블로 빼면 조회마다 join 이 붙고, 얻는 것은 없다.

🔴 **헌법 §9-6 이 금지한 것과 다르다.** 금지된 것은 *"페르소나를 TS 상수 배열로 두는 것"* 이고,
여기는 DB 행이다. 우나어 225명 PR 이 7단계를 소모한 사례가 그 금지의 근거다.

### §6-2 `mood` 는 별도 테이블

```
PersonaMoodState   personaId · date · mood · seed · createdAt
                   @@unique([personaId, date])
```

🔴 `Persona` 컬럼으로 두면 **어제 어떤 mood 였는지 알 수 없다.**
생성물이 이상할 때 그날 mood 를 되짚는 것이 첫 단서다.

### §6-3 `activityRhythm`

```json
{ "activeHours": [[9,12],[20,22]], "weekdayBias": 0.6, "burstiness": 0.3 }
```

🔴 **밴드·확률로 둔다.** 정확한 시각 목록을 두면 그 자체가 봇 패턴이 된다.

### §6-4 Memory — 4종을 한 테이블에 두지 않는다

| 종류 | 테이블 | 삭제 요건 |
|---|---|---|
| **Self** | `PersonaSelfMemory` | 은퇴 후에도 이력으로 보존 |
| **Relationship** | `PersonaUserRelationship` | 🔴 **회원 탈퇴 시 즉시 삭제** — §8 |
| **Community** | `PersonaCommunityMemory` | 보존 |
| **Negative** | `PersonaNegativeMemory` | 보존 (다시 하지 말아야 할 것) |

🔴 **Relationship 만 회원을 가리킨다.** 하나로 합치면 탈퇴 시 지울 대상을 골라내야 하고,
그 필터가 틀리면 지워야 할 것이 남는다. **테이블이 다르면 지우는 경로도 다르다.**

---

## §7 상한 · 중지

### §7-1 `dailyCap` · `weeklyCap` — 페르소나별

`Persona` 컬럼으로 둔다. 운영자가 개별 조정한다.

🔴 **사용량은 별도 테이블**(`PersonaActivityLog`)에서 센다. `Persona` 에 카운터를 두면
발화마다 그 행을 잠근다 — `0012_scrap` 이 `scrapCount` 를 만들지 않은 것과 같은 판단이다.

### §7-2 🔴 kill switch — 전체 단위

```
PersonaGlobalSwitch   id(단일 행) · enabled · reason · changedBy · changedAt
```

| 층 | 무엇을 멈추나 |
|---|---|
| **전체 kill switch** | 🔴 모든 페르소나 — 한 번에 |
| `status = paused` | 그 페르소나만 |
| `dailyCap` 초과 | 그날만 |

🔴 **세 층을 하나로 합치지 않는다.** 전체를 멈추려고 페르소나 20개의 `status` 를
하나씩 바꾸는 것은 사고 상황에서 쓸 수 없다.

🔴 [전략 §10-2](2026-08-29-persona-network-strategy.md)가 못박았다 —
**kill switch 가 없으면 자동화 2단계를 열 수 없다.**

---

## §8 회원 탈퇴 — 🔴 지금은 막혀 있다

§2-3 실측: `Post.authorId` 가 `Restrict` 라 **글이 있는 회원은 삭제 자체가 실패**한다.

그래서 이렇게 나눈다.

```
🟢 지금 만들 수 있는 것   PersonaUserRelationship 을 userId 로 즉시 삭제하는 경로
🔴 지금 정할 수 없는 것   User 행 자체의 삭제/익명화 — private preview 범위 밖
```

```
PersonaUserRelationship
  @@unique([personaId, userId])
  @@index([userId])            🔴 이 단일 인덱스가 핵심이다
```

복합 인덱스만 두면 `userId` 로만 지울 때 전체 스캔이 된다.
🔴 **"익명화가 아니라 삭제" 를 실행 가능하게 만드는 것이 이 한 줄이다.**

---

## §9 Gate ⑥-B B3 대조 — retired·paused 포함 전부

Gate ⑥ 설계 §3 이 요구한다 — **`status` 와 무관하게 전부 대조**한다.

```
현재 이름   Persona ⟶ User.nickname       (status 무관)
폐기 이름   Persona.retiredDisplayNames   (§4)
```

🔴 **폐기한 이름을 대조 집합에서 지우지 않는다.** 지우면 다음 작명에서 같은 이름이 다시 나온다.

이 모델이 서면 `loadPersonaDisplayNames()` 의 TODO 가 풀린다 —
지금은 빈 배열을 돌려주고 있어 **B3 검사가 사실상 꺼져 있다.**

---

## §10 로그 — 생성 · 승인 · 수정 · 폐기 · 발행

### §10-1 두 테이블로 나눈다

| 테이블 | 무엇 | 주기 |
|---|---|---|
| `PersonaAuditLog` | 페르소나 **정의**의 변경 — 생성 · 승인 · 수정 · 상태 전환 · 폐기 | 드물다 |
| `PersonaActivityLog` | 페르소나의 **발화** — 후보 생성 · Gate 결과 · 승인 · 발행 | 잦다 |

🔴 **합치지 않는다.** 주기가 100배 다르다. 합치면 "이 페르소나 정의가 언제 바뀌었나" 를
발화 수십만 건 속에서 찾아야 한다.

### §10-2 `PersonaActivityLog` 후보 필드

```
personaId · kind(post|comment) · targetId? · gateStatus · gateHits(Json)
aiToneTags(String[]) · decidedBy(auto|operator) · publishedAt? · createdAt
@@index([personaId, createdAt])
@@index([createdAt])
```

🔴 **생성물 원문을 담지 않는다.** 발행된 것은 `Post`·`Comment` 에 있고,
폐기된 것은 **남길 이유가 없다** — 요약과 Gate 결과만 남긴다.
(Gate 설계 §9 가 정한 원칙과 같다)

---

## §11 `Post.personaId` · `Comment.personaId`

### §11-1 🔴 둘 다 둔다

| | 현재 | 필요한 것 |
|---|---|---|
| `Comment` | `commentOrigin = PERSONA` 로 **레인**은 안다 | 🔴 **어느 페르소나인지는 모른다** |
| `Post` | 🔴 **레인조차 모른다** (§2-2) | 둘 다 필요 |

```prisma
personaId String?
persona   Persona? @relation(fields: [personaId], references: [id])
@@index([personaId])
```

| 장 | 단 |
|---|---|
| 🟢 "어떤 글·댓글을 어떤 페르소나가 썼나" 를 **join 없이** 안다 | 🔴 컬럼 2개 추가 — 기존 테이블 변경 |
| 🟢 kill switch 후 **그 페르소나 발화만 골라 내리기** 가 가능하다 | 🟡 nullable 이라 실회원 행에는 NULL 이 쌓인다 |
| 🟢 [전략 §10-2](2026-08-29-persona-network-strategy.md) 의 "전부 추적" 요건을 직접 만족한다 | |

🔴 **`authorId → User → Persona` join 으로 대신할 수 있지 않은가?**
할 수 있다. 그러나 **takedown 이 급할 때 join 이 하나 더 붙는다.**
`0012_scrap` 이 `(userId, createdAt)` 인덱스를 미리 만든 것과 같은 판단이다 —
**쓸 곳이 이미 있다.**

### §11-2 🔴 `Post.source` 를 확장하지 않는다

`AuthorSource` 에 `PERSONA` 를 넣고 싶어지지만, §2-1 주석이 이미 금지했다.
*"사람이 썼나"* 와 *"누가 썼나"* 는 다른 질문이다.

🟡 **`Post` 에 `postOrigin` enum 을 둘지는 미결**로 남긴다 —
`Comment.commentOrigin` 과 대칭을 맞추는 것이 옳아 보이나,
`personaId` 만으로도 판별되므로 **중복 축**이 될 수 있다. §13-②.

---

## §12 enum vs string

### 실측 선례

| 방식 | 사례 | 이유 |
|---|---|---|
| **enum** (11개) | `CommentOrigin` · `AuthorSource` · `PostStatus` · `MicroSeedCandidateStatus` … | 값이 고정이고 코드가 분기한다 |
| **string** (2개) | `VoiceSource.origin` · `VoiceM3Cache.origin` | 주석: *"M6 multi-source 확장에서 값이 늘어나는데 그때마다 migration 을 요구하면 source 추가가 schema 작업이 된다"* |

### 🟡 권고 — 축마다 다르게 판단한다

| 필드 | 권고 | 근거 |
|---|---|---|
| `Persona.status` | 🟢 **enum** | 4개로 닫혀 있고 전이 규칙이 코드에 있다(§5). 값이 늘 이유가 없다 |
| `PersonaAuditLog.action` | 🟢 **enum** | 생성·승인·수정·폐기·상태전환 — 감사 대상이라 오타가 치명적이다 |
| `PersonaActivityLog.kind` | 🟢 **enum** | `post` / `comment` 둘뿐 |
| `aiToneTags` | 🟢 **String[]** | 🔴 8종이 관찰로 바뀐다. 늘 때마다 migration 은 과하다 |
| `voiceCore` · `identity` 내부 값 | 🟢 **Json** | 스키마화 이르다 |

🔴 **기준은 "값이 늘어날 때 migration 이 정당한가" 다.**
`status` 가 늘면 코드 분기도 바뀌어야 하니 migration 이 정당하다.
`aiToneTags` 는 관찰이 쌓이면 늘어나는데, 그때마다 스키마를 고칠 이유가 없다.

---

## §13 🔴 창업자 결정사항

| # | 결정 | 권고 | 미결 이유 |
|---|---|---|---|
| **①** | **Persona 를 `User` 와 분리할지** | 🟡 **분리 + `@unique userId` 1:1** (§3-1) | 되돌리기 어렵다. 합치면 실회원 테이블이 무거워지고 고객 화면 코드가 Persona 를 알게 된다 |
| **②** | **`Post.personaId` · `Comment.personaId` 둘 다 둘지** | 🟡 **둘 다** (§11-1) | 기존 테이블 2개 변경. `Post` 는 지금 PERSONA 를 표현할 방법이 아예 없다 |
| **②-b** | `Post.postOrigin` enum 도 둘지 | 🔴 **미결** | `personaId` 와 중복 축이 될 수 있다 (§11-2) |
| **③** | **테이블 분리 수준** | 🟡 `Persona` + `MoodState` + memory 4종 + `AuditLog` + `ActivityLog` + `GlobalSwitch` = **9개** | 적게 시작해 나중에 쪼개면 데이터 이관이 생긴다. 많이 시작하면 초기 복잡도가 오른다 |
| **④** | **enum vs string** | 🟡 축마다 다르게 (§12) | 일괄 결정이 아니다 |
| **⑤** | **MVP 5명 DB 이전 승인** | 🔴 **보류 권고** | 🔴 아래 |

### 🔴 ⑤ 를 보류로 권고하는 이유

MVP 5명(P05·P07·P10·P15·P17)을 DB 로 옮기려면 **`displayName` 이 있어야 하는데,
작명은 Gate ⑥-B 가 붙은 뒤다.** 순서가 뒤집힌다.

```
지금 옮기면   displayName 없이 행만 만든다 → 나중에 배정 → 그때 Gate ⑥-B 재검사
나중에 옮기면 Gate ⑥-B 통과한 이름으로 한 번에 만든다
```

🟡 **후자를 권고한다.** 다만 ①②③④ 가 정해지면 **schema 는 먼저 세울 수 있다** —
빈 테이블은 위험하지 않다.

---

## §14 migration 적용 순서 초안

```
0014  Persona · PersonaMoodState                    새 테이블만. 기존 무변경
0015  memory 4종 (Self · Relationship · Community · Negative)
      🔴 PersonaUserRelationship 에 @@index([userId]) 필수 (§8)
0016  PersonaAuditLog · PersonaActivityLog · PersonaGlobalSwitch
0017  🔴 Post.personaId · Comment.personaId          ← 기존 테이블 변경. 여기만 다르다
```

🔴 **0017 을 마지막에 둔다.** 앞의 셋은 새 테이블만 만들어 기존 경로에 영향이 없다.
0017 만 운영 중 테이블을 건드리므로, 앞이 검증된 뒤에 한다.

전부 **멱등**하게 쓴다 — `CREATE TABLE IF NOT EXISTS` · `ADD COLUMN IF NOT EXISTS`
(`0012_scrap` · `0013_author_hash_norm` 관례).

🔴 적용은 `scripts/apply-migration.mjs` 가 아니라 **전용 스크립트**로 한다.
그쪽은 `0001_init` 전용이고 *"테이블이 이미 있으면 중단"* 한다(PR #237 에서 확인).

---

## §15 rollback 원칙

| 대상 | rollback | 안전한가 |
|---|---|---|
| 0014~0016 새 테이블 | `DROP TABLE IF EXISTS` | 🟢 읽는 코드가 없으면 안전 |
| 0017 `personaId` 컬럼 | `DROP COLUMN IF EXISTS` | 🟢 nullable · FK 는 함께 사라진다 |

```
🔴 데이터가 든 뒤의 DROP 은 rollback 이 아니라 삭제다.
   Persona 행이 생긴 뒤에는 status=retired 로 끄고, DROP 하지 않는다.
🔴 Post.personaId 를 DROP 하면 "어느 페르소나가 썼는지" 를 영구히 잃는다.
   외부 비공개 정책에서 그 추적성이 유일한 통제 수단이다(전략 §10-3).
```

🟡 **되돌릴 계획이 필요한 지점은 0017 하나다.** 앞의 셋은 비어 있는 동안 자유롭다.

---

## §16 확정 / 미확정

### 🟢 이 문서가 확정한 것 (설계 수준)

```
🟢 Persona 는 User 와 분리하고 @unique userId 로 잇는다 (근거: §3-1)
🟢 displayName 은 User.nickname 이 정본. Persona 에 이중 저장하지 않는다 (§4)
🟢 폐기 이름은 retiredDisplayNames 로 보존한다 (§4 · §9)
🟢 status 4단계. retired → active 는 막는다 (§5)
🟢 mood 는 날짜별 별도 테이블 (§6-2)
🟢 memory 4종을 한 테이블에 두지 않는다. Relationship 만 회원을 가리킨다 (§6-4)
🟢 PersonaUserRelationship 에 @@index([userId]) — 탈퇴 삭제 경로 (§8)
🟢 kill switch · status · cap 세 층을 분리한다 (§7-2)
🟢 AuditLog 와 ActivityLog 를 분리한다 — 주기가 100배 다르다 (§10-1)
🟢 AuthorSource 를 확장하지 않는다 — 축을 섞지 않는다 (§2-1 · §11-2)
🟢 enum/string 은 "값이 늘 때 migration 이 정당한가" 로 가른다 (§12)
```

### 🔴 아직 구현 전인 것 — 전부

```
🔴 prisma/schema.prisma        한 줄도 쓰지 않았다
🔴 migration 0014~0017         파일이 없다
🔴 DB write                    0
🔴 displayName 작명            0
🔴 Persona seed · Bot          0
🔴 자동 발행 연결               0
🔴 고객 화면 UI                 0
```

### 🔴 창업자 결정 없이는 못 가는 것

```
① Persona ↔ User 분리       ②  Post/Comment.personaId    ②-b postOrigin
③ 테이블 분리 수준            ④  enum vs string           ⑤  MVP 5명 이전 시점
```

**①②③④ 가 정해지면 schema 를 세울 수 있다. ⑤ 는 Gate ⑥-B 작명 이후를 권고한다.**
