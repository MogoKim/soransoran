# 발행 스케줄러 — 예약이 늦거나 빠져도 그날이 비지 않게 한다

> 📜 **HISTORICAL — 2026-09-30 정책 대체 표시.** 현재 정책은 [`README.md`](./README.md) 가 가리키는 권위 문서,
> 특히 [D100 canon](./2026-09-21-d100-goal-canon.md) §6 이 정한다. 이 문서의 "정본 env"(`SORAN_CAPACITY_STAGE` ·
> `SORAN_RELEASE_STAGE`) · GitHub Actions 예약으로 단계와 발행 회차를 설명하는 부분은 **당시 동작의 기록**이다 —
> 목표 상태는 `StageDecision` 행 하나가 단계를, launchd 하나가 자동 일정을 소유한다(구현 중 · 미배포).
> catch-up 설계 · 지연 실측은 역사 증거로 남기지만 현재 정책에 투표하지 않는다.

> 🔴 **제목이 "정시" 를 약속하지 않는다.** 이 PR 이 만든 것은 **catch-up** 이고,
> 정시성은 트리거의 성질이다 — §6-a·§6-b 가 어디까지 되고 어디부터 안 되는지 적는다.

> 🔴 이 문서는 **현재 동작**을 적는다. 숫자는 [`MASTER-OPERATING-SYSTEM.md`](MASTER-OPERATING-SYSTEM.md) §6.2 가 정본이고
> 여기서 복제하지 않는다.

## 1. 무엇이 깨졌나 — 실측

| 날짜 | 관측 |
|---|---|
| 2026-09-13 | GitHub Actions 예약 10건이 **전부 도착**했지만 **108~331분 늦게** 왔다 (중앙값 294분) |
| 2026-09-14 | `30 0 * * *`(09:30 KST · **d1 의 유일한 슬롯**)이 **12:15 KST 기준 미도착** — 🟡 판정 대기 |

2026-09-14 의 상태를 정확히 적으면 이렇다.

```
후보 재고        🟢 자동 대상 2건
persona 배정     🟢 2건 모두 가능 (P01 95점 · P04 95점)
일 cap           🟢 0 / 1
kill switch      🟢 꺼짐
슬롯 판정        🟢 "09:30 KST 는 d1 의 슬롯이다"
공개 글          🔴 0편 (12:15 KST 기준)
```

**모든 것이 준비된 채로 그 시점까지 0편이었다.** 막은 것은 코드도 재고도 아니고 **트리거 배달** 하나다.

> 🟡 **"미배달 확정" 으로 쓰지 않는다.** 어제 동일 cron(`30 0 * * *`)의 지연은 **279분**이었고,
> 12:15 KST 시점 경과는 165분이다. 확정은 15:10 KST 관측 이후다 — 그 전까지는 **미도착·판정 대기**.

## 2. 왜 옛 판정으로는 답할 수 없었나

옛 판정(`judgeSlotRun`)이 묻는 것은 하나였다 —

> **"이 run 을 띄운 cron 이 내 단계의 슬롯인가?"**

이 질문은 **GitHub 이 예약을 배달해 준다**는 전제 위에 서 있다. 전제가 깨지면
질문 자체가 성립하지 않는다 — **물어볼 run 이 없기 때문이다.**
d1 은 슬롯이 하루에 하나뿐이라, 그 하나가 유실되면 복구 기회도 없다.

## 3. 질문을 바꾼다

| | 질문 | 예약 하나가 유실되면 |
|---|---|---|
| 옛 | 이 run 은 내 슬롯인가? | 그날이 통째로 빈다 |
| **새** | **지금까지 도래한 내 슬롯 중, 아직 안 나간 것이 있는가?** | 조건을 만족하는 다음 run 이 메운다 |

```
backlog = (지금까지 도래한 내 단계 슬롯의 합) − (오늘 KST 발행 수)
```

### 🔴 catch-up 이 가능한 조건 — "창 안에 트리거 1회" 가 아니다

> **그 단계의 첫 도래 슬롯 시각 이후이고, 22:00 KST 이전인 트리거가 있어야 한다.**

두 조건이 **모두** 필요하다.

| 조건 | 어기면 |
|---|---|
| **그 단계의 첫 슬롯이 도래한 뒤** | `dueCount = 0` → 낼 것이 없다. d1 은 09:30 전, d5·d10 은 08:10 전이 그 구간이다 |
| **22:00 KST 이전** | 창 밖 backlog 는 버린다 |

🔴 그래서 **08:00~09:30 사이에만 트리거가 오는 날의 d1 은 0편**이다 — 창 안이지만 도래 전이다.
그리고 밀림이 n건이면 **트리거도 n회 필요하다**(회차당 1건).

정본은 [`src/lib/publish-slot-catchup.ts`](../../src/lib/publish-slot-catchup.ts) 의 `judgeCatchUp` 하나다.

### 🔴 예약을 늘려서 덮지 않는다

워크플로우 cron 은 **10개 그대로**다. 늘려도 같은 큐에서 같이 늦는다 —
문제는 개수가 아니라 배달이다. fixture 가 cron 개수를 계약으로 못박는다.

## 4. 지켜지는 것

| 계약 | 무엇이 지키나 |
|---|---|
| **앞당겨 내지 않는다** | 도래하지 않은 슬롯은 due 가 아니다. 08:10 회차가 09:30 몫을 미리 내지 않는다 |
| **단계 정체성** | due 는 `PROFILES[stage].slots` 에서만 나온다. d1 이 d3 의 슬롯을 대신 내지 않는다 |
| **하루 상한 불변** | 창이 끝나는 시각의 도래 합 = `dailyTarget`. fixture 가 하루를 1분씩 돌려 확인한다 |
| **한 회차 1건** | `PER_RUN_MAX = 1`. 밀림이 3건이어도 한 번에 쏟지 않는다 — 다음 회차가 잇는다 |
| **당일 창 안에서만** | 22:00 KST 를 넘긴 밀림은 버린다. 밤에 올린 글은 첫 댓글을 밤새 기다린다(§9.5-g) |
| **중복 발행 0** | 아래 §5 — 🔴 **코드·static 검증까지**. 운영 동시성 검증은 하지 않았다 |

> 🔴 **"하루 상한 불변" 검사는 상한 증명이지 운영 능력 증명이 아니다.**
> 매분 트리거가 온다는 가정은 현실에 없다. **실제로 몇 건이 나가는가**는 §6-a 가
> 트리거 도착 시각을 입력으로 넣어 따로 본다.

## 5. 중복을 막는 두 겹

한 겹만으로는 부족하다. ①만 있으면 동시 실행에 뚫리고, ②만 있으면 밀린 슬롯을 모른다.

```
① judgeCatchUp   backlog = 도래 − 오늘 발행 수
                 └ 같은 슬롯 두 번 · 어제 예약이 오늘 도착 · 정시/지연 트리거 겹침 → 두 번째는 0

② publishOriginalPostTx
                 Serializable 트랜잭션 **안에서** 오늘 발행 수를 다시 센다
                 └ ①은 그 순간의 사진이다. 두 run 이 같은 사진을 보는 경쟁을 여기서 막는다
```

🔴 **②는 이번에 고친 것이다.** 옛 판은 호출부가 밖에서 센 `publishedToday` 를 그대로 판정에 썼고
격리 수준도 기본값이었다. 서로 다른 후보의 두 트랜잭션이 같은 스냅샷을 읽으면 둘 다 통과한다 —
조건부 `updateMany` 는 **같은 후보**의 경쟁만 막는다.
댓글 레인(`persona-publish-tx`)이 2026-09-09 에 같은 결함을 고쳤고, 이쪽은 남아 있었다.
catch-up 이 들어오면서 여러 run 이 같은 "밀린 1건" 을 보게 되므로 **실제 위험**이 됐다.

### 🔴 어디까지 검증했나 — 두 가지를 나눠 적는다

| 검증 | 상태 |
|---|---|
| **코드·static** — 판정 함수 행동(결함 5종 재주입) · Serializable 선언 · 트랜잭션 안 재counting · 조건부 UPDATE · cap 로그 · kill switch 보존 | ✅ `publish:catchup-check` |
| **운영 동시성** — 실제 DB 에 두 트리거를 동시에 걸어 중복 0 을 관측 | 🔴 **하지 않았다** |

🔴 **"중복 0 운영 증명 완료" 라고 쓰지 않는다.** 이 PR 이 증명한 것은
*"코드가 그렇게 하도록 쓰여 있고, 그 판정 함수가 그렇게 행동한다"* 까지다.
실제 동시 발행 관측은 **남은 운영 검증**이다(§10).

## 6. 트리거는 둘, 판정은 하나

| 트리거 | 인자 | 정시성 | 역할 |
|---|---|---|---|
| GitHub Actions 예약 | `--trigger=schedule --slot-cron=...` | 🔴 실측 108~331분 지연 · 2026-09-14 1건 미도착 | 서버에서 도는 유일한 트리거 |
| launchd | `--trigger=local` | 🟡 **맥이 깨어 있을 때만** 분 단위 | **단기 임시 bridge** |
| 사람 | `--trigger=manual` (기본) | — | 🔴 **발행하지 않는다.** 연결 확인용 |

🔴 **`judgeCatchUp` 은 "그날 0편" 을 막을 뿐 "정시" 를 만들지 못한다.**
정시는 트리거의 성질이고, 늦게 오는 트리거로는 만들 수 없다.

### 6-a 🔴 2026-09-13 관측 — **그날의 트리거 처리 가능량**

> 🔴 **이 표는 미래 보장이 아니다.** 2026-09-13 하루의 **run 생성 시각(`created_at`)** 을
> 각 슬롯에 적용했을 때, 그 트리거 배열로 **처리 가능했던 건수**다.
> GitHub 의 지연은 날마다 다르므로 **다음 날의 약속이 아니다.**
>
> 🔴 `created_at` 은 **run 이 만들어진 시각**이지 **글이 발행된 시각이 아니다.**
> 실제 발행은 그 뒤 job 이 돌고 트랜잭션이 통과한 뒤다 — 이 표는 발행 시각을 말하지 않는다.

그 관측일 기준 **22:00 KST 이전 `created_at` 은 10회 중 7회**였다(3회는 창 밖).
한 회차가 1건(`PER_RUN_MAX`)이므로 **창 안 트리거 수가 곧 그날의 천장**이다.

| 단계 | 그날 처리 가능량 | 판정 |
|---|---|---|
| d1 | **1 / 1** | 🟢 |
| d3 | **3 / 3** | 🟢 |
| d5 | **5 / 5** | 🟢 |
| **d10** | **7 / 10** | 🔴 **못 채운다** — 17:30·19:00·20:30 슬롯의 run 이 22시 이후에 생성됐다 |

🔴 **"GitHub 만으로도 그날 목표량을 채운다" 는 주장은 삭제한다.** d10 에서 거짓이다.
계약은 배치도 그날의 숫자도 아니라 **부등식**이다 — 창 안 트리거 수 < 슬롯 수면 미달.

### 6-b 🟡 launchd 는 **단기 임시 bridge** 다 — 최종 운영 스케줄러가 아니다

launchd 는 **이 맥이 깨어 있을 때만** 동작한다.

| 맥 상태 | d10 달성 | 왜 |
|---|---|---|
| 깨어 있음 | **10 / 10** 🟢 | 슬롯이 곧 트리거다 |
| 09:00~18:00 절전 | **4 / 10** 🔴 | 절전 중 지나간 회차가 wake 때 **1회로 합쳐진다**(`man launchd.plist` · `StartCalendarInterval`). 그리고 한 회차는 1건만 낸다 |
| 꺼져 있음 | **0 / 10** 🔴 | 놓친 회차는 부팅 시에도 복구되지 않는다(`RunAtLoad=false`) |

🔴 **Mac OFF·sleep 상태에서 d10 10건을 보장한다고 쓰지 않는다.** 보장하지 못한다.
맥 전원과 무관한 정시성이 필요해지면 **다른 것으로 바꾼다** — launchd 가 정답이 아니다.
지금 이것을 고르는 이유는 하나다: 새 vendor·요금제 없이 **오늘** 정시성을 얻을 수 있는 수단이고,
수집(`supply-collect-*`)·처리(`supply-process`)가 이미 같은 트리거 위에 있다.

템플릿: [`scripts/lib/original-post-runner-template.ts`](../../scripts/lib/original-post-runner-template.ts)
🔴 **이 PR 은 등록하지 않는다.** `~/Library/LaunchAgents` 에 두면 로그인·재부팅 때 launchd 가
알아서 올린다 — 되돌리기 어려운 쪽이라 별도 승인으로 남긴다(`PUBLISH_RUNNER_INSTALL_STEPS`).

🔴 **GitHub 예약은 끄지 않는다.** 맥이 꺼져 있으면 남는 것이 그것뿐이다.

### 6-c 🔴 두 트리거는 **서로 다른 설정 원천**을 읽는다

| 트리거 | 설정 원천 |
|---|---|
| GitHub Actions | Repository **Variables** (`--repo MogoKim/soransoran`) |
| launchd(local) | 🔴 `~/Library/Application Support/soransoran/env.local` — **절대 경로 하나** |

**2026-09-14 실측으로 두 곳이 달랐다.**

```
정본 env          SORAN_CAPACITY_STAGE=d3 · SORAN_RELEASE_STAGE=d1   → 실제 공개 d1
GitHub Variables  (비어 있음)                                          → 실제 공개 d1 (fail-closed)
```

🔴 **preflight 는 cwd 도 `process.env` 도 정본으로 쓰지 않는다** (2026-09-14 정정).
앞선 판은 `loadEnvLocal()` → `process.cwd()/.env.local` → `process.env` 로 읽었고,
PR 작업트리에는 `.env.local` 이 없어 **`local d1/d1` 로 읽고 exit 0(거짓 통과)** 를 냈다.
등록 게이트는 "어디서 실행하든 같은 답" 이어야 한다. 정본 파일에서 **단계 키 둘만** 읽는다 —
그 파일에는 `DATABASE_URL` · API key 가 함께 살기 때문에 필요 없는 것은 아예 읽지 않는다.
정본 파일 없음 · 읽기 실패 · 파싱 실패 · 단계 키 부재는 전부 **exit 1** 이다.

지금은 **실제 공개 단계가 우연히 양쪽 d1 로 같아서** 사고가 나지 않았다.
한쪽만 올리면 같은 날 두 트리거가 **서로 다른 하루 상한**을 본다.

🔴 **새 중앙 설정을 만들지 않는다.** 값을 한 곳으로 합치는 대신 **다르면 등록을 멈춘다**.

```bash
npm run publish:trigger-preflight   # 다르면 exit 1 → local runner 등록하지 않는다
```

등록 순서는 **runtime 배포·SHA 확인 → preflight → exit 0 일 때만 plist 설치** 다
(`PUBLISH_RUNNER_INSTALL_STEPS`). d3 전환 절차도 **두 군데를 같이 올리도록** 고쳤다 —
[`MASTER-OPERATING-SYSTEM.md`](MASTER-OPERATING-SYSTEM.md) §6.2 "d3 로 올리는 절차".

### 6-d 🟡 유료 선택지 — 구현하지 않는다

맥 전원과 무관한 정시성이 필요해지면 Vercel Cron 이 기존 인프라 안의 경로다.

| 플랜 | 공식 사양 |
|---|---|
| Hobby | 프로젝트당 cron **100개** · 각 cron **하루 1회** · 정밀도 **±59분** |
| Pro | **월 $20** · **분 단위** 정밀도 |

🔴 이번 amend 에서 **Vercel 구현도 요금제 변경도 하지 않는다.** 선택지만 적어 둔다.

## 7. 호출 그래프

```
[트리거]
  GitHub Actions schedule ──┐   (늦게 온다 · 가끔 안 온다 · d10 은 7/10 이 천장)
  launchd StartCalendar ────┤   (맥이 깨어 있을 때만 · 절전 중 회차는 wake 때 1회로 합쳐진다)
                            ▼
              scripts/original-post-auto-publish.mts
                            │  --apply --limit=1 --trigger=<schedule|local>
                            ▼
   ① 후보 수집 (read-only)  → selectAutoTargets · prepareCandidates
   ② 규모 해석             → resolveScale (GHA Variables / env)
   ③ persona 배정 가능성    → planBatch · TTL
   ④ 오늘 발행 수           → PersonaActivityLog(kind='post') · KST 자정 경계
                            ▼
   ⑤ 🔴 judgeCatchUp(stage, now, trigger, cron, publishedToday)
        │  due   = PROFILES[stage].slots 중 도래한 것
        │  backlog = Σdue.count − publishedToday
        │  창 밖 · 도래 0 · backlog 0 · 트리거 불명 → run:false (DB write 0)
                            ▼
   ⑥ judgeApply(...)  — --apply · --limit=1 · 후보 · cap · kill switch · slot
                            ▼
   ⑦ 배정 (없을 때만)  조건부 updateMany — 0건이면 멈춘다
                            ▼
   ⑧ 🔴 publishOriginalPostTx  — Serializable
        ├ 오늘 발행 수 **재counting** → judgePublish(dailyCap)
        ├ Post.create
        ├ Queue 조건부 updateMany (0건이면 throw → Post 롤백)
        └ PersonaActivityLog.create   ← cap 의 정본
                            ▼
                        공개 Post
```

## 8. 검증

```bash
npm run publish:catchup-check      # 149 검사
npm run publish:trigger-preflight  # 설정 분리 — 다르면 exit 1
npm run typecheck · lint · build
```

재주입하는 결함 다섯:

1. 같은 슬롯이 두 번 불린다
2. GitHub run 이 279분 늦게 도착한다 (2026-09-13 실측)
3. 슬롯 하나가 도착하지 않는다 (2026-09-14 실측)
4. 하루 상한을 넘겨 센다
5. d1/d3/d5/d10 의 슬롯을 서로 혼동한다

🔴 **트리거 입력을 셋으로 나눠 본다** (⑫) — 하나로 뭉개면 "슬롯 10개니까 10건" 이 된다.

| 입력 | d1 | d3 | d5 | d10 |
|---|---|---|---|---|
| ⓐ launchd · 맥 awake | 1/1 | 3/3 | 5/5 | **10/10** |
| ⓑ launchd · 09:00~18:00 절전 coalesce | 1/1 | 3/3 | 4/5 | **4/10** |
| ⓒ GitHub 예약 · 2026-09-13 관측 `created_at` | 1/1 | 3/3 | 5/5 | **7/10** |

🔴 fixture 는 **부등식**을 계약으로 삼는다(창 안 도착 수 < 슬롯 수 ⇒ 미달).
지금 슬롯 배치를 영구 규제로 만들지 않는다 — 배치가 바뀌어도 부등식은 그대로 성립한다.

## 9. 이 문서가 다루지 않는 것

- `stockTarget` · `scale readiness` — 건드리지 않았다
- 새 콘텐츠 규제 · 새 재고 게이트 · 새 vendor — 만들지 않았다
- launchd 등록 · GitHub Variables · runtime env — **운영 변경 0**
- Vercel 구현 · 요금제 변경 — **하지 않았다**(§6-d 는 선택지 기록일 뿐이다)

## 10. 🔴 남은 운영 검증

| 무엇 | 왜 아직 못 했나 |
|---|---|
| **실제 동시 발행에서 중복 0** | 실제 DB 에 두 트리거를 동시에 걸어야 한다. 이 PR 은 DB write 0 계약이라 하지 않았다 |
| **launchd 등록 후 정시성 실측** | 등록 자체가 별도 승인 건이다 |
| **설정 분리 해소** | runtime `env.local` 과 GitHub Variables 중 **어느 쪽을 맞출지**는 창업자 결정이다 |
| **09:30 회차 최종 판정** | 15:10 KST 관측 이후 — 그 전까지는 **미도착·판정 대기** |

## 11. heartbeat 후보 (2026-09-26 · 코드·검사·dry-run 만 — 등록 0)

🔴 **깨우기만 바꾼다. 발행 권한은 그대로 트랜잭션이다.** 정시판(10슬롯)이 지금 설치된 기본값이고 rollback 이다.

| 항목 | 정시판(설치됨) | heartbeat 후보 |
|---|---|---|
| 깨우는 시각 | 10슬롯 | 08:00~22:00 · 10분 달력 항목 85개(슬롯 10개 전부 포함 → 지연 0) |
| 인자 | `--apply --limit=1 --trigger=local` | 같음 + `--heartbeat` |
| label · PATH · 로그 · RunAtLoad | — | 정시판과 같다(같은 label 교체 → 동시 등록 불가) |
| 한 wake 가 내는 최대 | 1건 | 1건 |
| 몇 건·언제 | 트랜잭션: `오늘 발행 < min(도래 슬롯, 하루 목표)` · env 천장 | **같다** — 트리거 종류와 무관 |

- 러너가 더하는 것은 **줄이는 것 둘**: 창 밖 wake 는 DB 0 으로 종료 · 같은 10분 틱의 두 번째 wake 는 `TICK_TAKEN`(틱 키 경로 `wx` — 쥔 채 죽어도 그 틱 하나만 잃는다)
- 러너 로그 `③-s 단계 입력` 에 capacity · release · window · canary · **천장**을 값으로 남긴다
- 🔴 **알려진 분기** — GitHub 은 기간 d3(09-23~29), 로컬 정본은 기간 변수 없음 → 로컬 천장 d1. 로컬 heartbeat 는 d1(하루 1건)까지만 내고 13:30·19:00 은 여전히 늦은 GitHub 예약이 채운다. 로컬 천장이 GitHub 보다 **높으면** preflight 가 막는다(fail-open 방향)
- 검사: `publish:heartbeat-check`(순수) · `publish:heartbeat-db-check`(격리 DB) · `publish:heartbeat-preflight`(plutil lint 임시 파일 · 설치본 대조 · 설치/rollback 명령 **출력만**)
- GitHub Actions 예약 변화 0 — auto-publish cron 10 · visibility-guard cron 1 그대로
