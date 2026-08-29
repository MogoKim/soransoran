# VE-M3-6 전량 분석 결과 export 설계

> 작성 2026-08-29 · 상태 **구현 완료** · 선행 [VE-M3-5 전량 확대 계획](2026-08-27-voice-m3-full-scale-plan.md)

## §0 왜 필요한가

VE-M3 전량 분석이 끝났다. `processed 9,444 / 9,444` · `succeeded 9,411` · `terminal skipped 33` · `failed 0`.

그런데 **9,411건은 사람이 DB 로 읽을 수 없는 양이다.** 분석을 해 놓고 읽지 못하면 안 한 것과 같다.

동시에 이 export 에는 정면으로 충돌하는 요구가 하나 있다 —
**"읽을 수 있게 만들되, 원문을 내보내지 않는다."**

원문을 붙이면 읽기는 쉬워지지만 그 순간 이 파일은 우나어 원문 유출 경로가 된다.
이 문서가 정하는 것은 그 경계다. 이 도구의 일은 "보여주는 것" 이 아니라
**"원문 없이 판단 가능하게 만드는 것"** 이다.

---

## §1 산출물

| 경로 | 형식 | 건수 | 목적 |
|---|---|---|---|
| `tmp/voice-m3-export/{stamp}/signals.csv` | CSV (UTF-8 **BOM**) | 9,411 | 정본. 스프레드시트에서 정렬·필터 |
| `tmp/voice-m3-export/{stamp}/skipped.csv` | CSV (UTF-8 **BOM**) | 33 | 가드가 무엇을 왜 막았는지 |
| `tmp/voice-m3-export/{stamp}/report.md` | Markdown | 1 | **가장 먼저 읽을 파일** |
| `tmp/voice-m3-export/{stamp}/signals.jsonl` | JSONL (BOM 없음) | 9,411 | 후속 프로그램 입력 |
| `tmp/voice-m3-export/{stamp}/manifest.json` | JSON (BOM 없음) | 1 | 재현성·사후 감사 |

`{stamp}` = 실행 시각 `YYYYMMDD-HHmmss`. 덮어쓰지 않아 이전 export 와 비교할 수 있다.

**BOM 을 CSV 에만 붙이는 이유** — CSV 는 사람이 Excel 로 연다. BOM 이 없으면 한글이 깨진다.
JSONL·manifest 는 기계가 읽고, BOM 은 파서를 혼란시킨다. 용도가 다르니 다르게 쓴다.

**`skipped.csv` 를 분리하는 이유** — 이 33건은 `output` 이 `null` 이다.
`signals.csv` 에 섞으면 신호 7종이 빈 값으로 들어가 **평균·중앙값이 오염된다.**
신호 컬럼을 아예 만들지 않고 `outputIsNull` 한 열로 null 임을 명시한다.

---

## §2 컬럼 — 화이트리스트

내보낼 것을 상수 배열에서만 정한다. 스키마에 새 필드가 생겨도 배열에 없으면 자동으로 새지 않는다.

### `signals.csv` — 18열

`sourceRef` · `sourceSite` · `bodyLength` · `commentCount` ·
`naturalnessScore` 🟢 · `voiceRetention` 🟢 · `originalityDelta` 🟢 ·
`overSanitizedRisk` 🔴 · `overMimicryRisk` 🔴 · `expressionRisk` 🔴 · `sequenceSimilarityRisk` 🔴 ·
`notes` · `status` · `errorCode` · `inputTokens` · `outputTokens` · `totalTokens` · `costUsd`

### `skipped.csv` — 8열

`sourceRef` · `sourceSite` · `bodyLength` · `commentCount` · `errorCode` · `status` · `costUsd` · `outputIsNull`

### 🔴 제외 — 이유가 각각 있다

| 컬럼 | 제외 이유 |
|---|---|
| `title` | **스키마에 없다.** 넣으려면 우나어 `CafePost` 를 봐야 하는데 **제목은 원문의 일부다** |
| `sourceUrl` | 스키마 주석이 `🔴 역추적용. 외부 노출 금지 (§10-5-A)` 로 못박았다 |
| `errorMessage` | 진단 문자열. **원문 조각이 섞였을 가능성을 배제할 수 없다** |
| `cacheKey` · `contentHash` | 내부값. 사람이 판단하는 데 쓰이지 않는다 |
| `legacyLabels` | 우나어 스키마 종속. VE-R3.1 에서 이 경로로 유출된 전례가 있다 |
| `authorHash` | 판단에 불필요 |

> **신호 키 이름 주의** — 실제 저장 키는 `naturalnessScore` 다(`naturalness` 아님).
> 설계 논의에서 짧은 이름을 썼으나 **DB 실제 키를 그대로** 쓴다.

---

## §3 원문 유출 방지 — 4중

### ① 조회 단계 차단

export 는 우나어 원문 테이블을 **기본적으로 열지 않는다.**
`content` · `topComments` 를 가져오지 않으므로 유출할 원문이 메모리에 없다.

유일한 예외가 ③ 유출 재검사다. 그 블록에서만 커넥션을 열고, **대조에만 쓰고 즉시 닫는다.**
원문은 어떤 변수·파일에도 남지 않는다.

### ② 컬럼 화이트리스트

`SIGNAL_COLUMNS` · `SKIPPED_COLUMNS` 밖의 필드는 접근하지 않는다.
Prisma `select` 절에도 금지 컬럼이 없어야 한다 — fixture 가 `sourceUrl: true` 같은 패턴을 잡는다.

### ③ export 직전 20자 전수 재검사

`succeeded` 9,411건의 `notes` 를 우나어 원문·댓글과 `assertNoSourceLeak` 로 재대조한다.
`M3_LEAK_RUN_MIN = 20` 을 그대로 쓰고 **호출부에서 임계값을 넘기지 않는다**(인자 3개 금지).

**저장 시점에 이미 통과한 데이터인데 왜 또 보는가**
- 저장 이후 원문이 수정돼 새로 일치가 생겼을 수 있다
- export 는 파일로 나가 통제를 벗어난다. 마지막 관문이 필요하다

### ④ 금지 호칭 재검사

`M3_FORBIDDEN_ADDRESS_TERMS`("시니어·어르신·노인·실버")를 `notes` 에서 재확인한다.

### 🔴 위반 시 — 파일을 쓰지 않는다

③ · ④ 에서 **1건이라도 걸리면 파일을 생성하지 않고 중단한다.**

부분 export 도 하지 않는다. 위반 행만 빼고 내보내면
**"검사를 통과한 export" 라는 잘못된 신뢰가 생긴다.**

---

## §4 report.md 구성

```
§1  개요            모집단 · processed · 비용 · 검증 결과
§2  7종 신호 분포     평균 · 중앙값 · p10 · p90 · 최소 · 최대 · 표준편차
§3  출처별 평균       6개 출처 × 7종
§4  출처별 skip율     🔴 비율로 본다
§5  좋은 신호 상위·하위 30건   naturalness · voiceRetention · originalityDelta
§6  위험 신호 상위 30건        overSanitized · overMimicry · expression · sequenceSimilarity
§7  위험 조합 사례
§8  좋은 학습 후보     🔴 초안 기준
§9  학습 제외 후보     🔴 초안 기준
§10 terminal skip 33건 분석
§11 한계와 주의
```

### §4 를 비율로 계산하는 이유

전량 실행 중 "SOURCE_LEAK 이 특정 출처에 편중된다" 고 여러 번 의심했다.
그러나 **절대 건수는 모집단 크기를 따라간다.**

```
wgang        skip 15 / 3,680건 = 0.41%
dlxogns01    skip 13 / 3,010건 = 0.43%
remonterrace skip  5 / 2,334건 = 0.21%
```

건수만 보면 편중처럼 보이지만 비율은 거의 균등하다.
리포트가 이 비율을 **직접 계산해 보여주면** 그 착시가 사라진다.

### §7 위험 조합 — 단일 지표로 안 보이는 것

| 조합 | 조건 | 의미 |
|---|---|---|
| 판정 불안정 | `overSanitized ≥ 70` AND `overMimicry ≥ 70` | 서로 반대 방향인데 둘 다 높다 |
| 자연스럽지만 따라 씀 | `naturalness ≥ 80` AND `sequenceSimilarity ≥ 70` | **가장 위험하다** |
| 목소리 상실 | `voiceRetention ≤ 30` AND `overSanitized ≥ 70` | 밋밋해졌다 |
| 표현 위험 단독 | `expressionRisk ≥ 80` | |

### 🔴 §8 · §9 는 초안 기준이다

임계값(70/70/60/30, 80/60)은 **분포를 보기 전에 정한 것이라 근거가 약하다.**
리포트 본문에도 "초안 기준이다. 확정 기준이 아니다" 를 명시한다.

§2 의 p10 · p90 을 먼저 읽고 **임계값을 다시 정하는 2단계**를 전제로 한다.

---

## §4-1 🔴 비용은 CostEvent 로 센다

리포트의 총비용은 **`VoiceM3CostEvent` 합계**다. `VoiceM3Cache` 합계가 아니다.

```
총비용(실지출)   $42.0139   ← CostEvent · claude-haiku-4.5
├ 캐시 저장 기준  $41.9787   ← Cache 건별 최종 1행 합계
└ 재시도분        $0.0352   ← 같은 건을 다시 부른 비용
```

`Cache` 는 건별 **최종 1행만** 남는다. 재시도로 두 번 부른 건도 행은 하나다.
그래서 Cache 로 세면 **실제 지출보다 적게 나온다.**
"얼마 썼나" 를 묻는 자리에 적게 나오는 수를 두면 안 되므로 CostEvent 를 정본으로 쓴다.

**모델 필터 주의** — `where: { model: 'claude-haiku-4.5' }` 로 거른다.
전 모델 합계는 $42.1465 이고 차액 $0.1326 은 모델 비교 실험(gpt-5-nano 30건 · gpt-5-mini 30건)이다.
이 리포트는 haiku 전량 분석이므로 **haiku 비용만** 센다.

---

## §5 실행

```bash
npm run voice:m3-export                   # 전량 export
npm run voice:m3-export -- --verify-only  # 유출 재검사만 (파일 생성 0)
npm run voice:m3-export -- --report-only  # report.md 만 재생성
```

### 🔴 설계상 못 하게 막은 것

- `--apply` · `--confirm-paid-call` 을 **받지 않는다** (`voice-m3-plan` 과 같은 방식)
- `voice-m3-provider` 를 import 하지 않는다 — 유료 호출 경로가 물리적으로 없다
- Prisma 는 `findMany` · `groupBy` · `count` 만 쓴다 — `create`/`update`/`upsert`/`delete` 0

넘겨도 아무 일이 없는 것이 아니라 **받을 수 있는 플래그 자체가 없다.**

---

## §6 PASS 기준 9개

| # | 기준 | 검사 방식 |
|---|---|---|
| 1 | `notes` 20자 연속 유출 **0건** | 실행 중 전수 대조 |
| 2 | `notes` 금지 호칭 **0건** | 실행 중 전수 대조 |
| 3 | 행수 = succeeded 실측 · skipped 실측 | manifest 대조 |
| 4 | 신호 7종 0~100 정수 · 결측 0 | 저장 시 검증 완료분 |
| 5 | 화이트리스트 외 컬럼 0 | fixture ㊲ |
| 6 | 금지 문자열 산출물에 0회 | **생성 후 파일 재검사** |
| 7 | 출력이 `tmp/` 하위 · git 미추적 | fixture ㊴ + `git status` |
| 8 | DB write 0 · LLM 0 | fixture ㊲ |
| 9 | `typecheck:ops` 통과 | CI |

기준 6 · 8 은 코드 리뷰가 아니라 **자동 검사**다.
가드는 "있다" 가 아니라 **"작동한다"** 를 봐야 한다 — 이 원칙은 세션 내내 여러 번 값을 치렀다.

---

## §7 fixture 3종 (㊲ ㊳ ㊴)

| fixture | 검사 |
|---|---|
| **㊲ export 유료 · write 경로 0** | provider import · LLM 호출 · 유료 플래그 · prisma write · 금지 컬럼 · select 금지 필드 |
| **㊳ export 유출 가드 · 중단** | 20자 대조 존재 · **임계값 호출부 전달 금지** · 금지 호칭 대조 · **가드가 파일 쓰기보다 앞** · exit 1 · skip output null |
| **㊴ export 산출물 격리** | `tmp/` 하위 · `.gitignore` 커버 · CSV BOM · JSONL/manifest BOM 없음 · sha256 · 생성 후 재검사 |

### 🔴 역검증에서 잡은 가드 결함

fixture 를 만든 뒤 **일부러 위반을 주입해** 실제로 잡는지 확인했다. 6종 중 1종이 통과했다.

```
④ assertNoSourceLeak(notes, [...], 999)  ← 임계값 완화 주입
   → 잡히지 않음 🔴
```

원인은 정규식 `/assertNoSourceLeak\([^()]*,[^()]*,/` 다.
`[^()]*` 는 괄호를 포함하지 않는데, export 의 호출 인자에는
`String(...)` · `topCommentsToText(...)` 가 들어 있어 거기서 끊겼다.
`run.mts` 는 인자에 괄호가 없어 같은 정규식이 작동했던 것이다.

**괄호 깊이를 추적해 최상위 콤마만 세는 방식**으로 고쳤고, 재역검증에서 잡혔다.

> 이 사례는 이번 세션에서 반복된 패턴이다 —
> **가드를 정규식으로 쓰면 가드가 자기 목적을 못 맞춘다.**
> 문자열 매칭이 아니라 **구조(인자 개수·위치·순서)** 로 검사해야 한다.

---

## §8 확정된 결정 (창업자 승인)

1. `title` 컬럼 — **넣지 않는다**
2. `sourceUrl` — 어떤 산출물에도 **넣지 않는다**
3. `errorMessage` — **export 하지 않는다**
4. 우나어 DB 조회 — **유출 재검사용으로만 허용**
5. CSV UTF-8 BOM 포함 / JSONL·manifest BOM 없음
6. 상위·하위 사례 **30건** 유지
7. 학습 후보·제외 후보 임계값 — **"초안 기준" 으로 표시**, 확정 기준처럼 쓰지 않는다

---

## §9 변경 파일

| 파일 | 변경 |
|---|---|
| `scripts/voice-m3-export.mts` | 신규 |
| `package.json` | `voice:m3-export` 1줄 |
| `scripts/voice-m3-check.mts` | fixture ㊲㊳㊴ 추가 (36 → 39건) |
| `docs/operations/2026-08-29-voice-m3-export-design.md` | 신규 (이 문서) |

**변경하지 않은 것** — `voice-m3-contract.mts`(상수 재사용만) · `voice-m3-run.mts` ·
`voice-m3-provider.mts` · `prisma/schema.prisma`.
`tmp/` 는 이미 `.gitignore` 47행에 등재돼 있어 별도 조치가 필요 없다.

---

## §10 남은 판단 — 다음 단계

export 는 **읽을 수 있게 만드는 것까지**다. 그 다음은 사람이 정한다.

1. **§2 분포를 먼저 읽는다** — p10 · p90 을 보고 §8 · §9 임계값을 확정한다
2. 확정된 기준으로 학습 후보군을 다시 뽑는다
3. 그 후에 글 생성 모델 실험으로 넘어간다

🔴 **점수로 발행을 자동화하지 않는다.** 이 리포트는 사람이 읽는 입력이지 판정기가 아니다.
