# Persona 나이·세대 관점 — 글쓴이가 몇 살인지 생성과 검수가 함께 본다

> 📜 **역사 진단 — 현재 정책·상태 정본이 아니다.** 현재 권위와 상태는
> [`README.md`](./README.md)가 가리키는 네 문서와 main/runtime 실측이 정한다.
> 아래는 당시 동작과 한계, 고친 것과 못 고친 것을 보존한다.

## 1. 실제 결함

| 항목 | 값 |
|---|---|
| 공개 Post | `cmu0sjyll000142oincdg3d3j` (2026-09-14 14:17 KST) |
| Queue 후보 | `cmu0ov5b300052y8tjgjejpon` |
| 원천 | `34998885` |
| 생성·최종 Persona | **P03 — 40대 후반** |
| 발행 문장 | `우리 언니가 요즘 그 나이대에 결혼 준비 중이거든` (원문 맥락상 30~32세) |
| 검수 결과 | `lifeConflict = false` — **통과** |

40대 후반의 **언니**가 30대 초반일 수는 없다. 없는 관계를 지어낸 것이다.

🔴 **본문에 숫자가 없다.** "그 나이대" 는 앞 맥락(원문의 30~32)을 받는 지시어다 —
정규식·낱말 목록으로는 잡히지 않는 모양이다.

## 2. 왜 통과했나 — 구조적 원인

```
Pool 카드 정본 (ageBand 있음)
        │
        ▼  cardToPersona(card)         🔴 as PersonaForMatch 캐스트 — ageBand 를 안 실었다
   PersonaForMatch                        (필드를 빠뜨려도 typecheck 가 잡지 않는다)
        │
        ▼  planVoicePersonas → lifeOf
   PersonaLifeHistory                  🔴 타입에 ageBand 자체가 없었다
        │                                 혼인 · 자녀 · 돌봄 · 갱년기 **넷뿐**
        ▼  lifeHistoryLines
   생성 프롬프트 / 검수 프롬프트         🔴 둘 다 글쓴이가 몇 살인지 **보지 못했다**
```

과거 `draft-gen-v3` 는 `우리 딸 또래` · `요즘 젊은 세대` 로 자연스럽게 전환했는데,
`draft-gen-v5` 는 같은 소재에서 **`우리 언니` 라는 거짓 관계**를 만들었다.
막을 수 있는 자리가 없었던 것이 아니라, **그 자리에 나이가 전달되지 않았다.**

## 3. 고친 것

| # | 무엇 | 어디 |
|---|---|---|
| ① | `PersonaForMatch` 에 `ageBand` 추가 — 기존 정본 타입 하나에만 | `original-post-persona-match.ts` |
| ② | `cardToPersona` 가 `card.ageBand` 를 실어 보낸다 | `persona-pool-card.ts` |
| ③ | `PersonaLifeHistory` 에 `ageBand` 추가 | `micro-seed-auto-draft.ts` |
| ④ | `lifeHistoryLines` **맨 앞줄**이 나이대 — 생성·검수가 같은 줄을 본다 | `micro-seed-auto-draft.ts` |
| ⑤ | 러너 `lifeOf` 가 정본 카드의 `ageBand` 를 그대로 옮긴다 | `micro-seed-auto-draft.mts` |
| ⑥ | 생성 프롬프트: 나올 수 없는 가족 관계 금지 + **허용 목록 명시** | `micro-seed-auto-draft.mts` |
| ⑦ | 🔴 **짧고 집중된 나이 검수 호출**을 따로 둔다 — 큰 품질 프롬프트는 그대로 | `buildAgeCheckSystemPrompt` |
| ⑧ | 그 답을 **기존 `lifeConflict` 칸**으로 합친다 — 새 축이 아니다 | `mergeLifeConflict` |
| ⑨ | 재생성 지시: 소재를 버리지 않고 **세대를 옮긴다** | `micro-seed-auto-draft.mts` |
| ⑩ | 🔴 `ageBand` 없는 Persona 는 **provider 호출 전에 HOLD** | `loadVoice` · `personaAgeBandMissing` |
| ⑪ | 🔴 `cardToPersona` 의 `as PersonaForMatch` **캐스트 제거** — 누락을 typecheck 가 잡는다 | `persona-pool-card.ts` |
| ⑫ | 판 값 `draft-gen-v6` · `draft-quality-v5` — 옛 캐시를 재사용하지 않는다 | `micro-seed-auto-draft.ts` |

🔴 **새 Persona 복제본도, 수동 연령 상수도 만들지 않았다.** Pool 카드와 운영 Persona 가
이미 쓰는 `ageBand` 하나를 그대로 옮긴다.

🔴 **새 차단 축도, 사람 관계 낱말 목록·정규식도 만들지 않았다.**
`DRAFT_QUALITY_AXES` 는 6개 그대로이고, 판정은 기존 `lifeConflict` 축 하나가 한다.
집중 호출은 **그 칸에 답을 보태는 것**이지 새 축을 세우는 것이 아니다.

## 4. 🔴 규제하지 않는 것 — 프롬프트가 명시로 열어 둔다

| 허용 | 상태 |
|---|---|
| 40~60대 Persona 가 **30대 결혼을 일반적으로** 이야기 | 🟢 |
| 자녀 세대 · 조카 · 후배 · 주변 사례 | 🟢 |
| 실제로 가능한 연상·연하 가족 관계 (언니가 쉰 넷) | 🟢 |
| 나이를 말하지 않은 가족 이야기 — **모르면 어긋난 것이 아니다** | 🟢 |
| 반말 · 혼합 말투 | 🟢 |
| 결혼 · 갈등 · 연예 · 방송 · 건강 소재 | 🟢 |

막는 것은 하나뿐이다 — **1인칭 가족 관계 + 글 안에 적힌 나이 + 그 관계에서 불가능한 조합.**
①이나 ②가 없으면 `conflict=false` 다. 추측해서 세지 않는다.

## 5. 🔴 실측 — 나이 모순을 잡는 모델이 **없다**

### 5-a 먼저 한 일 — 큰 검수에 절차를 덧붙였다가 **되돌렸다**

`claude-haiku-4.5` 로 실측 결함을 2번 물었다(기준만 적었을 때 · 세는 순서를 적었을 때).
**2/2 모두 통과**시켰다. 프롬프트가 길어질수록 뒤에 붙인 지시는 묻히고 토큰만 늘었다.

🔴 그래서 **큰 품질 프롬프트에서 나이 절차를 뺐다.** 대신 나이·가족·세대만 보는
**짧고 집중된 호출 하나**(`buildAgeCheckSystemPrompt`)를 따로 두고,
답은 **새 축이 아니라 기존 `lifeConflict` 칸**으로 합친다(`mergeLifeConflict`).

### 5-b 세 모델을 같은 경계에 걸었다 — 합격 0

합격선: **결함 3/3 검출 + 허용 3/3 통과** · provider 18회 · DB write 0

| 모델 | 결함 | 허용 | 판정 | 토큰 (in/out) |
|---|---|---|---|---|
| `claude-haiku-4.5` | **1 / 3** | 3 / 3 | 🔴 탈락 | 5,875 / 569 |
| `gpt-5-mini` | **0 / 3** | 3 / 3 | 🔴 탈락 | 3,697 / 1,032 |
| `gemini-3.7-flash` | **2 / 3** | 3 / 3 | 🔴 탈락 (가장 나음) | 3,481 / **99** |

**세 모델이 공통으로 놓친 것은 실측 결함 그 자체다** —
`우리 언니가 요즘 그 나이대에 결혼 준비 중` (나이는 제목의 `30 32` 를 받는 **지시어**).
`D2 엄마가 예순 하나` 는 gemini 만, `D3 딸이 마흔여덟` 은 haiku·gemini 가 잡았다.

🔴 **허용 경계는 세 모델 전부 3/3 통과했다** — 과차단은 없다.

### 5-c 결론 — 프롬프트를 더 덧붙이지 않고 **발행 경로에서 막는다**

> 🔴 **기계 생성 글은 자동 발행 전 사람 확인이 필요하다.**

🔴 **상수를 두고 읽지 않으면 아무것도 막지 못한다.** 앞선 판이 그랬다 —
`MACHINE_AGE_HUMAN_REVIEW_REQUIRED=true` 가 **로그에만** 찍히고 `selectAutoTargets` 는
그 값을 보지 않아, 사람이 확인하지 않은 기계 글 **41건이 그대로 자동 발행 대상**이었다(실측).

이제 발행 판정이 그 값을 **실제로 읽는다.**

| 조건 | 자동 발행 대상인가 |
|---|---|
| `profile=machine` + `decidedBy=founder` | 🟢 **된다** |
| `profile=machine` + `machine:*` · `null` · 모르는 값 | 🔴 `HUMAN_REVIEW_REQUIRED` 로 제외 |
| `profile=human` | 🟢 **기존 동작 그대로** (decidedBy 와 무관) |

🔴 **새 DB 컬럼도 migration 도 만들지 않았다.** 큐에 이미 있는 `decidedBy` 하나를 쓴다.
🔴 **자동 보충기는 계속 `machine:auto-draft-*` 를 찍는다** — 자동 경로가 `founder` 를 찍는
우회는 fixture 가 금지한다.

### 사람 검토 경로 — `npm run publish:machine-review`

| | |
|---|---|
| 기본 | **read-only · DB write 0** — 후보 id · 제목 · 본문 · 생성 voice Persona · ageBand 표시 |
| 검토 완료 | `--id <id> --apply --limit=1` 셋을 **다 붙였을 때만** |
| 바꾸는 것 | **`decidedBy` · `decidedAt` 두 칸뿐.** status·본문·gateResults·Post·Comment·Persona 미변경 |
| 거부 | Persona·ageBand 근거가 없으면 **검토 완료 자체를 거부한다** — 나이를 모르는데 "봤다"고 적지 않는다 |
| 안전 | **낙관적 잠금** 조건부 UPDATE · read-back 스냅샷 대조 · provider 호출 0 |

#### 🔴 검토 시각 정합 (2026-09-14)

앞선 판은 `decidedBy` 만 바꿔서 **"누가"는 사람인데 "언제"는 기계가 적재한 시각**으로 남았다 —
거짓 기록이다. 이제 `decidedAt` 을 **실제 검토 완료 시각**으로 함께 쓴다.

🔴 `queueOrderKey` 가 `decidedAt` 으로 줄을 세우므로, 자동 발행 순서가 자동으로
**실제 사람 검토 순서**가 된다. 기계 적재가 오래됐다고 먼저 나가지 않는다.

#### 🔴 검토 대상 스냅샷 보호

사람이 읽고 나서 `founder` 를 붙이기까지 시간이 흐른다. 그 사이에 본문이 바뀌었으면
그 표시는 **읽지 않은 글에 찍은 도장**이다.

| 단계 | 무엇 |
|---|---|
| 조회 | `updatedAt` 을 함께 읽어 스냅샷으로 남긴다 |
| UPDATE where | `id` · 읽었을 때의 `status` · `createdPostId: null` · 읽었을 때의 `decidedBy` · 읽었을 때의 `updatedAt` |
| 하나라도 바뀌면 | **0건 → 멈춘다.** 아무것도 쓰지 않는다 |
| read-back | 발행 문안(`edited ?? draft`) · `gateResults` · `promptVersion` · `model` · `status` 를 `judgeReviewSnapshot` 으로 대조 |

🔴 `decidedBy` · `decidedAt` 은 대조에 넣지 않는다 — **바뀌라고 쓴 칸**이다.

## 5-d 🟢 생성 경로는 실제로 바뀌었다 — `draft-gen-v6` fresh 실측

원천 `34998885`(`연애2년 여자 30 남자 32 결혼하면 늦은건가요?`) + P03(40대 후반) ·
**no-cache · provider 1회**

| | 결과 |
|---|---|
| 초안 1 | `우리 애들 또래 친구들 중에도 삼십 몇에 가는 사람 꽤 있거든` — **자녀 세대 관점** |
| 초안 2 | `우리 주변에도 그런 또래들이 꽤 있더라` — **주변 관찰 관점** |
| 1인칭 가족(`우리 언니` 류) | **0건** |

🔴 **소재를 버리지 않았다.** 두 초안 모두 30·32 결혼이라는 소재를 그대로 쓰고
**자리만 옮겼다** — v3 이 하던 것이고, v5 가 못 하던 것이다.

## 6. 영향 범위 — 발행 대기 후보 감사 (read-only · DB write 0)

`gemini-3.7-flash`(비교에서 가장 나은 모델) · 배치 15건 · **provider 3회**

```
대기열(APPROVED/EDITED · 미발행)   106건

수정 전  selectAutoTargets 통과 44건 = machine 41 + human 3
         🔴 machine 41건 **전부** decidedBy ≠ founder — 사람 미확인인데 자동 발행 대상

수정 후  selectAutoTargets 통과  3건 = human 3
         제외  PROFILE 59 · HUMAN_REVIEW_REQUIRED 41 · GATE 3
         다음에 나갈 1건: human · decidedBy=founder

사람 검토 대기 (machine profile)   41건
  검토 가능 (Persona·ageBand 있음)  41건
  🔴 근거 없어 검토 불가              0건

🔴 v3 시절 57건은 이 변경 **이전부터** `PROFILE` 로 제외돼 있었다 —
   자동 발행 대상이 된 적이 없다. 감사(나이 관점)는 여전히 불가능하다.

근거 확인된 명백한 연령·세대 모순   0건 / 감사 41건
```

🔴 **"0건" 을 안전으로 읽지 않는다.** 두 가지 이유다.

1. **감사한 모델이 실측 결함을 놓친 모델이다**(D1 미검출). 가장 어려운 부류 —
   지시어로 나이를 받는 경우 — 는 **구조적으로 놓친다.** 0 은 하한이다.
2. **다음 발행 순서 10건은 아예 감사할 수 없다.** 생성 Persona 가 기록되지 않은
   옛 후보(`draft-gen-v3` 시절)라 글쓴이 나이를 알 방법이 없다.

생성 프롬프트 판별:

```
  draft-gen-v3    57건   🔴 나이대를 보지 못한 판 · 🔴 Persona 미기록이라 감사도 불가
  draft-gen-v5    41건   🔴 나이대를 보지 못한 판 (Persona 기록은 있다)
  draft-gen-v6     0건
```

🔴 이 PR 은 기존 후보를 **지우거나 HOLD 하거나 다시 만들지 않는다. Queue 를 바꾸지 않는다.**
어떻게 할지는 창업자 결정이다.

## 7. 🔴 판 값 변경의 공급 쪽 여파

`MACHINE_PROFILE.envelopePromptVersion = DRAFT_PROMPT_VERSION` 이다.
`draft-gen-v6` 로 올리면 **이미 만들어진 v5 후보 파일 28개**가 `PROFILE` 로 제외된다 —
새 재고 적재는 다음 draft 회차가 v6 파일을 낼 때까지 0 이다.

🟢 **이미 큐에 들어간 98건은 영향받지 않는다** — 큐 행의 `promptVersion` 은
`publish-candidate-auto-v1` 이고 그 값은 바꾸지 않았다.

## 8. 검증

```bash
npm run micro-seed:auto-draft-check   # 409 pass · 0 fail
npm run typecheck · lint · build · check:tokens
```

**결함 재주입 — fixture 가 실제로 잡는가**

| 재주입 | 결과 |
|---|---|
| `cardToPersona` 에서 `ageBand` 제거 | ❌ 2 fail |
| `lifeHistoryLines` 에서 나이대 줄 제거 | ❌ 6 fail |
| 판 값을 `draft-gen-v5` · `draft-quality-v4` 로 되돌림 (옛 캐시) | ❌ 1 fail |
| **ageBand HOLD 제거** (나이 없는 Persona 도 생성 후보로) | ❌ 1 fail |
| **집중 나이 검수 호출 제거** | ❌ 1 fail |
| **`as PersonaForMatch` 캐스트 복원** (누락 은폐) | ❌ 1 fail |
| 전부 복원 | ✅ **409 pass · 0 fail** |

## 9. provider 사용 — 총 22회 / 상한 30

| 무엇 | 호출 | 모델 |
|---|---|---|
| `draft-gen-v6` fresh 생성 | 1 | claude-haiku-4.5 |
| 모델 비교 (3 모델 × 6 사례) | 18 | haiku · gpt-5-mini · gemini |
| 발행 대기 98건 감사 (배치 15) | 3 | gemini-3.7-flash |

DB write 0 · Queue 변경 0 · 파일 write 0 · 공개 발행 0.
