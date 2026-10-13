# quality-v7 → quality-v8 전환 배포 확인 절차 (결정 기록)

> 작성 2026-10-13 · PR #710(중복·잘림 입력과 허위 전달 문구 보정) 보정분 · 마스터 재검토 반영 · 대상: 보조 Mac D100 runtime 배포를 실행하는 사람

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
| ① stage | `npm run runtime:deploy -- --stage --target=<40자리 SHA>` | `~/Documents/soransoran-runtime-stage` 만 (별도 clone · 자기 node_modules). runtime 트리 · job · pin · manifest · plist 0 |
| ② resolve | staging 트리에서 공식 `auto-ready:defect-resolve … --apply --production --staged` (아래) | 운영 DB 의 해당 큐 행 `editDiff` 해소 배열에 v8 기록 **덧붙이기** 한 줄씩. 감사 행 · 글 · 다른 칸 0 |
| ③ recheck | ①을 다시 돌린다 | 없음 (읽기 전용) |
| ④ activate | `npm run runtime:deploy -- --apply --target=<같은 SHA>` | job 을 내리기 **전에** staging 트리로 한 번 더, checkout 뒤 runtime 트리로 한 번 더 잰다. 둘 다 v7=0 · v8=0 일 때만 pin 전환 · job 로드 |

## ① stage — 출력 읽는 법

`--stage` 는 staging 트리에서 `scripts/quality-contract-transition-check.mts --runtime=<지금 runtime 계약>` 을 돈다.
출력은 판 · digest · 건수 · 코드 · 큐 id 뿐이다(제목 · 본문 · Persona · DB 주소 0). 기록할 값:

| 항목 | 출력 줄 |
|---|---|
| 당시 남아 있는 v7 자동 READY(도장 · 미발행) 수 | `runtime=quality-v7:… autoReadyPending=N` |
| runtime(v7) 미해소 확정 결함 수 | `runtime=… unresolved=N` |
| target(v8) 미해소 확정 결함 수 | `target=quality-v8:… unresolved=N` |
| 결함마다 공식 dry-run 계획 | `defect queue=<id> plan=plan digest=<64> expect=<지금>:<뒤>` |

- `STAGED PASS` (runtime 0 · target 0) → ④로 간다.
- `code=TARGET_UNRESOLVED` 이고 모든 결함이 `plan=plan` · `afterPlans target=0` → ②로 간다.
- `plan=refuse`(공식 dry-run 이 계획을 내지 않는다) · `afterPlans target>0` → **이 target 은 활성화할 수 없다.** 배포하지 않는다.
- `code=RUNTIME_UNRESOLVED` → 지금 v7 gate 가 이미 닫혀 있다. 전환으로 덮지 않는다 — 먼저 원인을 본다.

### 🔴 마스터 결정 필요 — v7 자기 계약 행의 결함 (2026-10-13 14:40 감사 결함)

14:40 결함 행(`cmv689wzr…`)은 **quality-v7 표식** 행이다. 정본 규칙상 "지금 계약 행의 결함은 지금 게이트가 놓친 결함이라
어떤 기록으로도 해소되지 않는다" — 그래서 운영 v7 gate 는 지금 닫혀 있고, **v7 미해소는 v7 코드에서 영원히 1** 이다.
v8 에서는 그 행이 옛 계약 행이 되어 공식 해소가 실제 계획을 낸다(격리 DB: `childLifeStageConflict` 로 재검증 차단 · expect 1:0 ·
적용 뒤 v8=0). 그러나 지금 규칙(v7=0 · v8=0)으로는 활성화가 **영구 BLOCK** 이다(격리 DB 반례 ⑦ 로 고정).
이 PR 은 판정을 스스로 완화하지 않았다. 열 길은 마스터가 정한다 — 예: "v8 미해소 0 이고 v7 미해소가 **전부 v7 자기 계약 행**이며
그 각각이 v8 공식 기록으로 해소됐을 때만 PASS". 그 전까지 v8 활성화는 막혀 있다.

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

## 하지 않는 것

- v7 자동 READY 행을 v8 로 다시 도장하거나 승격하지 않는다 — legacy 로 남고 자동 READY · 자동 발행에서 빠진다.
- v7 해소 기록을 지우거나 고치지 않는다 — v8 기록은 뒤에 덧붙기만 한다(append-only).
- 자동 해소 · 자동 DB write 없음. 배포 · stage 는 DB 를 읽기만 한다.
- 사람 검토로 남은 의미 경고 2종(풀어쓰기 · 감정 세기)을 자동으로 승격하지 않는다.
- 전환 preflight 를 "통과시키는" 플래그는 없다 — 모르는 인자(옛 `--approve-…` 포함)는 exit 2 다.
- main 최신 판정과 품질 계약 판정은 서로를 대신하지 않는다.

## 검사

- 격리 Postgres(CI: `auto-ready:defect-resolution-db-check` 에 이어 실행)
  - `scripts/quality-contract-transition-db-check.mts` — 판정 · 우회 · runtime 단독 미해소 · 출력 · write 0
  - `scripts/quality-contract-deploy-db-check.mts` — **stage → resolve → recheck → activate** · checkout 뒤 재확인 실패 rollback · 해소 불가 BLOCK (실제 `runDeploy` + 실제 CLI)
- `scripts/production-activation-check.mts` ⑥ — staged 가드 반례
- `scripts/runtime-isolation-check.mts` [D-2] — 배포 순서 · staging BLOCK 시 job·코드 0 · checkout 뒤 BLOCK 되돌림
