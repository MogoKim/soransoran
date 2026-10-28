# Persona 확장 runbook — 30 → 40 → 60 → 300

> 분류: `RUNBOOK` ([`D100-DOCUMENT-INVENTORY.md`](./D100-DOCUMENT-INVENTORY.md) §4). 권위 순서는 [`README.md`](./README.md)를 따른다.
> 이 문서는 **절차**만 적는다. 단계를 언제 열지는 [`CURRENT-MILESTONE.md`](./CURRENT-MILESTONE.md)와
> D100 canon이 정하고, 목표 인원은 `src/lib/d100-capacity.ts`의 `PERSONA_CANARY_FLOOR` ·
> `PERSONA_SUSTAINED_TARGET`이 정한다. 여기에 숫자를 다시 정하지 않는다.

## 0. 이 절차가 하지 않는 것

- 게시 상한 · 슬롯 · 하루 공개 글 수를 Persona 수로 계산하지 않는다. 그것은 단계 계획과 preflight다.
- 판정 도구(`persona:expansion`)는 DB에 쓰지 않는다. `--apply`를 받으면 거부한다.
- 신규 후보는 검증 전에는 `PROPOSED_COHORTS`에만 둔다. wave6-d20-canary는 카드·cohort 승격 PR에 올라갔지만,
  그 PR만으로 운영 DB 행을 만들거나 활성화하지 않는다.
- 기존 30명을 고치거나 지우지 않는다. wave6가 코드에 있어도 적재·활성화 전 운영 active는 30명이다.

> 2026-10-15 준비 상태: 말투 스냅샷 10묶음은 운영 호스트에 동결했고, P34~P43은 당시 운영 DB read-only
> 판정에서 ready 10/10 · creative PASS · 집단 다양성 OK였다. 2026-10-16 이름 정책 이후 fixture 표시명은
> 섞인 분포로 다시 준비했다(`d10:prep-check` 안의 `persona-nickname-policy-check` ⑫⑬⑭⑮). 이는 **코드·fixture 준비(candidate-ready)**일 뿐
> 운영 이름 준비가 아니다. 이름 축은 §2.1의 read-only live B1/B3/within-cohort 대조가 create 전에 PASS하고
> activate 전에 다시 PASS할 때까지 qualification-pending이다. 운영 DB 생성·seed·활성화는 여전히 0이며,
> 아래 4~7단계는 아직 실행하지 않는다.

## 1. 명령

| 명령 | 하는 일 | 쓰기 |
|---|---|---|
| `npm run persona:expansion -- --fixture=<후보.json>` | 정본 카드 · 정본 말투 자산 · fixture로 자원 · 단계 · 후보를 판정 | 0 |
| `npm run persona:expansion -- --db --fixture=<후보.json>` | 위 + 운영 DB read-only: 계약 유효 · 4상태 · 활동 집중도 · Gate ⑥-B 실제 대조 · cadence | 0 |
| `npm run persona:expansion -- --db --voice-evidence --fixture=<후보.json>` | 위 + 익명 보충 말투 증거로 새 cohort 묶음 가능 여부 판정 | 0 |
| `npm run persona:reference-supplement-build -- --db` | 기존 30명 불변을 확인하고 새 cohort 말투 스냅샷 계획·digest 출력 | 0 |
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

### 2.1 확장 cohort 표시명 gate

기존 30명은 공개 정체성이므로 일괄 변경하지 않는다. 아직 운영 DB에 만들지 않은 후보 cohort는 아래 순서를
모두 통과해야 이름 축이 `ready`다.

1. **집계 분포만 정책 입력이다.** 목표 고객 크롤에서 관측한 길이 band, 한글/숫자/영문 구성, 단어 수,
   받침·반복·숫자 꼬리 같은 리듬 특징의 **집계**만 합성 정책에 반영한다. 원문 작성자·회원 이름은 복사·변형·
   저장·로그 출력하지 않고 후보 생성 입력으로도 쓰지 않는다. 이름 빈도표와 원문 이름 목록은 Git·DB·로그·LLM
   입력에 남기지 않는다.
2. **섞인 분포로 합성한다.** 한 가지 감성어·계절어·자연물 조합에 몰리지 않게 후보를 만든다. 형식은 한글만(H)·
   한글+숫자(HD)·영문만(L)·영문+숫자(LD) 넷이며(한글+영문 혼합 금지) 닫힌 합성 목록에서만 고른다. 허용 문자는 완성형 한글·영문·숫자,
   길이 2~10자다. 10명 묶음은 갈래 3종 이상(fixture 증거)·한 갈래 ≤4·영문 포함 2~4·숫자 포함 2~4·시적 명사 ≤2·
   한 길이 ≤5·반복 리듬 ≤3·유의어 1이다. 런타임 배정은 상한만 강제하고 live 충돌 시 전원 실패한다
   (`persona-nickname-policy-check` ⑫⑬⑮⑯가 잠근다).
3. **원작가 대조 gate는 없다.** #641이 수집 원작가 정체를 인제스트와 Persona 이름 gate에서 의도적으로 제거했다.
   새 행은 작성자 정체를 남기지 않고, 과거 해시 체인으로는 정체·근접 충돌을 증명할 수 없다. 복사 금지는 구조로
   증명한다 — source author는 후보 생성·배정에 들어갈 수 없다(`npm run persona:source-author-check` +
   `npm run persona:gate6b-check`). 별도 임시 작성자 파이프라인을 만들지 않는다. 외부 비회원 작성자와 합성 공개
   단어가 우연히 겹칠 잔여 가능성은 받아들이며, 결과를 "크롤 작성자 충돌 0"이라 쓰지 않는다.
4. **라이브 충돌 대조를 통과한다(read-only).** 현재 회원(B1), 비활성·폐기로 남은 정체성까지 포함한 모든 기존
   Persona(B3), 같은 신규 cohort 안에서 exact와 일반 사용자가 같은 사람으로 오인할 near-collision을 모두
   거절한다. 운영 DB create 전에 한 번, create 트랜잭션·활성화 순서 안에서 다시 반복한다. 후보를 만든 뒤 회원이
   늘 수 있다. 결과에는 코드·개수·사유만 남긴다.
5. **이름만으로 용량을 올리지 않는다.** 표시명 PASS 뒤에도 말투 근거·생활사·no-go·글/댓글 자격·cadence가
   모두 PASS여야 contract-valid로 센다.

현재 P34~P43 fixture의 표시명은 2026-10-16 이전의 자연물·계절어 후보가 아니라, 섞인 분포로 다시 만들고
빈 충돌 집합의 기본 배정과 일치시킨 **candidate-ready 입력**이다. 이는 코드·fixture 준비일 뿐 운영 이름 준비가
아니다. 운영 이름 준비는 위 4번의 live B1/B3/within-cohort 대조가 create 전에 PASS하고 activate 전에 다시 PASS한
뒤에만 말한다. 활성화·배포·DB 준비를 주장하지 않으며, 운영 DB 행은 0이다. 생활사 카드·말투 digest를 이름 보정의
핑계로 함께 바꾸지 않는다.

## 3. 단계별 활성화 방법

각 단계는 앞 단계가 운영 증거로 닫힌 뒤에만 연다. **판정 도구가 `✅ 자원 준비`를 내도 켜도 된다는 뜻이 아니다** —
여는 결정은 CURRENT-MILESTONE이 정한다.

### 3.1 d20-canary (계약 유효 40)

선행 조건

1. CURRENT-MILESTONE이 Persona 증원을 허용한다(지금은 D10 전 증원 금지).
2. `persona:expansion -- --db --fixture=scripts/__fixtures__/persona-expansion-canary.json`에서
   `d20-canary`가 `✅ 자원 준비`이고 canary 10명이 전원 `ready`,
   creative 품질 `PASS`, 집단 다양성 `OK`다.
   말투 화자가 모자라면 정본 말투 자산을 다시 만든다(`persona:reference-build-asset`).
   근거 기준(관측 3 · 안전 원문 2)은 낮추지 않는다.
3. §2.1 표시명 gate가 집계 분포 정책·섞인 분포 fixture·read-only live B1/B3/within-cohort 대조를 모두 PASS한다.
   fixture는 candidate-ready일 뿐이므로 live PASS 없이는 create로 가지 않고, activate 전에 다시 PASS해야 한다.
   2026-10-15의 이름 후보는 이 gate 이전 산출물이므로 쓰지 않는다.

순서 — 각 단계는 앞 단계의 출력을 확인한 뒤에 한다

1. **말투 스냅샷** — `persona:expansion -- --db --voice-evidence`에서 10명 전원이 ready면
   `persona:reference-supplement-build -- --db` dry-run의 digest를 승인한 뒤, 병합된 깨끗한 main runtime에서만
   `--apply --production --target=<SHA> --digest=<64자리> --reason=<사유>`로 기록한다. 이 파일은
   `persona-reference/supplement-v1.json`에 0600으로 남고, 기존 30명 배정 digest가 다르면 쓰지 않는다.
2. **카드 승격 커밋** — fixture 후보를 Pool 문서 §5 카드 블록으로 옮긴다(`renderPoolCardBlock` 형식).
   말투 토큰은 그때 배정된 화자 묶음으로 정한다. `persona:autogen-check` · `persona:expansion-check`가 통과해야 한다.
3. **cohort 승격 커밋** — 같은 PR에서 한 번에 바꾼다.
   `COHORTS`에 `wave6-d20-canary` 추가 · `RUNNABLE_COHORTS`를 그 하나로 · `TARGET_PERSONA_COUNT` 40 ·
   `PROPOSED_COHORTS`에서 제거. 이 순간 운영 universe가 바뀐다 —
   `persona:reference-preflight`로 **기존 30명의 말투 배정 변동 0**을 확인한다(변동이 있으면 승격하지 않는다).
4. **seed 파일** — §2.1을 통과한 표시명을 포함해
   `persona:cohort-seed --cohort=wave6-d20-canary --creative=<fixture에서 뽑은 creative 파일> --expect-sha=<sha256>`
   dry-run 뒤 `--write`. 파일은 `tmp/` (gitignored).
5. **draft 적재** — 표시명은 fixture에서만 뽑는다. fixture `displayName`은 빈 충돌 집합의 기본 배정과 같아야 한다
   (`persona-nickname-policy-check` ⑭가 잠근다). 먼저 read-only live 대조
   `persona:expansion -- --db --fixture=scripts/__fixtures__/persona-expansion-canary.json`에서 10명 전원 이름 충돌 0을
   확인한다. 그 뒤에만 fixture의 `{코드: displayName}` 10개로 `tmp/persona-wave6-d20-canary-displayname.json`을 만든다.
   하나라도 막히면 파일을 만들지 않고 fixture·기본 배정을 함께 고친다. 파일이 있으면 `persona:cohort-run`이 그것을 쓰고,
   트랜잭션 안에서 Gate ⑥-B를 다시 판정한다.
   `persona:cohort-run --cohort=wave6-d20-canary --step=create --apply --limit=10`
   → `--step=seed --apply --limit=10` → `--step=check`. 운영 DB write이므로 창업자 승인 뒤에만 한다.
6. **활성화** — `ACTOR_USER_ID=<id> persona:cohort-run --cohort=wave6-d20-canary --step=activate --apply --limit=10 --reason "..."`.
   일부만 켜지 않는다(전원 아니면 0).
7. **관측** — `persona:expansion -- --db`의 계약 유효가 40이고, 다음 자연 회차에서 새 10명이 배정 후보에 들어오는지
   본다. 문제가 있으면 `--step=pause`(actor·reason 필요)로 멈춘다.

### 3.2 d20-sustained (계약 유효 60)

3.1이 운영 증거로 닫힌 뒤. 3.1과 같은 순서로 진행한다.

- **코드 공간** — #712에서 숫자순 정본과 P999 단일 상한을 적용했다. 추가 형식 해제 작업은 없다.
- **이름 공간** — #712의 합성 공간에서 Gate ⑥-B로 서로 헷갈리지 않는 남은 이름이 필요 수 이상이어야 한다.
- **말투 화자** — 필요 수 이상.

### 3.3 D30·D50 reserve

D20 canary가 운영 증거로 닫히면 D20 지속 → D30 canary/지속 → D50 canary/지속 순서로 reserve를 미리 만든다.
목표 수는 이 문서에 복제하지 않고 `PERSONA_CANARY_FLOOR`와 `PERSONA_SUSTAINED_TARGET`에서 읽는다.

- 다음 자연 단계를 기다리는 동안 필요한 인원만 새 cohort로 설계·자격 검증해 contract-valid reserve로 둔다.
- 아직 필요하지 않은 reserve를 stage-active로 미리 올리지 않는다.
- 각 cohort는 §2.1 이름 gate와 §3.1의 말투·카드·seed·전체 활성화 절차를 그대로 반복한다.
- 한 단계의 활동 집중도·매칭 실패·말투 충돌이 나빠지면 다음 cohort 구성에서 부족한 축을 먼저 보강한다.
- D30과 D50을 건너뛰어 D100 cohort를 한 번에 활성화하지 않는다.

### 3.4 d100-sustained (계약 유효 300 이상)

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
