# quality-v7 → quality-v8 전환 배포 확인 절차 (결정 기록)

> 작성 2026-10-13 · PR #710(중복·잘림 입력과 허위 전달 문구 보정) 보정분 · 마스터 재검토 반영 · 대상: 보조 Mac D100 runtime 배포를 실행하는 사람
> 개정 2026-10-13 · #710 뒤 P0 hotfix(contract-transition-v4) — source 상태는 runtime 트리의 snapshot 으로만 받는다

## 왜 따로 확인하나

확정 결함 해소 기록은 **그 기록을 쓴 품질 계약의 판·digest** 에만 묶인다. 운영이 quality-v7 에서 쓴 해소 기록은
quality-v8 코드에서 무효다. 그래서 v8 을 활성화하는 순간, 운영 DB 를 한 글자도 바꾸지 않았는데 **미해소 확정 결함이
0 → 1** 이 되어 자동 READY 가 닫힐 수 있다. Batch B(quality-v7) 배포에서 실제로 일어났다.

## 결정 — 순서는 하나다: stage → resolve → recheck → activate

**미해소가 남은 채 활성화하고 뒤에서 해소하는 길은 없다. 승인으로 통과시키는 길도 없다.**
새 계약 해소 기록은 v7 runtime 과 job 을 그대로 둔 채 **활성화 전에** 덧붙이고, v7=0 · v8=0 을 다시 잰 뒤에만
pin 을 바꾸고 job 을 올린다. 활성화 전에 해소할 수 없으면 그 배포는 BLOCK 이다.

| 단계 | 명령 (보조 Mac) | 바꾸는 것 |
|---|---|---|
| ① stage | `npm run runtime:deploy -- --stage --target=<40자리 SHA>` | `~/Documents/soransoran-runtime-stage` 만 (별도 clone · 자기 node_modules) + source snapshot 파일 하나. runtime 트리 · job · pin · manifest · plist 0 |
| ② resolve | staging 트리에서 공식 `auto-ready:defect-resolve … --apply --production --staged` (아래) | 운영 DB 의 해당 큐 행 `editDiff` 해소 배열에 v8 기록 **덧붙이기** 한 줄씩. 감사 행 · 글 · 다른 칸 0 |
| ③ recheck | ①을 다시 돌린다 — runtime 트리에서 snapshot 을 새로 뜨고, PASS 면 승계 집합을 `contract-succession-<SHA>.json` 에 남긴다 | DB 0 (snapshot · 승계 파일) |
| ④ activate | `npm run runtime:deploy -- --apply --target=<같은 SHA>` | job 을 내리기 **전에** runtime 트리(옛 SHA)에서 source snapshot 을 새로 뜨고 staging 트리로 한 번 더, checkout 뒤 그 snapshot 그대로 runtime 트리(target)로 한 번 더 잰다. 둘 다 PASS 일 때만 pin 전환 · job 로드 |

## 🔴 source snapshot — source 는 source 가 센다 (contract-transition-v4 · #710 뒤 P0 hotfix)

**왜** — v3 은 v7 미해소 집합을 v8 코드(target 판정기)로 다시 셌다. 해소 기록은 그 기록을 쓴 계약 · digest · **초안 게이트 판**에
묶이므로(v7 기록 `draft-gates-v6.1`), v8 판정기(`draft-gates-v8`)가 읽으면 무효다. 그래서 live v7 에서 해소된 옛 계약 행 결함
(cmunjakqf…)이 `NOT_OWN_CONTRACT` 로 부활해 승계가 막혔다.

**정본 원칙** — source(runtime) 상태는 source runtime 의 계약 · digest · 게이트 판으로, target 상태는 target 의 것으로 센다.
target 판정기는 source 기록을 target 게이트로 재해석하지 않는다. 특정 큐 예외 · "target 기록이 있으면 빼기" 같은 우회는 없다.

| 무엇 | 어떻게 |
|---|---|
| 뜨는 자리 | runtime 트리(`~/Documents/soransoran-runtime`, 지금 돌고 있는 옛 SHA)에서 `npx tsx -e <스니펫>` — 그 커밋에 원래 있는 모듈(`quality-contract` · `draft-life-gates` · `auto-ready-defect-resolution` · `ops-signals`)만 부른다. 옛 SHA 에 새 파일이 없어도 된다 |
| 뜨는 때 | `--stage` 마다 · `--apply` 의 job 을 내리기 **전**(staging 재확인 직전). checkout 뒤에는 runtime 트리가 target 이라 **다시 뜨지 않고** 그 snapshot 을 쓴다 |
| 파일 | `<canonical>/contract-source-<SHA>.json` — snapshot 과 sha256 봉인을 함께 쓴다(원자적 교체). 내용은 판 · digest · 큐 id · 감사 지문 · 해소 여부뿐 |
| 게이트 판 | runtime 트리에서 따로 읽어 `--runtime-gate=` 로 넘긴다. snapshot 의 게이트 판과 같아야 한다 |
| 승계 digest | source 결함 상태(큐 id · 감사 지문 · 해소 여부 · 게이트 판)가 들어간다 — stage 뒤 source 집합이 바뀌면 activate 가 `SUCCESSION_DIGEST_MISMATCH` |

**fail-closed** — 아래면 `verdict=BLOCK code=SOURCE_SNAPSHOT_INVALID` (exit 1) · 배포기는 snapshot 을 못 뜨면 그 자리에서 BLOCK:
파일 없음 · JSON 손상 · 봉인 불일치(편집) · snapshot 계약 ≠ `--runtime` 계약 · snapshot 게이트 판 ≠ runtime 게이트 판 ·
snapshot 뒤 확정 결함 집합(새 결함 · 사라진 결함 · 감사 행 바뀜)이 지금 DB 와 다름. `--runtime-gate` · `--source-snapshot` 이 없으면 exit 2.

## ① stage — 출력 읽는 법

`--stage` 는 runtime 트리에서 source snapshot 을 뜬 뒤, staging 트리에서
`scripts/quality-contract-transition-check.mts --runtime=<지금 runtime 계약> --runtime-gate=<runtime 게이트 판> --source-snapshot=<파일>` 을 돈다.
출력은 판 · digest · 건수 · 코드 · 큐 id 뿐이다(제목 · 본문 · Persona · DB 주소 0). 기록할 값:

| 항목 | 출력 줄 |
|---|---|
| 당시 남아 있는 v7 자동 READY(도장 · 미발행) 수 | `runtime=quality-v7:… autoReadyPending=N` |
| runtime(v7) 미해소 확정 결함 수 — **runtime 트리가 센 값** | `runtime=… gate=draft-gates-v6.1 unresolved=N … source=<snapshot digest 16>` |
| runtime(v7) 미해소 결함 큐 | `source-unresolved queue=<id>` (한 줄씩) |
| target(v8) 미해소 확정 결함 수 | `target=quality-v8:… unresolved=N` |
| 결함마다 공식 dry-run 계획 | `defect queue=<id> plan=plan digest=<64> expect=<지금>:<뒤>` |

- `STAGED PASS` (`code=NO_UNRESOLVED` 또는 `code=SUCCESSION`) → ④로 간다.
- `code=TARGET_UNRESOLVED` 이고 모든 결함이 `plan=plan` · `afterPlans target=0` → ②로 간다.
- `plan=refuse`(공식 dry-run 이 계획을 내지 않는다) · `afterPlans target>0` → **이 target 은 활성화할 수 없다.** 배포하지 않는다.
- `code=SOURCE_SNAPSHOT_INVALID` → source snapshot 을 믿을 수 없다(위 fail-closed 목록). 배포하지 않는다 — `--stage` 를 다시 돌려 새로 뜬다.
- `code=SUCCESSION_BROKEN` → v7 미해소를 v8 이 정확히 인수하지 못했다(`NOT_OWN_CONTRACT` · `UNLINKED` · `DUPLICATE` · `FOREIGN_LINK`). 배포하지 않는다 — 원인을 본다.

### 🔴 승계 — v7 자기 계약 행의 결함 (2026-10-13 마스터 결정 · contract-transition-v3)

14:40 결함 행(`cmv689wzr…`)은 **quality-v7 표식** 행이다. 정본 규칙상 v7 코드는 자기 계약 행의 결함을 어떤 기록으로도 해소하지
않으므로 v7 미해소는 v7 에서 영원히 1 이다. 이것을 무시 · waiver 하지 않고 **v8 공식 해소가 인수(승계)** 한다. 통과 조건은 전부다:

1. v8 미해소 확정 결함 0
2. v7 미해소 결함 **전부**가 v7 자기 계약 행에서 났다 — 다른 유형(옛 계약 행 등)의 v7 미해소가 하나라도 있으면 BLOCK(`NOT_OWN_CONTRACT`)
3. v7 결함마다 그것을 가리키는 v8 판 · digest 공식 해소 기록이 **정확히 한 줄**이고 정본 규칙(`recordProblem`)을 통과한다 —
   그 기록이 v8 초안 게이트의 재검증 차단(= v8 고정 반례가 발행 전에 막는다)을 담는다. 없음(`UNLINKED`) · 두 줄 이상(깨진 줄 포함 ·
   `DUPLICATE`) · 다른 결함을 가리키는 줄(`FOREIGN_LINK`)은 BLOCK
4. stage 가 PASS 일 때 남긴 승계 집합(`<canonical>/contract-succession-<SHA>.json` 의 digest)과 activate 직전(job 을 내리기 전) ·
   checkout 뒤 두 재확인의 집합이 같다 — 새 결함 · 바뀐 연결은 `SUCCESSION_DIGEST_MISMATCH`, stage 기록 없음은 `SUCCESSION_NOT_STAGED`

범용 force · bypass · 승인 플래그는 없다. 승계 파일은 배포기가 정한 자리에 stage 가 쓰고 activate 가 읽는다 — 사람이 값을 넣지 않는다.
activate 전까지 v7 자동 lane 은 그대로 닫혀 있다(v8 기록은 v7 판정에 영향이 없다 · 격리 DB 로 고정).
출력에서 `code=SUCCESSION` · `succession=N digest=…` · `succession queue=<id> record=<…> blocked=<코드>` 를 기록한다.

## ② resolve — staging 트리에서 공식 경로로만

```bash
cd ~/Documents/soransoran-runtime-stage
npx tsx scripts/auto-ready-defect-resolve.mts --queue=<queueId>          # dry-run · write 0 · digest/expect 확인
npx tsx scripts/auto-ready-defect-resolve.mts --queue=<queueId> --apply --production --staged \
  --target=<staging SHA> --digest=<dry-run digest> --expect=<dry-run expect> --reason="quality-v8 활성화 전 해소"
```

`--staged` 가드(`stagedGuardProblems`)가 전부 참이어야 열린다:
- origin/main(fetch 직후) = staging HEAD = target이고, staging 트리가 깨끗해야 한다.
- runtime HEAD = pin = manifest가 **서로 같고 target이 아니며**, target의 조상이어야 한다. 되돌아가는 배포에는 쓰지 않는다.
- runtime 트리가 깨끗해야 한다.
- D100 writer job이 실행 중이거나 상태를 모르면 거부한다. job은 내리지 않으니, 끝난 뒤 다시 한다.
- canonical env가 운영 DB를 가리켜야 한다. 격리 DB 모양이면 거부한다.
- digest · expect · reason이 모두 있어야 한다.

`--staged` 를 받는 CLI 는 `auto-ready:defect-resolve` 하나다(Persona 등 다른 운영 쓰기는 거부).
v8 기록은 v7 판정에 아무 영향이 없다 — v7 기록은 그대로 남고 v7 결함 축도 그대로다(격리 DB 반례로 고정).

## 지금 운영 상태에서 기대하는 값 (runtime e4d31d68 · 2026-10-13)

| 축 | 1차 v8 기록 뒤 · 2차 전 | 2차(cmv689…) v8 기록 뒤 |
|---|---|---|
| source(v7) 미해소 | `cmv689…` 하나 (cmunjakqf… 는 v7 기록으로 해소) | 그대로 `cmv689…` 하나 |
| target(v8) 미해소 | `cmv689…` 하나 (cmunjakqf… 는 1차 v8 기록으로 해소) | 0 |
| 판정 | `TARGET_UNRESOLVED` · 승계 `UNLINKED` (`NOT_OWN_CONTRACT` 아님) | `PASS code=SUCCESSION` · `succession=1` |

이 값과 다르면 배포하지 않는다. 2차 해소 · 배포 · gate 개방은 이 문서가 아니라 마스터 지시로만 한다.

## 하지 않는 것

- v7 자동 READY 행을 v8 로 다시 도장하거나 승격하지 않는다 — legacy 로 남고 자동 READY · 자동 발행에서 빠진다.
- v7 해소 기록을 지우거나 고치지 않는다 — v8 기록은 뒤에 덧붙기만 한다(append-only).
- 자동 해소 · 자동 DB write 없음. 배포 · stage 는 DB 를 읽기만 한다.
- 사람 검토로 남은 의미 경고 2종(풀어쓰기 · 감정 세기)을 자동으로 승격하지 않는다.
- 전환 preflight 를 "통과시키는" 플래그는 없다 — 모르는 인자(옛 `--approve-…` 포함)는 exit 2 다.
- main 최신 판정과 품질 계약 판정은 서로를 대신하지 않는다.

## 검사

- 격리 Postgres(CI: `auto-ready:defect-resolution-db-check` 에 이어 실행)
  - 두 검사 모두 source snapshot 을 **실제 운영 runtime 커밋 e4d31d68 worktree** 에서 뜬다(`scripts/lib/source-snapshot-fixture.mts` · CI 는 `fetch-depth: 0`). v7 기록은 실제 모양(게이트 판 `draft-gates-v6.1`)이다
  - `scripts/quality-contract-transition-db-check.mts` — 판정 · 우회 · runtime 단독 미해소 · 출력 · write 0 · cmunjakqf/cmv689 모양 반례 · target 코드로 source 를 다시 세면 `NOT_OWN_CONTRACT`(재현) · snapshot fail-closed 7종 · stage 뒤 source 집합 변경 BLOCK
  - `scripts/quality-contract-deploy-db-check.mts` — **stage → resolve → recheck → activate** · checkout 뒤 재확인 실패 rollback · 해소 불가 BLOCK (실제 `runDeploy` + 실제 CLI)
- `scripts/production-activation-check.mts` ⑥ — staged 가드 반례
- `scripts/runtime-isolation-check.mts` [D-2] — 배포 순서 · staging BLOCK 시 job·코드 0 · checkout 뒤 BLOCK 되돌림
- `scripts/runtime-isolation-check.mts` [D-3] — snapshot 은 RUNTIME_ROOT 에서 · stage/staging 재확인은 먼저 뜨고 실패 시 BLOCK · checkout 뒤는 다시 뜨지 않음 · 전환 검사 3곳 모두 source 인자
