# Raw 공급망 설계 (PR-S2 · 2026-09-03)

> **이 문서의 역할**: 원문 공급 경로의 **레인 분리 · 상한 · 실행 환경 · 확장 검토**의 단일 지도.
> 상위: [자동화 전환 정본 §7](2026-09-03-controlled-activity-automation-strategy.md) ·
> [헌법 §6-9-F · §12-2](../constitution/MICRO_SEED_LANE_CONSTITUTION.md)
>
> 🔴 **이 문서가 여는 것은 공급뿐이다.** 공개 발행 · 댓글 · reaction · best 는 이 문서 밖이다.

---

## §0 🔴 한 문장

**원문 재고 15건이 전체 속도의 1위 병목이었고, 그 원인은 크롤 속도가 아니라
"적재기가 Micro Seed 승인 게이트와 묶여 있어서 한 번에 1건밖에 못 넣는 것" 이었다.**

---

## §1 병목의 실제 모양

```
MicroSeedRawContent   15건   (82cook 14 · navercafe:remonterrace 1)
초안 생성 누적        48건   ← 원문 15건을 여러 번 갈았다
```

### 🔴 진짜 원인은 크롤이 아니라 적재 경로였다

기존 importer 는 한 건을 넣을 때마다 **세 곳**에 쓴다.

```
MicroSeedRawContent  +  MicroSeedCandidate  +  Google Sheet 행 1개
                                               ↑ 창업자가 읽는 승인 게이트
```

그래서 `--apply --limit=1` 이 하드 요구였다. **그 제약은 옳다** —
Sheet 에 한 번에 50행이 꽂히면 그 화면은 게이트로서 기능하지 않는다.

**그런데 Original Post 레인은 Sheet 를 쓰지 않는다.**

```
original-post-generate.mts:139
  prisma.microSeedRawContent.findMany({ select: { id, rawTitle, rawBody, sourceSite, sourceCapturedAt } })
```

승인은 `OriginalPostApprovalQueue` 에서 따로 받는다.
**즉 그 레인에 `MicroSeedCandidate` 행도 Sheet 행도 아무 역할이 없다.**

한 importer 가 두 레인을 같은 문으로 통과시키느라, **재료만 필요한 쪽까지 승인 게이트 상한을 쓰고 있었다.**

---

## §2 해법 — 문을 두 개로 나눈다

| | **Micro Seed 레인** | **Original Post 공급** |
|---|---|---|
| 명령 | `--apply --limit=1` | `--apply --raw-only --batch=N` |
| RawContent | ✅ | ✅ |
| `MicroSeedCandidate` | ✅ HOLD | 🔴 **만들지 않는다** |
| Google Sheet | ✅ 행 1개 | 🔴 **읽지도 않는다** |
| 예약 제안 | ✅ | 해당 없음 |
| 한 실행 상한 | **1건** | **50건** |
| 승인 주체 | 창업자 · Sheet | `OriginalPostApprovalQueue` (별도) |

### 🔴 Sheet 를 "쓰지 않는다" 가 아니라 "읽지도 않는다"

읽기만 해도 자격 증명이 필요하고, **그 경로가 살아 있으면 언젠가 쓰기로 이어진다.**
레인을 나눈 이유가 사라진다. raw-only 는 `createGoogleSheetSource` 를 아예 부르지 않는다.

### 🔴 두 스위치 원칙은 그대로다

```
--apply 만                    → dry-run
--raw-only 만                 → dry-run
--apply --raw-only (batch 없음) → dry-run
--apply --raw-only --batch=30 → 🔴 적재
```

### 🔴 섞은 명령은 거부한다

```
--batch 단독            🛑 Micro Seed 레인은 배치를 열지 않는다
--raw-only --limit=1    🛑 두 레인의 상한을 같은 이름으로 부르지 않는다
--batch=51              🛑 상한 초과
```

**모호한 명령을 통과시키면 Sheet 에 50행이 꽂히는 사고가 오타 하나로 난다.**
판정은 `scripts/lib/micro-seed-supply.mts` 의 순수 함수가 하고 fixture 가 96가지 조합을 전수 검증한다.

---

## §3 자동 선별 (`collect --auto`)

기존에는 목록을 사람이 보고 `--fetch=<id,id>` 로 골랐다. 300/day 에는 맞지 않는다.

```
--list --pages=3 --auto --live
   목록 3p 수집 → 선별 점수 계산 → 상위 N건 자동으로 상세 열기
```

| 상수 | 값 | 근거 |
|---|---|---|
| `AUTO_FETCH_MAX` | **30** | 요청 간격 2초 고정 → 상세만 60초. 한 실행 ~1분 30초 |
| `AUTO_MIN_SCORE` | **20** | 여는 순서와 범위만 정한다 |
| `AUTO_SKIP_LIST_FLAGS` | `politicalOrPublicFigure` · `politicalTopicLikely` | ① 목록 단계 — **열기 전** |
| `AUTO_HOLD_DETAIL_FLAGS` | `medicalOrAdLikely` · `publicFigureMention` | ② 상세 단계 — **연 뒤, 적재 전** |

### 🔴 자동 제외는 **두 단계**다 (2026-09-03 실측 정정 · PR-S2-a)

초판은 하나였다: `AUTO_SKIP_FLAGS = ['politicalOrPublicFigure', 'medicalOrAdLikely']`.
**그런데 자동 선별은 목록 단계에서 일어난다.** 목록에는 제목과 댓글수뿐이다.

`medicalOrAdLikely` 는 (시설|시술) **AND** 가격, 또는 상업유도 조합을 요구한다.
제목만으로 그 조합이 성립하는 일은 사실상 없어 **목록 단계에서 한 번도 붙지 않았다.**

**첫 live 수집(2026-09-03 · 10건) 실측**

| 글 | 목록 단계 플래그 | 결과 |
|---|---|---|
| 4234890 `불안으로 정신과약 드셔본 분 계신가요` | `highEngagement` 뿐 | 🔴 자동 수집 통과 |
| 4234897 `뇌MRI 사진에서 치매 및 어지럼증…` | `highEngagement` 뿐 | 🔴 자동 수집 통과 |
| 4234894 `나라별 극우의 특징` | `highEngagement` 뿐 | 🔴 자동 수집 통과 |

> 🔴 **"목록에 적힌 이름" 과 "그 단계에서 실제로 붙는 플래그" 는 다르다.**
> 이름만 적어 두면 가드가 있는 것처럼 보이지만 아무것도 막지 않는다 —
> `noGoTopics` 0/28 히트와 같은 종류의 실패다.

**정정 후**

```
① 목록 단계 제외 (열기 전)     politicalOrPublicFigure · politicalTopicLikely
      → 상세를 아예 열지 않는다. 82cook 요청도 발생하지 않는다

② 상세 단계 보류 (연 뒤, 적재 전)  medicalOrAdLikely · publicFigureMention
      → 상세 JSONL 에는 남는다. raw-only **자동 적재 대상에서만** 뺀다
```

### 🔴 재발 방지 — 이름이 아니라 **발화 증명**을 요구한다

fixture 가 `AUTO_SKIP_LIST_FLAGS` 의 각 플래그에 대해 두 가지를 검사한다.

```
① DETAIL_ONLY_FLAGS 에 없는가              (이름 검사)
② 🔴 제목 하나만 주고 실제로 발화하는가     (발화 증명)
```

②가 핵심이다. `medicalOrAdLikely` 는 ①은 통과하지만 ②를 통과하지 못한다 —
그래서 목록 단계 목록에 둘 수 없다. **이 검사가 있으면 같은 실패가 다시 들어올 수 없다.**

### 🔴 정치 주제는 공인·실명과 **다른 축**이다

`politicalOrPublicFigure` 는 **누가 언급됐는가**를 본다(POLITICS 어휘 · 한자 성 · 직함+이름).
그래서 `나라별 극우의 특징` 을 놓쳤다 — 사람 이름도 직함도 없고 **주제만 정치**인 글이다.

```
politicalTopicLikely   극우·극좌·좌파·우파·수구·빨갱이·좌빨·친일파·토착왜구·개딸·
                       태극기 부대·진영 논리·정치 성향·이념 갈등·정치 글
```

🔴 **최소 어휘로 시작한다. 과차단이 더 나쁘다.**
`보수`(보수공사) · `진보`(진보하다) · `시위` · `집회` · `노조` · `파업` 은 넣지 않았다 —
생활글에서 정상적으로 쓰인다. fixture 가 그 6종을 과차단 회귀로 잡는다.

### 🔴 자동 경로와 수동 경로는 다르다

| | 자동 (`--auto` · raw-only 적재) | 수동 (`--fetch=<id>` · `--sourceArticleId=<id>`) |
|---|---|---|
| 목록 단계 제외 | ✅ 적용 | 🚫 미적용 — 지정하면 열린다 |
| 상세 단계 보류 | ✅ 적용 | 🚫 미적용 — `humanDesignated` |
| 근거 | **경로에 사람이 없다** | 사람이 이미 판단했다 |

> `--sourceArticleId=<id>` 는 "이 글을 넣겠다" 는 명시적 판단이고, **코드가 그 판단을 뒤집지 않는다.**

### 🔴 Raw Vault 저장 정책과 Originality Gate 정책을 혼동하지 않는다

```
Raw Vault 저장   발행이 아니다. 원자료 보관이다
Originality Gate 발행 자격을 본다
자동 원료 공급   🔴 위 둘과 또 다르다 — 여기서만 더 보수적으로 간다
```

자동으로 들어온 원문은 **자동으로 생성기의 재료**가 되고, 그 경로에 사람이 없다.
그래서 Vault 저장 자체를 금지하는 것이 아니라 **자동 적재에서만** 뺀다.
보류된 글도 상세 JSONL 에 그대로 있고, 사람이 지목하면 들어간다.

### 🔴 이것은 30건 슬롯 확대 전용 안전장치다

10건에서 2건(20%)이 의료·광고성이었다. **30건으로 올리면 그대로 3배가 된다.**
슬롯 확대는 이 가드가 붙은 뒤에만 한다.

### 🔴 그래도 Q-1 의 예외가 아니다

정책 Q-1 은 *"품질 플래그로 후보를 거부하지 않는다"* 이다. 이것은 유지된다.

```
🟢 목록 JSONL 에는 전부 남는다
🟢 --fetch=<id> 로 지정하면 언제든 열린다
🔴 자동 경로에서만 뺀다
```

**구분이 중요한 이유: 자동 경로에는 사람이 없다.**
사람이 고를 때는 정치·실명 글을 보고 넘기면 된다. 자동은 넘길 눈이 없고,
그 글이 그대로 Raw Vault 에 들어가 생성기의 재료가 된다.

### 🔴 자동 선별분도 robots 를 다시 본다

대상이 **목록을 받은 뒤에** 정해지므로 사전 robots 검사에 없었다.
`--auto` 경로에서 한 번 더 검사한다 — 건너뛰면 `--auto` 만 robots 밖으로 나가는 구멍이 생긴다.

### 🔴 Vault 대조는 collector 가 하지 않는다

collector 는 `prisma` 를 import 하지 않는다(파일 상단 계약). 그 계약을 깨면
"수집기가 DB 를 만지지 못한다" 는 보장이 사라진다.
중복 적재는 importer 가 `@@unique([sourceSite, sourceArticleId])` 로 막는다 —
여기서 걸러지지 않아 생기는 비용은 82cook 요청 몇 건뿐이다.

---

## §4 300/day 를 채우는 방법 — 상한이 아니라 슬롯

```
❌ AUTO_FETCH_MAX 를 300 으로   → 한 번의 실수가 300건이 된다
🟢 30건 × 하루 10슬롯          → 실수의 크기는 30건에 머문다
```

| 항목 | 값 |
|---|---|
| 수집 슬롯 | 하루 10회 (2시간 간격) |
| 슬롯당 상세 | 최대 30건 |
| 슬롯 소요 | 약 1분 30초 (2초 고정 지연) |
| 적재 배치 | 최대 50건 / 실행 |
| **일일 상한** | **300건** |

**7일이면 2,100건.** shadow 100/day 를 감당하고도 남는다.

---

## §5 실행 환경 — 네이버는 로컬, 82cook 은 GHA

| 소스 | 환경 | 이유 |
|---|---|---|
| **네이버 카페** | 🔴 **로컬 launchd 전용** | 쿠키를 GHA Secrets 에 올리지 않는다. 계정 정지 위험 |
| **82cook** | 🟢 **GHA 가능** | 로그인이 없다 |

**Mac 이 꺼져도 공급의 절반은 살아 있어야 한다.**
우나어가 크롤=로컬 / 큐레이션=GHA 로 나눈 이유가 그대로 적용된다.

### 🔴 이번 PR 은 스케줄러를 등록하지 않는다

plist **템플릿**까지만 둔다 (`docs/operations/launchd/`).
`launchctl load` 는 창업자 승인 후 별도 절차다 — 등록하는 순간 되돌리는 주체가 사람이 된다.

### 네이버 카페 수집기 설계 (미구현 · PR-S2′ 또는 S2-b)

우나어 `agents/cafe/` 에서 가져올 것과 버릴 것을 먼저 적는다.

| 🟢 가져온다 | 🔴 가져오지 않는다 |
|---|---|
| Playwright + 저장 쿠키 세션 구조 | `CafePost` 테이블 — 우리는 `MicroSeedRawContent` 하나로 간다 |
| 락파일 (`/tmp/*.lock` · TTL) | 심리분석 · 트렌드 · DailyBrief (Sonnet 월 ~$328) |
| 쿠키 TTL 30일 · 28일 사전경고 | `content-curator` 발행 경로 — 🔴 원문 그대로 발행이다 |
| `killerScore` 산식 (참여 55 / 길이 20 / 미디어 5 / 게시판 15 / 최신 5) | 이미지 수집 · R2 업로드 |
| `sourceStage` 사다리 (shadow → publishable → core → production) | 페르소나 TS 상수 배열 |
| 슬롯 분산 (7회/day) · Slack 알림 | |

> ⚠️ **이식 전 실측 정정**: 우나어 크롤러 7슬롯은 2026-09-01~03 사흘 연속 실패 중이다
> (`password authentication failed for user "postgres"` · 28P01).
> 브라우저는 뜨고 카페에는 붙지만 DB 저장에서 죽는다.
> **가져오는 것은 코드와 plist 구조이고 그건 멀쩡하다.** "돌아가는 것을 복사한다" 가 아니라
> "구조를 복사하고 새로 붙인다" 다.

---

## §6 Raw Vault 확장 검토 — 🟡 **이번 PR 에 넣지 않는다**

창업자가 검토를 요청한 세 필드다.

| 필드 | 지금 필요한가 | 판단 |
|---|---|---|
| `killerScore` | 🟡 아니다 | 선별은 **수집 시점**에 `selectionScore` 로 이미 한다. DB 에 저장할 이유는 "나중에 재정렬" 인데 그 요구가 아직 없다 |
| `sourceStage` | 🟡 아니다 | 소스가 82cook · 네이버 둘뿐이다. 사다리는 소스가 4~5개일 때 의미가 생긴다 |
| `engagementSignals` | 🟡 아니다 | 댓글 수는 `MicroSeedCandidate.sourceCommentCount` 에 이미 있다. raw-only 는 그 행을 안 만들지만, **Original Post 레인은 댓글 수를 쓰지 않는다**(길이 대리 지표로 쓰지 않기로 확정 — 레인 정본 §7) |

### 🔴 결론: migration 없이 300건을 채울 수 있다

`MicroSeedRawContent` 는 이미 필요한 것을 다 가지고 있다.

```
sourceSite · sourceUrl · sourceArticleId · sourceCapturedAt · rawTitle · rawBody
@@unique([sourceSite, sourceArticleId])   ← 멱등성
```

**그래서 이 PR 은 schema 를 건드리지 않는다.**

### PR 분리 판단

헌법 §12-3 이 *"한 PR 에 schema 와 런타임 코드를 같이 담지 않는다"* 를 확정 정책으로 두고 있다.
근거는 실측 사고다 — merge 즉시 Vercel 자동 배포이고 `migrate deploy` 는 자동 실행되지 않아,
**컬럼 없이 새 코드가 먼저 나가면 런타임이 깨진다.**

```
PR-S2  (이번)   런타임 코드 + 문서       migration 0
PR-S2′ (필요해지면)  Raw Vault 확장 3필드   schema + migration 만
```

**세 필드가 실제로 필요해지는 시점**

| 필드 | 언제 |
|---|---|
| `sourceStage` | 소스가 3개 이상이 되고 소스별 신뢰도를 나눠야 할 때 |
| `killerScore` | 수집 시점 점수와 다른 기준으로 **사후 재정렬**이 필요할 때 |
| `engagementSignals` | 댓글 반응 지도(M3)를 Raw 단계에서 보관해야 할 때 |

🔴 **지금 넣으면 셋 다 값이 채워지지 않은 채 스키마만 늘어난다.**

---

## §7 검증

```
fixture     npx tsx scripts/micro-seed-supply-check.mts     96가지 조합 전수
dry-run     collect --auto (네트워크 0) · import --raw-only (DB write 0)
거부 경로   --batch 단독 · --raw-only --limit · --batch=51  전부 exit 1
타입        npx tsc --noEmit · tsc -p tsconfig.ops.json --noEmit
가드        npm run check:visibility
```

### 🔴 fixture 가 막는 사고 4가지

```
① --batch=50 이 Micro Seed 레인으로 새어 Sheet 에 50행이 꽂히는 것
② raw-only 가 Candidate 를 만들어 승인 게이트를 우회하는 것
③ 스위치 하나(--apply)만으로 write 가 일어나는 것
④ 자동 선별이 정치·실명 글을 열어 생성기 재료로 넣는 것
```

---

## §8 이 PR 이 열지 않는 것

```
🔴 공개 발행 cron · 댓글 cron · reaction · best
🔴 공개 발행 cap 상향 (별도 ladder 승인 — 자동화 전환 정본 §5)
🔴 스케줄러 등록 (plist 템플릿까지만)
🔴 schema · migration
🔴 실제 live 수집 (창업자 승인 후 첫 실행)
```

---

## §9 다음

| 순서 | 작업 | 승인 필요 |
|---|---|---|
| 1 | 첫 live 수집 1슬롯 (`--auto --auto-max=10 --live`) | 🔔 창업자 |
| 2 | raw-only 첫 적재 (`--apply --raw-only --batch=10`) | 🔔 창업자 |
| 3 | 82cook GHA 슬롯 등록 | 🔔 창업자 |
| 4 | 네이버 카페 수집기 구현 + 로컬 plist | PR-S2-b |
| 5 | PR-S3 publish `--id` + cap ladder | — |

---

## §10 관련 문서

| 문서 | 역할 |
|---|---|
| [2026-09-03-controlled-activity-automation-strategy.md](2026-09-03-controlled-activity-automation-strategy.md) | 속도 전략 · cap ladder · PR-S1~S8 |
| [MICRO_SEED_LANE_CONSTITUTION.md](../constitution/MICRO_SEED_LANE_CONSTITUTION.md) | §6-9-F 공급 cron 개방 · §12-2 개방 순서 |
| [2026-09-02-original-post-lane-strategy.md](2026-09-02-original-post-lane-strategy.md) | Raw 를 소비하는 레인 |
| **이 문서** | **Raw 공급망 · 레인 분리 · 자동 선별 · Vault 확장 검토** |
