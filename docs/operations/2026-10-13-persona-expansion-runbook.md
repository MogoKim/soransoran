# Persona 확장 runbook — 30 → 40 → 60 → 300

> 분류: `RUNBOOK` ([`D100-DOCUMENT-INVENTORY.md`](./D100-DOCUMENT-INVENTORY.md) §4). 권위 순서는 [`README.md`](./README.md)를 따른다.
> 이 문서는 **절차**만 적는다. 단계를 언제 열지는 [`CURRENT-MILESTONE.md`](./CURRENT-MILESTONE.md)와
> D100 canon이 정하고, 목표 인원은 `src/lib/d100-capacity.ts`의 `PERSONA_CANARY_FLOOR` ·
> `PERSONA_SUSTAINED_TARGET`이 정한다. 여기에 숫자를 다시 정하지 않는다.

## 0. 이 절차가 하지 않는 것

- 게시 상한 · 슬롯 · 하루 공개 글 수를 Persona 수로 계산하지 않는다. 그것은 단계 계획과 preflight다.
- 판정 도구(`persona:expansion`)는 DB에 쓰지 않는다. `--apply`를 받으면 거부한다.
- 신규 후보는 `PROPOSED_COHORTS`(제안)에만 있다. `COHORTS`에 없으므로 운영 universe·말투 배정·runtime은 그대로다.
- 현재 30명을 고치거나 지우지 않는다.

## 1. 명령

| 명령 | 하는 일 | 쓰기 |
|---|---|---|
| `npm run persona:expansion` | 정본 카드 · 정본 말투 자산 · fixture로 자원 · 단계 · canary 후보를 판정 | 0 |
| `npm run persona:expansion -- --db` | 위 + 운영 DB read-only: 계약 유효 · 4상태 · 활동 집중도 · Gate ⑥-B 실제 대조 · cadence | 0 |
| `npm run persona:expansion-check` | 계약 fixture(변이 반례 포함). DB · 네트워크 · LLM 0 | 0 |

`--db`는 `.env.local`의 DB 접속만 쓴다. 출력에는 코드 · 개수 · 사유 코드만 나오고 회원 이름은 나오지 않는다.

## 2. 판정이 보는 것

| 층 | 판정 | 정본 함수 |
|---|---|---|
| 사람 하나 | 카드 형식 · seed · 4상태 계약 축 · 글/댓글 자격 · 실회원 · 성격·관점·noGo 겹침 · 문체 거리 | `judgeAutogenBatch` (운영 검증기 그대로) |
| 사람 하나 | 닉네임 정책 · Gate ⑥-B(회원 · 기존 Persona · 묶음 안) · 연령 대상 범위 · 생활사 모순 · 관심사↔noGo · 관심사↔생활사 · 게시판(매거진·베스트 금지) · 브랜드 금지어 · 공통 금지 문구 | `judgeCandidateConflicts` |
| 묶음 | 제목 · 변주 · 고유 대화 행동 · 자기모순 · 생활사 사실 | `judgeCreativeQuality` |
| 집단 | 축 쏠림(나빠질 때만) · 묶음 단일 품종 · 성격어 남용 · 50대 최다 · 생활사 7칸 복제 | `judgePopulationDiversity` |
| 자원 | 계약 유효 수 · 남은 말투 화자 · 남은 이름 · 남은 코드 | `planExpansionStep` · `PERSONA_CODE_MAX` · `nicknameSpace` |

후보 상태는 셋이다. `ready`는 전부 통과, `blocked`는 막힘이 하나 이상, `unmeasured`는 막힘 없이 모름만 있다.
모름은 통과가 아니다.

## 3. 단계별 활성화 방법

각 단계는 앞 단계가 운영 증거로 닫힌 뒤에만 연다. **판정 도구가 `✅ 자원 준비`를 내도 켜도 된다는 뜻이 아니다** —
여는 결정은 CURRENT-MILESTONE이 정한다.

### 3.1 d20-canary (계약 유효 40)

선행 조건

1. CURRENT-MILESTONE이 Persona 증원을 허용한다(지금은 D10 전 증원 금지).
2. `persona:expansion -- --db`에서 `d20-canary`가 `✅ 자원 준비`이고 canary 10명이 전원 `ready`,
   creative 품질 `PASS`, 집단 다양성 `OK`다.
   말투 화자가 모자라면 정본 말투 자산을 다시 만든다(`persona:reference-build-asset`).
   근거 기준(관측 3 · 안전 원문 2)은 낮추지 않는다.

순서 — 각 단계는 앞 단계의 출력을 확인한 뒤에 한다

1. **카드 승격 커밋** — fixture 후보를 Pool 문서 §5 카드 블록으로 옮긴다(`renderPoolCardBlock` 형식).
   말투 토큰은 그때 배정된 화자 묶음으로 정한다. `persona:autogen-check` · `persona:expansion-check`가 통과해야 한다.
2. **cohort 승격 커밋** — 같은 PR에서 한 번에 바꾼다.
   `COHORTS`에 `wave6-d20-canary` 추가 · `RUNNABLE_COHORTS`를 그 하나로 · `TARGET_PERSONA_COUNT` 40 ·
   `PROPOSED_COHORTS`에서 제거. 이 순간 운영 universe가 바뀐다 —
   `persona:reference-preflight`로 **기존 30명의 말투 배정 변동 0**을 확인한다(변동이 있으면 승격하지 않는다).
3. **seed 파일** — `persona:cohort-seed --cohort=wave6-d20-canary --creative=<fixture에서 뽑은 creative 파일> --expect-sha=<sha256>`
   dry-run 뒤 `--write`. 파일은 `tmp/` (gitignored).
4. **draft 적재** — `persona:cohort-run --cohort=wave6-d20-canary --step=create --apply --limit=10`
   → `--step=seed --apply --limit=10` → `--step=check`. 운영 DB write이므로 창업자 승인 뒤에만 한다.
5. **활성화** — `ACTOR_USER_ID=<id> persona:cohort-run --cohort=wave6-d20-canary --step=activate --apply --limit=10 --reason "..."`.
   일부만 켜지 않는다(전원 아니면 0).
6. **관측** — `persona:expansion -- --db`의 계약 유효가 40이고, 다음 자연 회차에서 새 10명이 배정 후보에 들어오는지
   본다. 문제가 있으면 `--step=pause`(actor·reason 필요)로 멈춘다.

### 3.2 d20-sustained (계약 유효 60)

3.1이 운영 증거로 닫힌 뒤. 3.1과 같은 순서로 진행한다.

- **코드 공간** — #712에서 숫자순 정본과 P999 단일 상한을 적용했다. 추가 형식 해제 작업은 없다.
- **이름 공간** — #712의 합성 공간에서 Gate ⑥-B로 서로 헷갈리지 않는 남은 이름이 필요 수 이상이어야 한다.
- **말투 화자** — 필요 수 이상.

### 3.3 d100-sustained (계약 유효 300 이상)

D20 → D30 → D50 실측 뒤. 위에 더해 아래를 설계 결정으로 먼저 푼다(이 runbook이 정하지 않는다).

- **코드·이름 공간** — #712에서 P999 숫자순 정본과 300명 이상 합성 이름 공간을 적용했다. 더 이상 선행 blocker가 아니다.
- **말투 자산 규모** — 근거 화자 300명 이상.
- **문체 분리 기준** — `judgeAutogenBatch`의 기준은 운영 묶음끼리의 최소 거리라, Persona가 늘수록 기준이
  작아져 `VOICE_TOO_CLOSE`가 덜 잡힌다. 고정 기준선(예: 30명 시점 값)을 함께 보는 판정이 필요하다.

## 4. 📜 작성 당시 스냅샷 (2026-10-13 · 운영 DB read-only)

현재 상태 정본이 아니다. 다시 재려면 `npm run persona:expansion -- --db`.
#712 이후 코드·이름 공간은 아래 작성 당시 값이 아니라 §3.2~3.3의 정본을 따른다.

| 항목 | 값 |
|---|---|
| 운영 Persona | DB 30행 · active 30 · 계약 유효 30(stage-active 30) · active인데 계약 밖 0 |
| 7일 활동 | 글+댓글 63 · 글 32건을 19명이 씀(11명 0건 · 유효 인원 15.5 · Gini 0.52) · 댓글 31건을 29명(유효 27.5) |
| 30일 Persona 글 게시판 | 자유게시판 73 · 갱년기톡 0 |
| 말투 화자 | 근거 화자 32 · 운영 배정 30 · 남음 2 |
| 이름 공간 | 후보 합집합 236 · 회원·기존 Persona와 Gate ⑥-B pass이면서 서로 헷갈리지 않는 이름 33(canary 10 사용 뒤 23) |
| 코드 공간 | high-water P33(폐기 P31·P33 포함) · 현재 한계 P50 · 남음 17 |
| canary 10 (P34~P43) | ready 2(P34 · P35) · blocked 8(사유 `NO_VOICE_EVIDENCE` 하나뿐) · creative 품질 PASS · 집단 다양성 OK |
| 단계 판정 | d20-canary: 말투 화자 부족 · d20-sustained: 말투 · 코드 부족 · d100-sustained: 말투 · 이름 · 코드 부족 |
