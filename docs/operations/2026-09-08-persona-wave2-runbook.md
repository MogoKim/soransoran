# Persona 2차 확장 runbook — P01 · P02 · P11

> 선행: [Pool 설계](2026-08-30-persona-pool-design.md) · [DB 모델](2026-08-31-persona-db-model-design.md) ·
> [MVP 활성화](2026-08-30-persona-mvp-activation-design.md)
>
> 🔴 이 문서는 **순서**를 정한다. 순서를 어기면 스크립트가 fail-closed 로 멈춘다.

## §1 왜 이 세 명인가

`persona-capacity-planner` 가 미활성 카드의 **364조합을 전수 탐색**했다.
재고 14건 기준으로 7일 7건 · 14일 14건 · 공백 0을 만드는 **최소 인원이 3명**이고,
그중 창업자가 `P01 · P02 · P11` 을 확정했다.

| 코드 | 카드 | 맡는 축 |
|---|---|---|
| **P01** | 아이 키우며 파트타임 | 자녀 중고등 · 갱년기 전 · 돈·일 |
| **P02** | 아이 하나, 남편과 소원 | **자녀 초등**(유일) · 가족 갈등 · 갱년기 전 |
| **P11** | 시골에서 가게하며 셋 키운 | 자녀 중고등+성인 · 생활 정보·잡담 · 자영업 |

🔴 발행량으로는 364조합이 전부 동률이다. 이 조합은 **M3 반응 지도(§6-1) 댓글 커버리지**와
얇은 축(자녀 중고등 · 초등 · 갱년기 전)으로 갈렸다.

## §2 🔴 대상은 코드에 못박혀 있다

`src/lib/persona-wave2.ts` 의 `WAVE2_CODES` 가 정본이다.
**세 스크립트 모두 `--code` 인자를 받지 않는다.**

> `persona-activate.mts` 가 이미 이유를 적어 두었다 —
> *"인자로 code 를 받으면 그때그때 다른 페르소나를 켜는 도구가 된다."*
> 한 번 그런 도구가 되면 승인받지 않은 사람이 승인받은 사람과 같은 명령으로 켜진다.
> 대상이 바뀌면 **스크립트를 새로 만든다.**

## §3 입력 파일 — 🔴 MVP 5명 것과 분리한다

| 용도 | 이번 회차 | MVP 5명 (🔴 건드리지 않는다) |
|---|---|---|
| 닉네임 | `tmp/persona-wave2-displayname.json` | `tmp/persona-displayname-selected.json` |
| seed | `tmp/persona-wave2-seed.json` | `tmp/persona-seed.json` |

둘 다 `tmp/` 라 gitignored 다 — 닉네임이 저장소에 남지 않는다 (Pool §3-2 이유 ②).

확정 닉네임: **도토리(P01) · 이슬비(P02) · 늦가을(P11)** — Gate ⑥-B 전원 `pass` 실측.

## §4 🔴 순서 — 어기면 멈춘다

```
① 생성        User + Persona(draft) + AuditLog
② seed        identity · voiceCore · … (status 는 draft 그대로)
③ 검증        --check 두 번
④ 활성화      draft → active   🔴 별도 승인
```

**왜 순서가 강제인가.** seed 없이 켜면 매칭이 그 사람을 **기본값으로 잘못 판정한다** —
`childrenCount` 가 비어 전원 무자녀로 처리된 #468 이 그것이다.
닉네임 없이 켜면 글에 이름이 붙지 않는다.

각 스크립트가 앞 단계를 실측해 막는다(`judgeCreate` · `judgeSeed` · `judgeActivate`).

## §5 명령

### ① 생성 (draft)

```bash
npx tsx scripts/persona-wave2-assign.mts            # dry-run — DB write 0
npx tsx scripts/persona-wave2-assign.mts --apply    # 실제 생성
npx tsx scripts/persona-wave2-assign.mts --check    # 결과 대조
```

- 🔴 Gate ⑥-B 를 **적용 직전에 다시 본다** — 작명과 배정 사이에 회원이 같은 이름을 만들 수 있다
- 🔴 하나라도 막히면 **전부 중단** — 일부만 만들지 않는다
- 🔴 기존 User 를 재사용하지 않는다 — Account 가 붙은 계정을 주우면 그 사람 이름으로 글이 나간다
- 세 명이 **하나의 트랜잭션**. 사후에 Post · Comment · Queue · ActivityLog 불변을 대조한다

### ② seed 적용

```bash
npx tsx scripts/persona-wave2-seed-apply.mts            # dry-run
npx tsx scripts/persona-wave2-seed-apply.mts --apply    # 실제 적용
npx tsx scripts/persona-wave2-seed-apply.mts --check    # 반영 대조
```

- 🔴 **Pool 카드(§5) 정본과 대조한다** — 7개 매칭 축 · 제어값 · 금지값 · 자녀 정합
- 🔴 `status` 를 건드리지 않는다. 적용 후 `draft` 유지를 확인한다
- 세 명이 **하나의 트랜잭션**

### ③ 검증

```bash
npx tsx scripts/persona-wave2-assign.mts --check
npx tsx scripts/persona-wave2-seed-apply.mts --check
npx tsx scripts/persona-capacity-planner.mts        # 발행량이 예측대로인지
npm run supply:health -- --json                     # PERSONA_SHORTFALL 해소 확인
```

### ④ 활성화 — 🔴 별도 승인

```bash
ACTOR_USER_ID=<id> npx tsx scripts/persona-wave2-activate.mts \
  --apply --limit=3 --reason "2차 확장 — planner 364조합 근거"
```

**네 개를 모두 요구한다.** 하나로 열리는 문은 실수로도 열린다.
`ACTOR_USER_ID` 는 환경변수로 받는다 — 셸 히스토리에 남기지 않기 위해서다.

- 🔴 `--limit` 은 정확히 **3** 이어야 한다 — 일부만 켜지 않는다
- 🔴 생성 · seed · 닉네임 · Account 0 을 전부 확인한 뒤에만 연다
- 세 명이 **하나의 트랜잭션**

🔴 **켠다고 말이 나가지 않는다.** 3층 분리(§7-2) 중 `status` 층만 만진다.
발행은 `auto-publish` 러너가 스케줄에 따라 하루 1건 한다.

## §6 롤백

트랜잭션이므로 중간 실패는 자동 롤백된다. 커밋 후 되돌리려면 `onDelete: Restrict` 때문에
순서가 강제된다 — `PersonaAuditLog` → `Persona` → `User`.
활성화만 되돌리려면 `status` 를 `draft` 로 내리고 `PersonaAuditLog` 에 남긴다.

## §7 예상 수치

| | 지금 | ① 생성 후 | ② seed 후 | ④ 활성화 후 |
|---|---|---|---|---|
| User | 9 | **12** | 12 | 12 |
| Persona | 5 (active 5) | **8** (draft 3) | 8 | 8 (**active 8**) |
| PersonaAuditLog | 25 | **31** | **34** | **37** |
| Post · Comment · Queue · ActivityLog | 40 · 26 · 24 · 6 | **불변** | **불변** | **불변** |

## §8 fixture

`npx tsx scripts/persona-wave2-check.mts` — DB 0 · 네트워크 0.
대상 고정 · 단계 판정 · **순서 위반 fail-closed** · 실행 게이트 4중 · 스크립트 계약을 본다.
