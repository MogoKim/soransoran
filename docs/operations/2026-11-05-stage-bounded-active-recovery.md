# 단계 제한 능동 복구 runbook

> 분류: `RUNBOOK`
> 정책 권위: [`2026-09-21-d100-goal-canon.md`](./2026-09-21-d100-goal-canon.md)
> 현재 상태: [`CURRENT-MILESTONE.md`](./CURRENT-MILESTONE.md)
>
> 🔴 **전환기 문서 (2026-11-06).** canon은 아침 공급·READY 예측을 경고로 바꾸고 이 제한 복구 경로를 대체했다
> (canon §3.3 · §11 · §11.1). 이 문서는 그 경로가 코드·runtime에서 지워지기 전까지 이미 배포된 실행을 진단·quiesce·
> rollback하는 데만 쓴다. 아래 "열리는 조건"은 남은 코드의 동작 설명이지 현재 정책이 아니며, 복구를 새로 넓히는
> 근거로 쓰지 않는다. 경로를 지우는 변경에서 이 문서를 📜 역사로 옮긴다.

이 문서는 단계 시험일 아침에 **기회 또는 처리량이 조금 부족하고 다른 운영 결함은 없는 경우** 기존 공급망을 한 번 더 호출하고,
같은 controller가 같은 정책으로 최종 판정하는 절차를 설명한다. 이 문서는 단계 정책이나 PASS 기준을
새로 정하지 않는다.

## 1. 목적과 비목적

목적은 오전 첫 판정 시점의 작은 공급 부족을 그날 안에 보충하는 것이다. 복구가 성공해도
`StageDecision`을 직접 바꾸거나 PASS를 강제하지 않는다. 07:55 KST controller가 기존 preflight,
품질, 비용, 오류 신호를 다시 읽어 오늘 결정을 한 번만 저장한다. 07:58은 결정이 여전히 없을 때
정본 read-only 사실을 다시 계산하는 fallback이며, 새 복구나 provider 호출을 시작하지 않고 기존 결정을 덮지 않는다.

다음은 이 경로의 목적이 아니다.

- 품질·비용·오류·Persona 부족을 우회하기
- 이미 저장된 `StageDecision`을 수정하거나 삭제하기
- 수동 READY, 수동 게시, 수동 단계 변경으로 증거를 만들기
- 자연 공급·자연 발행 증거에 recovery 실행을 섞기
- 공급량을 무제한 늘리거나 두 번째 recovery를 시작하기

## 2. 열리는 정확한 조건

다음 조건을 모두 만족할 때만 `stage-active-recovery-v2` intent를 하루 한 번 만든다.

1. 오늘 `StageDecision`이 아직 없다.
2. 대상 단계가 runtime에 배선된 `d20`, `d30`, `d50` 중 하나다.
3. controller 입력 실패가 없다.
4. 품질·비용·오류 신호가 모두 `ok`다.
5. preflight가 `FAIL` 또는 `UNKNOWN`이고 모든 code가 `OPPORTUNITY_SHORT`, `OPPORTUNITY_UNKNOWN`,
   `THROUGHPUT_SHORT` 중 하나다.
6. 부족분이 1~10건이다.
7. 07:00 이상 07:30 미만 KST다.

하나라도 다르면 새 유료 공급을 시작하지 않는다.

**오늘 recovery 산출물이 하나라도 있으면(손상 포함) 07:00·07:20·07:40은 `StageDecision`을 쓰지 않는다.**
intent가 requested·running·done·failed 어느 상태든, intent 파일이 깨졌든 같다. 07:55 controller만 lineage·exact
READY 가산·exact 비용을 넣어 한 번 저장한다(canon §3.2.1). 복구 중 품질·비용·오류·입력 같은 중대 결함이
생기면 active intent를 failed로 닫아 다음 provider 요청을 막되, 결정은 역시 07:55에 한 번만 쓴다.
산출물이 전혀 없고 복구 대상도 아니면(이미 PASS · 복구 범위 밖 결함 · 07:30 이후) 그 슬롯이 기존 정본 결정을
바로 저장한다. 모든 날을 07:55까지 미루지 않는다.

## 3. 실행 순서와 마감

```text
07:00/07:20 controller
  → 같은 날짜 intent 1개를 원자적으로 생성
  → worker 실행권 claim 1개
  → 우아한 갱년기(wgang) 분류 전 상세를 제한 수집 최대 10건
  → 07:30 전 공급 본체 시작
  → 기존 JIT·품질·READY 파이프라인을 부족분·실측 수율·workset 천장 안에서 실행
  → 공급 완주 receipt 기록
  → worker done/failed

07:20/07:40 controller
  → 산출물이 있으면(requested·running·done·failed·손상) 두 번째 worker·중간 StageDecision 모두 0
  → requested이고 실행권이 아직 없으면 07:30 전에만 실행권을 잡는다
  → 중대 결함이면 active intent를 failed로 닫고 StageDecision 0

07:50
  → worker 절대 종료 마감(07:00 시작도 최대 50분 안에서 이 시각에 종료)

07:55 controller
  → 오늘 결정이 이미 있으면 읽기만 한다(계산·recovery 변경 0)
  → 남은 requested/running intent를 failed로 닫음(닫기 실패는 결정을 막지 않는다)
  → 기존 정본으로 preflight와 운영 신호 재계산 — 시작 claim 회차의 비용을 성공·실패 무관하게 포함,
    intent done일 때만 exact lineage READY 가산
  → StageDecision을 create-only로 저장(동일 계산의 짧은 write retry 최대 3회)

07:58 controller
  → 07:55가 이미 저장했으면 기존 결정을 읽고 종료
  → 결정이 없을 때 정본 read-only 사실을 다시 계산해 create-only로 저장
  → 새 recovery·collector·provider 호출 0
```

collector와 supply 자식은 각각 별도 process group으로 실행한다. collector 내부 15분 timeout이 먼저 종료 기록과
자기 소유 lock 해제를 수행하고, 그 뒤 3분에도 끝나지 않으면 group 전체에 `SIGTERM`, 5초 뒤 `SIGKILL`을 보내
browser/provider 후손이 남아 비용을 계속 쓰지 않게 한다.

## 4. 상태와 소유권

intent 상태는 아래 단방향 전이만 허용한다.

```text
requested → running → done
          ↘ failed  ↗
```

- 날짜별 intent, launch claim, supply-start claim은 모두 `wx` 원자 생성이다.
- recovery 판독은 `absent`·`valid`·`corrupt` 셋뿐이다. `absent`는 intent 파일이 없고(ENOENT) 같은 날짜의 실행권·
  시작 claim·완주/원천 영수증도 없을 때만이다. 다른 읽기 오류·파싱 실패·intent 없이 남은 claim/영수증은 `corrupt`다.
  손상을 없음으로 읽지 않는다. 손상은 중간 결정 0, 07:55에는 비용 신원 모름(`SUPPLY_COST_UNKNOWN`)으로 승급하지 않는다.
  손상만으로 지속 공개 단계를 낮추지는 않는다.
- supply-start claim은 `main()` 전, 첫 provider 요청 전에 그 회차 id(`supplyRunId`)를 남긴다. 옛 형식(회차 id 없음)·
  다른 nonce/부족분은 손상이다.
- 같은 nonce의 worker와 공급 본체는 각각 한 번만 시작할 수 있다.
- 공급 본체는 kernel lease 안에서 claim을 다시 검증한다.
- recovery 공급은 저장·검증된 `recovery` run token이 있어야만 자식 collector·공급 본체를 시작한다.
  token 발급이 실패하거나 비어 있으면 collector·provider·DB write를 모두 0으로 닫으며, 일반 shadow token 경로로 강등하지 않는다.
- 회차 자식은 공급 본체에 들어가기 직전에 token을 다시 읽어 `trigger=recovery`, pass, run ID, 만료 시각을 현재 env·회차와 대조한다.
  token이 누락·손상·불일치·만료된 경우 본체를 호출하지 않으므로 provider·DB write는 0이다.
- 각 provider 요청 직전에도 날짜, nonce, deficit, running 상태, 절대 마감을 다시 검증한다.
- recovery trigger는 follow-up marker를 만들거나 기존 marker를 흡수하지 않는다.
- intent나 claim이 손상되면 추정 복구하지 않고 provider 0·DB write 0으로 닫는다.

runtime 파일은 보조 Mac의 다음 경로에 날짜별로 남는다.

```text
~/Library/Application Support/soransoran/stage-active-recovery/
  YYYY-MM-DD.json
  YYYY-MM-DD.launch-claimed.json
  YYYY-MM-DD.supply-started.json
  YYYY-MM-DD.supply-complete.json
  YYYY-MM-DD.<nonce-hash>.sources.json
  YYYY-MM-DD.log
```

원천 영수증에는 raw 원문 ID나 본문을 쓰지 않고 정렬·중복 제거된 source identity hash만 쓴다. 최종 판정은
날짜 전체 READY 증가량을 recovery 성과로 보지 않는다. exact nonce 영수증의 원천이고 exact supply run에서
intent 생성 뒤 생겼으며 해당 proof slot과 연결된 고유 READY만 recovery 성과로 센다. 같은 시각 자연 READY,
다른 supply run, intent 이전 READY, slot과 연결되지 않은 READY, 같은 원천의 중복 READY는 가산하지 않는다.
같은 원천이 뒤의 자연 수집 snapshot에도 나타나면
preflight는 그 hash를 자연 기회에서 제외해 recovery와 자연 공급을 두 번 세지 않는다. 영수증이 손상되면 빈 집합으로
간주하지 않고 `UNKNOWN`으로 닫는다.

## 5. 비용과 증거 경계

recovery provider 사용량은 공급 일일 정산액, 미상 예약액, overrun, 예산 위험에 포함한다. 다만 recovery를
자연 scheduled 공급으로 세지 않는다. 자연 증명의 분자·분모, 자연 회차 수율, 자연 Dn PASS는 기존
scheduled run token만 사용한다.
비용 판정에는 자연 비용 cohort와 함께 supply-start claim에 기록된 exact recovery `supplyRunId` 하나만 추가한다.
성공·실패 무관하게 같은 회차다. 이 추가는 07:55·07:58 final 판정에서만 한다 — 중간 슬롯에서 넣으면 진행 중인
미정산 요청이 trial 비용을 모름으로 만들어 controller가 자기 복구를 중대 결함으로 취소한다.
모든 슬롯은 오늘 장부의 recovery 요청 회차 집합이 {claim 회차}의 부분집합인지 본다. claim이 있는데 장부가 비어
있는 것은 정상이다(provider 전 종료). claim 없이 recovery 요청이 있거나 claim 밖 회차가 있으면 `SUPPLY_COST_UNKNOWN`이다.
따라서 recovery의 정산액·미상 사용량은 빠지지 않지만, recovery READY나 원천을 자연 수율로 승격하지 않는다.
recovery 요청도 하루 전체 비용 신호에서 빠지지 않는다. overrun·일일 상한 초과·정산 보류가 생기면 기존 비용 브레이크와
감속이 그대로 걸린다.

공급 건강도 분리한다. 엄격 파싱에 성공한 recovery 회차의 실패는 자연 공급 오류 신호(`supplyFailing`)에서 빠지고,
READY 가산 0과 exact 비용으로만 반영된다 — 그것만으로 이미 인증된 공개 단계를 낮추지 않는다. recovery를 주장하지만
tag가 손상된 회차가 마지막이면 성패를 모름으로 두어 승급만 막는다. 파서의 `ok:false` tag는 recovery 신원을 증명하지
못하므로 자연 회차로 남는다. 자연 예약 회차 실패는 지금처럼 오류 신호 bad다.

따라서 아래 둘은 별개다.

- **단계 개방 판단**: recovery 뒤 07:55 controller의 정본 재판정과 07:58 결정 부재 fallback
- **자연 운영 증명**: 자연 scheduled 공급·발행·댓글·감사 결과만 사용

## 6. 관측과 진단

코드·계약 검사는 다음을 실행한다.

`stage:active-recovery-check`는 실제 실행부(`scripts/lib/stage-controller-recovery-step.mts`)를 고정 시계·임시 home·
결정 IO spy로 07:00→07:20→07:40→07:55(→07:58) 순서대로 돌려 write 횟수를 세고, 이어서 변이 하네스
(`stage-active-recovery-mutation`)가 보호 단언을 하나씩 지운 임시 사본에서 같은 검사가 FAIL하는지 본다.
`SORAN_ISOLATED_DB=yes-throwaway`와 localhost `soran_test`를 주면 같은 순서를 실제 `StageDecision` 표에서 돌리고
07:55·07:58 동시 실행이 create-only 1행인지 본다. 운영 controller에는 시각을 바꾸는 플래그가 없다.

```bash
npm run stage:active-recovery-check
npm run stage:ladder-check
npm run ops:loop-check
npm run supply:jit-contract-check
npm run supply:lease-check
npm run stage:evidence-check
```

날짜별 intent와 로그를 읽을 때는 내용을 수정하지 않는다.

```bash
recovery_dir="$HOME/Library/Application Support/soransoran/stage-active-recovery"
ls -la "$recovery_dir"
sed -n '1,220p' "$recovery_dir/YYYY-MM-DD.json"
sed -n '1,260p' "$recovery_dir/YYYY-MM-DD.log"
```

운영 판정은 intent의 `done`만 보고 PASS라고 부르지 않는다. 그날 `StageDecision`, 자연 운영 증거,
비용·오류·감사 결과까지 읽어 `code PASS`, `deployed PASS`, `operating PASS`를 분리해 보고한다.

## 7. 배포와 rollback

배포 전에는 exact SHA에서 위 검사와 D100 격리 DB 사슬을 통과시킨다. 그 뒤 보조 Mac runtime을 같은 SHA로
배포하고 controller launchd가 07:00·07:20·07:40·07:55·07:58에 실행되는지 확인한다.

긴급 rollback은 새 recovery intent 생성을 멈추는 코드/runtime rollback으로 수행한다. 이미 저장된
`StageDecision`을 삭제·수정하지 않고, 이미 실행 중인 worker는 07:50 절대 마감과 provider 경계 검증으로
닫는다. intent 파일을 손으로 지워 재실행시키지 않는다.
