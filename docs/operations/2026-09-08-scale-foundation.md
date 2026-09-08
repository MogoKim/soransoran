# 10/day Scale Foundation

> 선행: [Pool 설계](2026-08-30-persona-pool-design.md) · [Wave2 runbook](2026-09-08-persona-wave2-runbook.md) ·
> [lane 전략](2026-09-02-original-post-lane-strategy.md)
>
> 🔴 이 PR 은 **구조만** 만든다. 운영 DB write · 실제 발행 · env/launchd 활성화는 하지 않았다.
> 🔴 2026-09-08 개정 ① — 이전 판의 숫자 여러 개가 실측과 달랐다. §9 에 정정 내역을 남긴다.
> 🔴 2026-09-08 개정 ② — Codex 가 **생산 경로를 직접 실행해** P0 3건을 찾았다. §10 참조.
> 🔴 2026-09-08 개정 ③ — 2차 실행 검토에서 2건 더 나왔다. §11 참조.
>    수동 발행기가 준비도를 우회했고, supply-health 가 규모 확정 **전에** 판정하고 있었다.
>    요약: 감속이 표시만이었고, capacity/release 분리가 실동작하지 않았으며,
>    env 를 `loadEnvLocal()` 보다 **먼저** 읽어 `.env.local` 이 애초에 반영되지 않았다.

## §1 AS-IS (2026-09-08 실측)

```
발행    DAILY_PUBLISH_CAP 1 · 슬롯 1개(auto-publish.yml `5 15 * * *` = 00:05 KST)
persona POST_CAP_PER_WEEK 1 · MIN_DAYS_BETWEEN_POSTS 5 · active 8명
재고    STOCK_TARGET 14 · MIN 5 · WARN 3
수집    COLLECT_CAP 50 · COLLECT_MIN 10 · collectCapFor = min(50, max(10, 부족분 × 배수))
수집원  launchctl 실측 — remonterrace(09:20) · wgang(13:20) · supply-autopilot(21:10) 3개만 등록
        🔴 82cook 독립 job 은 **템플릿만 있고 launchctl 에 올라와 있지 않다**
Pool    20장 · DB 8명 · 남은 유효 11명 (P09 제외)
```

**현재 8명으로 1/day 14일 유지 — 7일 7건 · 14일 14건 · 공백 0일 ✅**

## §2 🔴 단일 정본 두 개 — 프로필과 런타임

규모를 올릴 때 다섯 곳(`DAILY_PUBLISH_CAP` · `STOCK_TARGET` · `POST_CAP_PER_WEEK` ·
`MIN_DAYS_BETWEEN_POSTS` · 수집 배수)을 손으로 맞춰 왔다. 한 곳만 바뀌는 날이 오면
관제는 초록인데 큐가 마른다. **하나에서 전부 파생한다.**

| 파일 | 역할 |
|---|---|
| `src/lib/scale-profile.ts` | 단계별 프로필·파생 계산. 🔴 **순수** — env·DB·시각 0 |
| `src/lib/scale-runtime.ts` | 🔴 **env 를 읽는 유일한 곳.** capacity ↔ release 를 나누고 감속한다 |
| `src/lib/scale-readiness.ts` | 🔴 시뮬레이션 결과로 준비도를 판정한다 (산술 아님) |
| `src/lib/scale-supply-plan.ts` | 내부 생산량 역산 · 수집원 능력 · 비용 |
| `src/lib/scale-workflow-render.ts` | 슬롯 → cron 렌더 · 워크플로우 대조 |

### 🔴 설정은 **주입**이다 — module-load 상수가 아니다

```
SORAN_CAPACITY_STAGE   준비된 능력 (내부 공급 기준)
SORAN_RELEASE_STAGE    실제 공개량
   둘 다 d1 | d3 | d5 | d10 · 🔴 못 읽으면 가장 안전한 d1 (fail-closed)
```

🔴 **ESM 은 정적 import 를 모듈 본문보다 먼저 평가한다.** 그래서 예전 판은
러너가 `await loadEnvLocal()` 로 `.env.local` 을 읽기 **전에** 상수를 굳혔다 —
설정은 반영되지 않는데 화면만 반영됐다고 말했다.

이제 이렇게 한다.

```
① 모듈 상수(DAILY_PUBLISH_CAP · STOCK_* · POST_CAP_PER_WEEK)
   = 🔴 **가장 안전한 d1 값**. 주입을 잊으면 여기로 떨어진다 (1건/day)
② 러너가 `await loadEnvLocal()` 뒤에 `installFromEnv(process.env, { readiness })` 로 설치
③ 쓰기 판정은 전부 **주입값**을 받는다
   judgePublish(c, { …, dailyCap })   publishOriginalPostTx(…, { dailyCap })
   planBatch(…, RELEASE_CAPS)          readStock(rows, capacityLimits)
```

**설정이 없으면 지금과 정확히 같다** — 실측 확인:

```
DAILY_PUBLISH_CAP 1 · POST_CAP_PER_WEEK 1 · MIN_DAYS_BETWEEN_POSTS 5
STOCK_TARGET 14 · STOCK_MIN 5 · STOCK_WARN 3      → 옛 하드코딩과 전부 동일 (회귀 0)
```

### 🔴 capacity 와 release 는 **서로 다른 프로필**을 만든다

한 프로필로 둘을 다루면 `capacity=d10 · release=d1` 에서 재고 목표가 14가 된다 —
그러면 "10/day 를 준비한다" 는 말이 거짓이 된다.

| | 무엇이 정한다 | `capacity=d10 · release=d1` 실측 |
|---|---|---|
| 내부 공급 | `capacityProfile` | 재고 목표 **140** · 최소 50 · 경고 30 |
| 공개 발행 | `releaseProfile` | 하루 **1**건 · 주 1건 · 최소 5일 · 슬롯 00:05 |

### 🔴 감속은 표시가 아니라 **강제**다

준비도 판정이 `releaseProfile` 을 실제로 낮춘다. 실측:

```
$ SORAN_CAPACITY_STAGE=d10 SORAN_RELEASE_STAGE=d10 npx tsx scripts/original-post-auto-publish.mts
③-c 규모 설정  capacity=d10(내부 10/day 기준) · release=d1(공개 1/day) · 요청 d10 에서 감속
     적용된 발행 상한  일 1건 · persona 주 1건 · 최소 5일
     🔴 준비도 미달로 감속됐다 — 이 값이 실제로 적용된다
```

이 값이 `judgeApply` · `publishOriginalPostTx` · `planBatch` 에 그대로 들어간다.
🔴 **준비도 감속은 공개 발행만 낮춘다.** 내부 재고를 함께 줄이면 영원히 준비되지 않는다.

## §3 규모 단계 — 🔴 판정은 산술이 아니라 시뮬레이션이 한다

| 단계 | 발행/day | 주 cap | 실효 | 간격 | 재고 | 산술 인원 | 슬롯(KST) |
|---|---|---|---|---|---|---|---|
| **d1** (적용 중) | 1 | 1 | 1 | 5일 | 14 | 7명 | 00:05 |
| d3 | 3 | 3 | 3 | 2일 | 42 | 7명 | 00:05 09:20 19:40 |
| d5 | 5 | 4 | 4 | 1일 | 70 | 9명 | 00:05 08:15 12:35 17:10 21:45 |
| **d10** (목표) | 10 | 5 | 5 | 1일 | 140 | 14명 | 00:05 07:20 09:10 11:35 13:25 15:50 17:15 19:40 21:05 22:30 |

### 🔴 산술 인원을 그대로 믿으면 안 된다

`ceil(목표 × 7 / 실효 주cap)` 은 **생활사 hardFilter 를 모른다.**
Pool 카드 19명(재고 140건 충분)으로 돌린 실측:

```
d10 · 산술 최소 14명   → 14일 129/140 · 공백 0일   🔴 11건 미달
d10 · 15명             → 133/140
d10 · 17명             → 138/140
d10 · Pool 전원 19명   → 139/140 · 공백 0일        🔴 여전히 1건 미달 — d10 은 아직 도달 불가
d5  · 11명 이상        → 70/70 · 공백 0일          ✅ READY
d3  · 8명 이상         → 42/42 · 공백 0일          ✅ READY
d1  · 8명(현재)        → 14/14 · 공백 0일          ✅ READY
```

**산술은 참고값이고, 판정은 14일 실측이 한다.** 화면에도 그렇게 적는다.

### 🔴 인원보다 조합이 먼저다

큐가 한 축으로 쏠리면 인원 수는 답이 아니다. 큐 140건을 전부 "중학생 아이" 이야기로 두면:

```
다양한 19명            → 40/140 · 공백 4일
축이 맞지 않는 19명    → 0/140 · 공백 14일     🔴 인원을 늘려도 0이다
축이 맞는 19명         → 140/140 · 공백 0일
```

### 🔴 준비되지 않으면 자동으로 내려간다

요청 단계가 not-ready 면 **ready 인 가장 높은 단계**로 감속한다. 아무 단계도 준비되지 않으면 d1 이다.
예: d5 는 11명이면 70/70 이지만 **한 명이 멈춰 10명이 되면 69/70** 이라 d3 로 내려간다.

### 슬롯은 분 단위다

시(hour) 정수 배열로는 지금 도는 **00:05 KST** 를 적을 수 없었다. `{hour, minute, count}` 로 바꿨다.
`slotCronUtc` 가 KST→UTC 로 옮긴다 — `00:05 KST` = `5 15 * * *`.

🔴 **프로필만 올리고 `auto-publish.yml` 을 그대로 두면 글은 안 나간다.**
`compareWorkflow` 가 그 어긋남을 잡고, `supply-health` 화면·JSON 에 "워크플로우 불일치" 로 뜬다.

## §4 내부 100/day 생산 설계

역산은 `src/lib/scale-supply-plan.ts` 하나뿐이다.

### 🔴 통과율은 근거에서 **계산한다**

예전 판은 `listToDetail: 0.05` 라 적어 두고 주석에는 1,147 → 10 이라고 썼다.
**1,147 → 10 은 0.87% 다.** 주석과 숫자가 6배 달랐고 그 위에서 100/day 를 계산했다.
이제 근거(`n / of`)만 적고 비율은 코드가 계산한다.

| 단계 | 근거 | 비율 | 출처 |
|---|---|---|---|
| listToDetail | 10 / 1,147 | **0.87%** | 2026-09-07 82cook 목록 수집 |
| detailToJudge | 12 / 16 | 75% | 2026-09-07 adapt→judge (4건은 deterministic) |
| judgePass | — | 50% | 🔴 **assumed** — 회차별 실측 미수집 |
| draftPass | — | 70% | 🔴 **assumed** — 회차별 실측 미수집 |

🔴 가정이 하나라도 있으면 `proven === false` 다. **이 숫자로 READY 라고 말하지 않는다.**

### 역산 결과

| 목표 | Queue/day | draft | judge | 상세(외부 요청) | 목록 | LLM/day |
|---|---|---|---|---|---|---|
| d1 (현재) | 1 | 2 | 4 | 6 | 689 | 6회 |
| d3 | 3 | 5 | 10 | 14 | 1,606 | 15회 |
| d5 | 5 | 8 | 16 | 22 | 2,524 | 24회 |
| d10 | 10 | 15 | 30 | 40 | 4,588 | 45회 |
| **내부 100** | 100 | 143 | 286 | **382** | **43,816** | **429회** |

### 🔴 현재 / 준비 / 필요 — 셋을 합치지 않는다

| 수집원 | 회차 상한 | 템플릿 회차 | launchctl | 현재 | 준비 | 100/day 단독 필요 회차 |
|---|---|---|---|---|---|---|
| 82cook | 30 | 10회 | 🔴 미등록 | 0 | 300 | 13회 |
| navercafe:remonterrace | 10 | 1회 (09:20) | 🟢 | 10 | 10 | 39회 |
| navercafe:wgang | 10 | 1회 (**13:20**) | 🟢 | 10 | 10 | 39회 |
| supply-autopilot | 50 | 1회 (21:10) | 🟢 | 50 | 50 | — |
| **합** | | | | **70/day** | **370/day** | |

### 🔴 병목 — 지금 설정으로 100/day 는 BLOCK

```
🔴 collect: 하루 382건을 읽어야 하는데 지금 열리는 것은 70건
🟡 source : 수집원 2/3 등록 — 미등록: 82cook
🟡 yield  : 통과율 실측 없음 (judgePass · draftPass)
```

82cook 독립 job 을 올리면 현재 능력이 70 → 370/day 가 되어 BLOCK 은 사라진다.
그것은 **남의 서버를 하루 300번 더 두드리는 일**이라 별도 승인 사항이다.

### 예상 비용 — 🔴 단가를 모르면 계산하지 않는다

`SORAN_LLM_COST_PER_JUDGE_USD` · `SORAN_LLM_COST_PER_DRAFT_USD` 가 없으면
비용을 **추정하지 않고** "단가 미설정" 이라고 적는다.
`SORAN_LLM_DAILY_BUDGET_USD` 를 주면 **예산이 허용하는 하루 Queue 상한**(안전 상한)을 낸다.

```
비용/day     = judge 286 × 단가 + draft 143 × 단가
안전 상한    = floor(하루 예산 ÷ Queue 1건당 비용)
```

### 🔴 수집 배수를 통과율에 연결했다

`collectCapFor` 는 `부족분 × 4` 라고 4 를 코드에 적어 두었다. 그 4 는 통과율의 역수인데
통과율이 바뀌어도 4 는 그대로였다. 이제 `ceil(1 / (detailToJudge × judgePass × draftPass))` 로 계산한다 —
**지금 값은 여전히 4 다(회귀 0).**

## §5 Persona cohort — `src/lib/persona-cohort.ts` + `scripts/persona-cohort-run.mts`

Wave 2 는 세 명을 스크립트에 못박았다. 안전했지만 회차마다 파일이 는다.
**manifest 를 버전으로 관리**하고 도구는 하나만 둔다.

| cohort | 인원 | 대상 | 상태 |
|---|---|---|---|
| `wave1-mvp` | 5 | P05 P07 P10 P15 P17 | 🔒 CLOSED |
| `wave2` | 3 | P01 P02 P11 | 🔒 CLOSED |
| **`wave3-scale`** | **11** | P03 P04 P06 P08 P12 P13 P14 P16 P18 P19 P20 | 🟢 RUNNABLE |

합 **19명** = Pool 20장 − P09.
🔴 **P09 제외 근거**는 코드(`EXCLUDED_CODES`)에 적혀 있다 —
*"Pool §7-1 길이 목록 어디에도 없고 카드 voiceCore 에도 길이 표현이 없다.
`readLengthBand` 가 읽지 못한다. 근거 없이 채우지 않는다."*

### 🔴 pause 는 비상 조치다 — 막히면 안 된다

`create` · `seed` · `activate` 는 실회원(Account) · seed 불완전을 **그대로 막는다.**
그러나 `pause` 는 다르다. 위험한 persona 를 멈추려는데 *"Account 가 붙어 있어서"* 막히면,
정확히 그 사람을 유통에서 뺄 수 없다. 그래서 pause 가 요구하는 것은 넷뿐이다 —
**대상 존재 · status=active · actor·reason · 조건부 write + audit.**

### 사용법

```bash
npx tsx scripts/persona-cohort-run.mts --cohort=wave3-scale --step=check      # read-only
npx tsx scripts/persona-cohort-run.mts --cohort=wave3-scale --step=create     # dry-run
npx tsx scripts/persona-cohort-run.mts --cohort=wave3-scale --step=create --apply --limit=11
npx tsx scripts/persona-cohort-run.mts --cohort=wave3-scale --step=seed   --apply --limit=11
ACTOR_USER_ID=<id> npx tsx scripts/persona-cohort-run.mts \
  --cohort=wave3-scale --step=activate --apply --limit=11 --reason "..."
```

### 🔴 안전 계약

| | |
|---|---|
| `--code` 를 받지 않는다 | 대상은 manifest 가 정한다. manifest 수정은 커밋으로 남는다 |
| 코드 범위 P01~P50 | 다음 회차에서 **총 24명**까지 가야 한다. 범위를 넓혀도 안전한 이유는 도구가 **정본 Pool 에 카드가 없는 코드를 거부**하기 때문이다 |
| `--cohort` 는 allowlist | `RUNNABLE_COHORTS` 밖·끝난 회차·오타는 전부 fail-closed |
| 두 스위치 | `--apply` + `--limit=<회차 인원>`. 활성화·중지는 `ACTOR_USER_ID` + `--reason` 도 요구 |
| 일부만 처리하지 않는다 | 한 명이라도 어긋나면 **전원 롤백** |
| Serializable 트랜잭션 | Account 가 중간에 붙는 경합까지 막는다 |
| 조건부 `updateMany` | 기대 status 인 행만 고치고 `count !== 1` 이면 throw (TOCTOU) |
| Gate ⑥-B | 🔴 **트랜잭션 안에서 최종 판정**한다. 밖의 사전 검사는 안내일 뿐이다 — 그 사이에 회원이 같은 이름을 만들 수 있다. **authorHash salt 를 넘긴다**(안 넘기면 17,992건 대조가 통째로 건너뛰어진다) |
| 실회원 fail-closed | `judgeRealMember` 정본 하나. Account 를 못 읽으면 막는다 |
| seed 전량 대조 | `verifySeedCard`(입력) + `verifyPersonaSeed`(DB) 로 Pool 카드와 맞춘다 |
| 불변 대조 | Post · Comment · Queue · ActivityLog · MicroSeedRawContent 를 전후로 센다 |
| Raw SQL 0 | `$queryRaw` · `$executeRaw` 를 쓰지 않는다 |

`--step=check` 는 **언제나 read-only** 이며 단계를 주장하지 않는다 —
선행 회차 상태와 "단계와 무관하게 항상 참이어야 하는 불변 조건" 만 본다.

## §6 실제 활성화 순서 (이 PR 에서 실행 0)

```
① wave3 cohort 생성   User +11 · Persona +11(draft) · AuditLog +22
② seed 적용            Persona 11행 갱신 · AuditLog +11 · status=draft 유지
③ 검증                 --step=check + planner + supply-health
④ 활성화               draft → active · AuditLog +11        🔴 별도 승인
⑤ 단계 전환            GitHub vars SORAN_CAPACITY_STAGE · SORAN_RELEASE_STAGE  🔴 별도 승인 · 코드 수정 0
⑥ 슬롯 확장            auto-publish.yml cron 1개 → 단계별 개수    🔴 별도 승인
⑦ 82cook launchd 등록  독립 job                                    🔴 별도 승인
```

**GitHub Actions 설정** — Settings → Secrets and variables → Actions → **Variables**

| 이름 | 값 | 없거나 틀리면 |
|---|---|---|
| `SORAN_CAPACITY_STAGE` | `d1`·`d3`·`d5`·`d10` | 🔴 d1 (fail-closed) |
| `SORAN_RELEASE_STAGE` | `d1`·`d3`·`d5`·`d10` | 🔴 d1 (fail-closed) |

워크플로우가 이 값을 러너에 전달하고, `규모 설정 확인` 스텝이 로그와 요약에 적는다.
🔴 vars 는 **하루 상한·주 cap·간격**만 정한다. **슬롯(cron)은 yml 이 정본**이며,
둘이 어긋나면 `supply-health` 가 "워크플로우 불일치" 로 잡는다.

**예상 DB 변화** (①~④ 완료 시)

| | 지금 | 후 |
|---|---|---|
| User | 12 | 23 |
| Persona | 8 (active 8) | 19 (active 19) |
| PersonaAuditLog | 37 | 81 |
| Post · Raw · Queue · Comment · ActivityLog | 40 · 58 · 24 · 26 · 6 | **불변** |

🔴 ⑤ 는 **코드도 fixture 도 고치지 않는다** — env 두 줄이다.
🔴 ⑥ 을 빠뜨리면 단계를 올려도 글이 안 나간다. `supply-health` 가 "워크플로우 불일치" 로 잡는다.

## §7 남은 위험

| | |
|---|---|
| 🔴 d10 미달 | Pool 19명 전원이어도 139/140 이다. 지금 Pool 로는 d10 에 닿지 않는다 — **d5 가 현실적 목표** |
| 🔴 100/day 수집 BLOCK | 382건 필요 · 현재 70건. 82cook 독립 job 등록이 전제다 |
| 🔴 82cook launchctl 미등록 | 템플릿은 있다. supply-autopilot 안에서만 돌아 그 회차가 no-op 이면 82cook 도 안 돈다 |
| 🟡 통과율 2단계 가정 | judgePass · draftPass 는 실측이 없다. 회차가 쌓이면 근거표를 채운다 |
| 🟡 자녀 초등 단일 담당 | P02 하나뿐이고 Pool 20장에 다른 후보가 없다. 50명 Pool 에서 보강한다 |
| 🟡 LLM 단가 미설정 | 비용을 계산하지 않는다(추정 금지). env 를 넣으면 안전 상한까지 나온다 |

## §8 검증

```bash
npm run scale:foundation-check      # 367 pass · 0 fail
npm run persona:planner-check
npm run supply:health-check
npx tsc --noEmit && npm run typecheck:ops && npx eslint . && npm run build
```

🔴 **결함 21종을 일부러 주입해 전부 FAIL 하는 것을 확인했다** —
rolling 경계 되돌리기 · YIELD 5% 복귀 · wgang 09:20 · 82cook 등록 거짓표기 ·
단가 없이 비용 추정 · 감속 제거 · fail-open · 시뮬레이션 무시 · 복구 깨짐 무시 ·
슬롯 00:00 · KST 보정 제거 · 워크플로우 대조 무력화 · 배수 리터럴 복귀 ·
Serializable 제거 · 조건부 update 제거 · authorHash salt 제거 · 끝난 회차 재개방 ·
불변 대조 축소 · planner 재계산 · health JSON 누락.

## §9 이전 판 정정 (2026-09-08)

| 이전 판 | 실측 | 영향 |
|---|---|---|
| `listToDetail 0.05` | **0.0087** (10/1,147) | 100/day 목록 요구량 6,360 → **43,816** (6배) |
| d10 "19명 · 주 5건 → 140/140 🟢" | **139/140** | d10 은 지금 Pool 로 도달 불가 |
| d3 주 cap 2 · 간격 3일 / d5 주 3 · 간격 2일 | 주 3·2일 / 주 4·1일 | 옛 검사가 "주 3건 · 3일 간격" 을 잘못 거부했다 |
| `navercafe:wgang` "launchd 09:20" | **13:20** | 템플릿 실측과 달랐다 |
| "수집원 2/3 등록" 만 표기 | 82cook 은 **템플릿만** 있고 launchctl 미등록 | 준비 능력을 현재 능력으로 세고 있었다 |
| 산술 `personasNeeded` 를 판정에 사용 | 시뮬레이션이 판정 | 14명으로 d10 READY 라고 적을 뻔했다 |
| §8 P2 목록 | 이번 PR 에서 전부 처리 | `COLLECT_CAP` 연결 · d3/d5 슬롯 실측 · cohort 도구 |

## §10 Codex 실행 검토 대응 (2026-09-08 · 2차)

Codex 가 생산 경로를 직접 실행해 찾은 것들이다. **전부 이번 amend 에서 고쳤다.**

| | 결함 | 고친 방식 | 실측 증거 |
|---|---|---|---|
| **P0-1** | 자동 감속이 report-only. `release=d10` 에서 화면은 `safeStage=d1` 인데 실제 상수는 10/5/1/140 | 준비도 판정을 `resolveScale` 안으로 넣어 `releaseProfile` 을 **실제로** 낮춤. 그 값이 `judgeApply`·`publishOriginalPostTx`·`planBatch` 로 주입됨 | 러너 로그 `적용된 발행 상한 일 1건 · persona 주 1건 · 최소 5일` |
| **P0-2** | capacity/release 분리가 실동작하지 않음. `capacity=d10, release=d1` 에서 `STOCK_TARGET=14` | `capacityProfile` 과 `releaseProfile` 을 분리. 공급 러너는 capacity, 발행 러너는 release | `재고 기준 경고 30 · 최소 50 · 목표 140 (capacity=d10)` / `공개 일 1건 · 주 1건 · 최소 5일` |
| **P0-3** | env 적용 시점 오류. module-load 상수가 `loadEnvLocal()` 보다 먼저 평가됨 | 모듈 상수를 **가장 안전한 d1** 로 고정하고, 러너가 `loadEnvLocal()` 뒤에 `installFromEnv` 로 설치. GHA vars 도 명시 전달 + 누락/오류는 d1 | `.env.local` 에만 값을 두고(셸 env 없이) 실행 → `capacity=d10 · 요청 d5 에서 감속` |
| **P1-1** | emergency pause 가 Account/seed 때문에 막힘 | pause 는 **대상 존재 · active** 만 본다. create/seed/activate 의 실회원 차단은 유지 | fixture E |
| **P1-2** | Gate ⑥-B 가 트랜잭션 밖에서만 판정 | `loadNameCollisionSets(tx)` + `checkNameCollision` 을 **트랜잭션 안에서 다시** 수행, 걸리면 throw → 전원 롤백 | fixture F |

### 필수 행동 fixture A–G

| | 무엇을 고정하는가 |
|---|---|
| **A** | 요청 d10 + 준비도 d1 → 설치된 공개 상한 1, 그리고 그 상한이 **실제 발행 판정을 막는다** |
| **B** | capacity d10 + release d1 → 재고 목표 140 · 공개 상한 1, 그리고 그 값이 **실제 재고 판정에 쓰인다** |
| **C** | 시작 후 읽은 설정이 반영된다 · 모듈 상수는 안전값 그대로 · 네 러너가 `loadEnvLocal` **뒤에** 설치한다 |
| **D** | GHA vars 전달·검증 스텝 존재 · 누락/허용 밖은 d1 · 정상 d5 는 러너·워크플로우 모두 d5 |
| **E** | Account 붙은 active 도 **pause 성공**, 같은 사람 activate·seed·create 는 실패 |
| **F** | Gate ⑥-B 재판정이 트랜잭션 안이고, 걸리면 **throw**(전원 롤백)이며, 사전 검사와 **같은 판정 함수**를 쓴다 |
| **G** | health·planner·publisher·supply 가 전부 `installFromEnv` 결과를 쓰고 **스스로 감속하지 않는다** |

## §11 Codex 2차 실행 검토 대응 (2026-09-08)

### P0 — 수동 발행기가 readiness 를 우회했다

`original-post-publish-live` 가 `installFromEnv(process.env)` 를 **준비도 없이** 불렀다.
`SORAN_RELEASE_STAGE=d10` 환경에서 사람이 `--apply --limit=10` 을 치면
준비도 판정을 한 번도 거치지 않고 **10건이 그대로 나간다.**

**결정: 수동 도구는 규모 확장 경로가 아니다.**

| | |
|---|---|
| 적용 상한 | 🔴 **환경과 무관하게 항상 `MANUAL_PUBLISH_CAP` = 1건/day** |
| 확장 경로 | d3·d5·d10 은 준비도를 계산하는 `original-post-auto-publish` **만** |
| `--limit` | `judgeManualLimit` 이 **write 전에** 막는다 (`--limit=2` 이상 → exit 1) |
| 설정 표시 | env 값은 **보여만 준다** — "환경은 d10 인데 왜 1건이지" 를 묻지 않도록 |

```
$ SORAN_CAPACITY_STAGE=d10 SORAN_RELEASE_STAGE=d10 npx tsx scripts/original-post-publish-live.mts
  🔴 수동 도구는 **긴급 단건 발행 전용**이다 — 규모 확장 경로가 아니다
  적용 상한  하루 1건 (항상 가장 안전한 단계 · 환경 설정과 무관)
  🟡 환경 설정은 capacity=d10 · release=d10 이지만 **이 도구에는 적용하지 않는다**

$ … --apply --limit=10        → exit 1 (write 전 차단)
$ … --apply --limit=2         → exit 1 (write 전 차단)
```

🔴 `publishOriginalPostTx` 의 트랜잭션 재판정은 **그대로 유지**한다.

### P1 — supply-health 계산 순서가 틀렸다

`readStock` · `judgeSupply` · `judgePublish` · `forecast` 를 **안전 상수(d1)로 먼저** 계산하고
설정을 나중에 설치했다. 그래서 `capacity=d10` 인데 `numbers.target=14` · `level=HEALTHY` 인
모순이 나왔다 — **관제가 준비 부족을 초록으로 보여 주는 것이 가장 나쁜 실패다.**

순서를 이렇게 고쳤다.

```
① queue · persona · history 입력을 읽는다
② 단계별 readiness 를 계산한다 (시작점은 now — 단계마다 다르면 비교가 무의미하다)
③ resolved scale 을 확정한다        ← installFromEnv
④ 그 뒤에 모든 판정을 계산한다
     공급        resolved.capacityProfile   (stockMin · stockTarget · collectCap)
     발행·예측·필요인원  resolved.releaseProfile (dailyCap · weeklyCap · minGap)
```

`judgeSupply` 는 이제 `stockMin` · `stockTarget` 을 **주입받는다**(모듈 상수를 읽지 않는다).
`personaAvailableAt` · `availablePersonasAt` · `capacityOf` · `personasNeededFor` 도
주 cap · 간격을 주입받는다. **규모 설치 후에는 모듈 안전 상수를 운영 숫자로 다시 쓰지 않는다.**

#### 실행 결과

| | level | numbers.target | numbers.dailyCap | capacity.stockTarget | release.dailyCap |
|---|---|---|---|---|---|
| **A** `d10/d10` · 재고 14 | **WARNING** | **140** | **1** | 140 | 1 |
| **B** `d10/d1` · 재고 14 | **WARNING** (내부 재고 부족) | 140 | **1** | 140 | 1 |
| **C** env 없음 | **HEALTHY** (회귀) | 14 | 1 | 14 | 1 |

A 의 감속 사유: `어느 단계도 준비되지 않았다 — 가장 안전한 d1 로 둔다`

#### fixture 는 행동으로 검증한다

소스 정규식이 아니라 `judgeSupply` · `judgePublish` · `buildReport` 를 실제로 조합해
A·B·C 의 `level` · `target` · `dailyCap` 을 직접 확인한다. 그 외에도:

- 같은 재고 14건이 **capacity 에 따라 HEALTHY ↔ WARNING 으로 갈린다**
- 재고 140이면 capacity=d10 에서도 다시 HEALTHY
- `release=d1` 에서 오늘 2건이면 `PUBLISH_OVER_CAP` CRITICAL, `d10` 이면 정상
- 주 2건 쓴 사람이 안전 기본값에서는 막히고 주입 cap(주 5건·간격 1일)에서는 쓸 수 있다
- `personasNeededFor(10/day)` 가 주 cap 1이면 70명, 주 cap 5면 14명

🔴 **재주입 13종을 전부 FAIL 로 확인했다** (2종은 처음 통과해 fixture 를 보강했다 —
`personasNeededFor` 주 cap 누락, `personaAvailableAt` 주입 무시).
