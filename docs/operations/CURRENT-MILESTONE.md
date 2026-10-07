# 현재 실행 — 자동 D100 커뮤니티

> as-of: 2026-10-07 09:51 KST
> 마지막 창업자 동기화: 2026-10-07 (D5 host 실패 · 집 Mac 단일 owner 이관 · D10 선행 준비)
>
> 이 문서는 **검증된 현재 상태와 다음 critical path**만 적는다. 정책은
> [`NORTH-STAR.md`](./NORTH-STAR.md)와
> [`2026-09-21-d100-goal-canon.md`](./2026-09-21-d100-goal-canon.md)가 정한다.
> 권위 지도는 [`README.md`](./README.md) 하나다. 관측하지 않은 것을 PASS로 쓰지 않는다.

## 0. 창업자용 한 문장

**10월 6일 D3는 자동 3/3·첫 댓글 3/3·감사·도장까지 PASS했고, 10월 7일 D5 TRIAL은 첫 글의
60분 댓글 마감 중 운영 Mac이 clamshell sleep에 들어가 FAIL이 확정됐다. 지금 P0는 정책 추가가 아니라,
오늘 밤 D100 9개 job을 집 Mac 한 대로 안전하게 이관해 다음 전체 운영일을 끊김 없이 만드는 것이다.**

오늘 남은 슬롯은 정상 서비스를 위해 계속 돌릴 수 있지만 이미 놓친 첫 댓글 마감은 복구되지 않으므로
오늘을 D5 PASS로 바꾸지 않는다. 사람 발행·댓글·stage 조작으로 증거를 채우지 않는다.

## 1. 검증 기준과 상태

| 축 | code PASS | deployed PASS | operating PASS |
|---|---|---|---|
| runtime 일치 | ✅ pin·manifest·격리 계약 | ✅ runtime HEAD=pin `38efdd3` | ⚠️ `origin/main`은 `af45832`; 이관 전 승인 runtime SHA를 다시 확정 |
| 자동 단계 controller | ✅ `StageDecision` 단일 authority | ✅ controller ON·job loaded | ✅ 10-07 `TRIAL · release d5 · ceiling d10` 기록 |
| 자동 D3 | ✅ 자동 READY·발행·댓글·감사 경로 | ✅ runtime 반영 | ✅ 10-06 자동 3/3·서로 다른 Persona·첫 댓글 3/3·감사·도장 PASS |
| 자동 D5 | ✅ 동일 루프와 5개 슬롯 | ✅ runtime 반영 | ❌ 10-07 첫 글 댓글 마감 누락으로 당일 증명 FAIL |
| 상시 실행 owner | ✅ 9개 job 이관·소유권·rollback 도구 · 미분류 0 · rehearsal PASS(브랜치) | ❌ 회사 Mac에서만 가동 | ❌ 통근 중 clamshell sleep으로 운영 창 단절 실증 |
| JIT source-to-slot | ✅ 부족 슬롯 기반 호출·slot intent·발행 재검사 | ✅ runtime 반영 | ⚠️ 최근 7일 같은 날 공개 0%, 지연 계속 관측 |
| Persona 계약 | ✅ contract-valid 판정 | ✅ 24명 | ✅ D5 하한 충족, ❌ D10 하한 30명에 6명 부족 |
| Persona 30 준비 | ✅ creative batch·형식·품질·사실 충돌 검사 | ❌ PR #661 Draft | UNKNOWN — 실제 batch 재호출·적재·활성화 0 |
| 첫 댓글 | ✅ 60분 계약·회차 내 대체 후보 | ✅ loaded | ❌ 10-07 첫 글 0/1; 최근 7일 댓글이 달린 글은 60분 안 100% |
| 다중 댓글 UI | ✅ Conversation Thread R1 | ✅ production | ✅ 사람·비회원 다중 스레드 실확인 |
| Persona 자동 답글 | ⚠️ 맥락 인터페이스만 있음 | ❌ 비활성 | UNKNOWN — 운영 관측 없음 |
| 감사 | ✅ 일별 20% 표본·판정 | ✅ loaded | ✅ 10-07 09:51 기준 1/1 선정·판정 |
| 82cook | ✅ 수집 보호장치·정치/연예 분리 | ❌ job OFF | UNKNOWN — 안정된 owner·네트워크의 bounded canary 전 |
| 실회원 우선 홈 랭킹 | ❌ Persona 댓글 합산 경로 잔존 | ❌ | UNKNOWN — 분리 지표 없음 |
| North Star | ❌ 재방문 이벤트 없음 | ❌ | UNKNOWN — 실제 재방문 참여를 아직 측정 못함 |
| D100 scheduler | ❌ d3~d50만 지원 | ❌ | ❌ d100 profile 없음 |

`code PASS`는 코드와 검사가 있다는 뜻이고, `deployed PASS`는 현재 runtime에 있다는 뜻이며,
`operating PASS`는 실제 회차 증거가 있다는 뜻이다. 셋을 합쳐서 “완료”라고 쓰지 않는다.
일반 원칙상 contract-valid가 0명이면 다음 단계 하한 검사 때문에 D1→D3 부터 막힌다.

## 2. 10월 7일 운영 실측

### 2.1 오늘 D5가 실패한 정확한 이유

```text
08:10:27  첫 자동 글 공개
08:19:56  회사 Mac clamshell sleep 진입
09:10:27  첫 댓글 60분 마감
09:12:50  사용자 wake
09:51     controller: FAIL · PUBLISH_NOT_AUTO_READY · COMMENT_MISSING
```

- 첫 댓글은 마감 전에 달리지 않았으므로 오늘 D5 증명은 뒤 슬롯 결과와 무관하게 PASS가 될 수 없다.
- `keep-awake`의 `caffeinate`는 덮개를 닫은 MacBook의 clamshell sleep을 막지 못했다.
- 같은 시간 publish·comment·audit 로그의 DB 연결 실패가 sleep 구간과 맞는다.
- 원인은 D5 정책이나 원천 부족이 아니라 **운영 owner가 통근용 노트북이었다는 구조 결함**이다.
- 창업자의 고정 이동 시간 08:15~09:40, 18:10~20:30에는 회사 Mac 덮개가 닫힌다. 이 Mac을
  유일한 D100 owner로 유지하면 같은 실패가 반복된다.

### 2.2 오늘 판정과 최근 7일 깔때기

- 단계: `TRIAL · release d5 · capacity ceiling d10`.
- 09:51 증거: 목표 5, 공개 1, 자동 대상 1, 서로 다른 작성자 1, 첫 댓글 0, 감사 1/1, 도장 1.
- supply·publish·comment·audit·controller·recovery·수집·keep-awake를 포함한 D100 job 9개는 loaded다.
- runtime HEAD와 pin은 `38efdd3`로 같다.

```text
후보 52 → 생성 61 → READY 61(자동 46) → 공개 19(자동 17 · 계약 도장 16)
```

| 관측 | 값 | 판정 |
|---|---:|---|
| 원문 게시→수집 | p50 2.30h · p90 4.74h | 수집 지연은 이전보다 짧음 |
| 수집→생성 | p50 42.71h · p90 67.74h | 🔴 가장 큰 콘텐츠 지연 |
| 생성→READY | p50 0.06h · p90 0.07h | 정상 |
| READY→공개 | p50 21.17h · p90 69.39h | 오래 대기하는 꼬리 존재 |
| 원문 게시→공개 | p50 52.98h · p90 70.59h | 🔴 현재성 목표 미달 |
| 같은 KST 운영일 공개 | 0% | 🔴 JIT 목표 미달 |
| 자동 슬롯 채움 | 17/24, 70.8% | 미달 |
| 첫 댓글 | p50 13.69분 · p90 33.98분 | 댓글이 달린 글은 60분 안 100%, 공개 3건은 댓글 없음 |
| 자동 공개 감사 | 17건 중 7건 선정·7건 판정·결함 1건 | 결함은 별도 기록, 감사 경로는 동작 |

## 3. 상시 호스트 이관 상태

### 3.1 확정한 운영 구조

- **집 Mac 한 대가 D100 9개 job의 유일한 owner가 된다.** 회사 Mac에는 매거진만 남긴다.
- 두 Mac에서 D100을 동시에 돌리지 않는다. 원 Mac `quiesce` → cutover bundle → 대상 `install` 순서를 지킨다.
- 집 Mac은 AC 상시 연결, `sleep 0`, 로그인 세션 유지, 안정된 네트워크를 충족해야 한다.
- 통근 중 사람이 노트북을 열거나 새벽에 일어나 확인하는 것을 정상 운영 조건으로 두지 않는다.

### 3.2 현재 이관 도구의 상태

> as-of 2026-10-07 10:08 KST · 브랜치 `fix/d100-host-cutover-prep` (Draft PR, 미merge)

09:51 plan의 **미분류 2건을 분류해 미분류 2 → 0**이 됐다. 이름은 정확히 하나씩만 등록했고, 두 항목은 안의 모양까지
검사한다(어긋나면 다시 미분류로 export가 멈춘다).

| 경로 | 실측 구조 | 처리 |
|---|---|---|
| `persona-autogen` | Persona creative 결과 JSON 1개(5.6KB, 0600) | `state`로 이관 · creative JSON만 허용 |
| `queue-locks` | 빈 디렉터리 · **매거진** 큐 writer 잠금 | `exclude` · 매거진 큐 잠금 파일만 허용. D100 대상에는 생기지 않는 것이 정상 |

**rehearsal PASS** (회사 Mac, `--cutover` 없음): export 2,474 파일 · 86.0MB(state 76.2MB · 비밀 3 · plist 템플릿 9 ·
D100 로그 9.7MB) → verify 통과 → 가짜 대상 홈 install dry-run·plist 9개 render 통과(원 Mac 경로 0 · placeholder 0).
D100 job 9개 · 매거진 0 · pin `38efdd3`. 묶음·render는 삭제했고 launchd·runtime·env 메타데이터 전후가 같다.
상세는 `ALWAYS-ON-HOST.md` §6.4.

🔴 **아직 하지 않았다**: 실제 `quiesce --apply` · cutover bundle · 대상 `install --apply`. D100 owner는 여전히 회사 Mac이다.

집 Mac에서 사람이 할 일: AC 상시 연결 · `sudo pmset -a sleep 0 womp 1` · 자동 로그인 = 운영 사용자(FileVault 끔) ·
nvm node `v24.14.0` · 저장소 clone + `npm ci` · `gh auth login` · `gcloud auth application-default login` ·
설치 뒤 네이버 로그인 유지와 첫 수집 확인. 82cook job은 첫 cutover 범위 밖이며 계속 OFF다.

## 4. 정본과 구현의 충돌 장부

| ID | 현재 구현·운영 | 정본 판정 | 처리 원칙 |
|---|---|---|---|
| C-01 | 고정 20% READY 할증 | ✅ 삭제·배포됨 | 같은 cohort의 결말과 slot-valid 결과로 계산 |
| C-02 | 고정 상세 원천/day와 고정 유료 묶음 | ✅ 삭제·배포됨 | 부족 슬롯과 현재 계약 실측만큼 호출 |
| C-03 | 정치와 공개 인물을 한 flag로 선필터 | ✅ 교체·배포됨 | 정치 문맥만 제외, 연예·방송·셀럽은 위해 gate 뒤 경쟁 |
| C-04 | 운영 Mac이 통근 중 잠듦 | ❌ 무인 증명 불가 | 집 Mac 단일 owner로 cutover |
| C-05 | 자동 댓글 경로가 첫 댓글에서 끝남 | ⚠️ 단계 증명은 맞지만 실제 대화로 부족 | 첫 댓글 유지 + 선택적 reply-worthiness 연결 |
| C-06 | 홈 인기에 Persona 댓글이 합산될 수 있음 | ❌ 합성 인기를 실사용자 반응처럼 사용 | 실회원 반응·현재성 우선, Persona 신호 분리 |
| C-07 | 재방문 참여 이벤트 없음 | ❌ North Star 측정 불가 | 실사용자 이벤트 계측, Persona·봇·운영자 제외 |
| C-08 | d100 scheduler profile 없음 | ❌ D100 미지원 | d20~d50 실측 뒤 같은 계약으로 d100 구현 |
| C-09 | 82cook policy-disabled | canon상 필요한 원천이나 현재 미가동 | 집 owner에서 작은 canary 뒤 단계적 등록 |

## 5. 다음 critical path

| 우선순위 | 목표 | 완료 조건 | 금지 |
|---|---|---|---|
| P0-1 | 집 Mac 이관 도구 보정·rehearsal | 미분류 0 · verify PASS · 대상 install dry-run PASS — ✅ 10-07 브랜치에서 충족(Draft PR · 미merge, §3.2) | 운영 중 quiesce, 두 host 동시 owner |
| P0-2 | 오늘 밤 cutover | 원 Mac D100 0 · 대상 9 job loaded · owner/pin/로그/DB 연결 PASS · rollback 준비 | 매거진 이동, 비밀을 메신저·클라우드로 전송 |
| P0-3 | 다음 전체 운영일 D5 재증명 | 자동 5/5 · 서로 다른 Persona · 첫 댓글 5/5 · 감사·비용·다음 결정 PASS | 수동 글·댓글·stage 변경 |
| P1-1 | PR #661 Persona 30 마무리 | actual batch 6명 전원 품질·계약 valid, CI, 적재·활성화 별도 검증 | 하한 낮추기, 비슷한 Persona 양산 |
| P1-2 | 82cook bounded canary 준비 | 안정된 집 네트워크·정직한 UA·작은 요청 상한·중단 조건 문서화 | 공용 Wi-Fi 실험, 우회·VPN·UA 위장 |
| P2-1 | D20~D100 선행 용량 | Persona reserve·scheduler·비용·복구를 현재 release와 병렬 준비 | 공개 stage 수동 선행, 완성 글 stockpile |
| P2-2 | 선택적 자동 답글 | canon §5의 같은 reply-worthiness, 실회원 우선, loop·중복·자기답글 0 | 모든 댓글에 의무 답글 |
| P2-3 | 실회원 우선 랭킹·North Star | 실회원 반응 분리와 7일 재방문 참여 계측 | 게시량을 성공 지표로 대체 |

PR #661은 Draft·OPEN·CLEAN, head `adb131a`, 필수 CI success다. 실제 provider 재호출, 운영 DB 적재,
Persona 활성화, merge·deploy는 아직 0이다. 현재 contract-valid는 24명이며 D10 하한까지 6명 부족하다.

## 6. 오늘 작업 경계

### 낮에 해도 되는 것

1. docs-only 정본 동기화와 CI.
2. host migration 분류 보정, 검사, rehearsal bundle, 대상 설치 dry-run.
3. 내일 D5의 job·공급·댓글·감사 read-only preflight.
4. PR #661의 실제 batch 1회 준비와 결과 검토. 운영 적재·활성화는 별도 단계다.
5. 82cook dry-run/canary 계획과 D20~D100 capacity 설계.

### 퇴근 직전에만 하는 것

1. 원 Mac의 실행 중 D100 회차가 없는지 확인.
2. `quiesce --apply`로 D100만 내리고 매거진은 유지.
3. cutover bundle을 만든 뒤 한 번만 안전하게 이동.

### 집 도착 뒤 하는 것

1. 집 Mac 사전 점검과 새 로그인.
2. bundle verify·install·owner 확인.
3. `ops:status`, 첫 heartbeat, DB·네이버·LLM 연결을 확인.
4. 성공하면 원 Mac D100을 계속 quiesced로 두고, 실패하면 runbook 순서로 rollback.

## 7. 대화 상태

- Conversation Thread R1은 production에서 다중 답글·직접 답변 대상·한 단계 들여쓰기까지 검증됐다.
- Persona 자동 댓글은 현재 최상위 첫 댓글을 담당한다.
- 다음 자동화는 새 UI가 아니라 기존 스레드 계약에 reply planner를 연결하는 일이다.
- 실회원과 Persona 댓글에 **canon §5의 같은 reply-worthiness 판정**을 쓰되 실회원을 우선한다.
- 자기 답글·중복·고아·삭제/신고 우회·두 Persona 무한 루프는 영구 0이다.

## 8. 지금 하지 않는 것

- 오늘 D5를 PASS로 만들기 위한 수동 발행·댓글·승격.
- 회사 Mac과 집 Mac에서 D100 job을 동시에 실행.
- 통근용 노트북을 다시 유일한 상시 owner로 사용.
- 82cook을 스타벅스·도서관 등 공용 Wi-Fi에서 live 시험.
- 이미 만든 글이 아깝다는 이유의 구제 또는 완성 글 대량 stockpile.
- 새 콘텐츠 레인 또는 별도 SEO 정보형 레인.
- 검증 전 운영 DB·env·launchd·예산 변경.

## 9. 다음 갱신 조건

이 문서는 다음 중 하나가 발생하면 즉시 갱신한다.

1. ~~host migration 미분류 2건이 해소되고 rehearsal이 PASS함~~ — 2026-10-07 10:08 브랜치에서 충족(§3.2).
2. 집 Mac cutover가 성공하거나 rollback함.
3. 다음 D5 증명일이 PASS·FAIL·UNKNOWN 중 하나로 끝남.
4. contract-valid Persona가 30명에 도달함.
5. 82cook 첫 bounded canary 또는 D20 이상 scheduler가 운영 증거를 남김.
6. runtime·pin·main SHA가 갈라지거나 주요 runner가 반복 실패함.
