# 단계 제한 능동 복구 runbook

> 분류: `RUNBOOK`
> 정책 권위: [`2026-09-21-d100-goal-canon.md`](./2026-09-21-d100-goal-canon.md)
> 현재 상태: [`CURRENT-MILESTONE.md`](./CURRENT-MILESTONE.md)

이 문서는 단계 시험일 아침에 **기회 수만 조금 부족한 경우** 기존 공급망을 한 번 더 호출하고,
같은 controller가 같은 정책으로 최종 판정하는 절차를 설명한다. 이 문서는 단계 정책이나 PASS 기준을
새로 정하지 않는다.

## 1. 목적과 비목적

목적은 오전 첫 판정 시점의 작은 기회 수 부족을 그날 안에 보충하는 것이다. 복구가 성공해도
`StageDecision`을 직접 바꾸거나 PASS를 강제하지 않는다. 07:55 KST controller가 기존 preflight,
품질, 비용, 오류 신호를 다시 읽어 오늘 결정을 한 번만 저장한다. 07:58은 07:55 저장이 일시 장애로
남긴 결정 부재만 같은 계산으로 다시 저장하는 fallback이며, 새 복구나 provider 호출을 시작하지 않는다.

다음은 이 경로의 목적이 아니다.

- 품질·비용·오류·처리량·Persona 부족을 우회하기
- 이미 저장된 `StageDecision`을 수정하거나 삭제하기
- 수동 READY, 수동 게시, 수동 단계 변경으로 증거를 만들기
- 자연 공급·자연 발행 증거에 recovery 실행을 섞기
- 공급량을 무제한 늘리거나 두 번째 recovery를 시작하기

## 2. 열리는 정확한 조건

다음 조건을 모두 만족할 때만 `stage-active-recovery-v1` intent를 하루 한 번 만든다.

1. 오늘 `StageDecision`이 아직 없다.
2. 대상 단계가 runtime에 배선된 `d20`, `d30`, `d50` 중 하나다.
3. controller 입력 실패가 없다.
4. 품질·비용·오류 신호가 모두 `ok`다.
5. preflight가 `FAIL`이고 code가 정확히 `OPPORTUNITY_SHORT` 하나뿐이다.
6. 부족분이 1~10건이다.
7. 07:00 이상 07:30 미만 KST다.

하나라도 다르면 새 유료 공급을 시작하지 않는다. 이미 requested/running intent가 있으면 07:55 최종 슬롯까지
기다린다. active intent가 없거나 done/failed로 끝났으면 현재 controller 슬롯에서 같은 정본 결정을 저장한다.
다른 결함은 기존 controller의 fail-closed 결정을 따른다.

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

07:40 controller
  → requested/running intent만 두 번째 worker·중간 StageDecision 모두 0
  → done/failed intent면 같은 슬롯에서 현재 정본으로 StageDecision 저장

07:50
  → worker 절대 종료 마감(07:00 시작도 최대 50분 안에서 이 시각에 종료)

07:55 controller
  → 남은 requested/running intent를 failed로 닫음
  → 기존 정본으로 preflight와 운영 신호 재계산
  → StageDecision을 create-only로 저장(동일 계산의 짧은 write retry 최대 3회)

07:58 controller
  → 07:55가 이미 저장했으면 기존 결정을 읽고 종료
  → 저장 일시 장애로 결정이 없을 때만 같은 계산을 다시 create-only로 저장
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
- 같은 nonce의 worker와 공급 본체는 각각 한 번만 시작할 수 있다.
- 공급 본체는 kernel lease 안에서 claim을 다시 검증한다.
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

원천 영수증에는 raw 원문 ID나 본문을 쓰지 않고 정렬·중복 제거된 source identity hash만 쓴다. 같은 원천이
뒤의 자연 수집 snapshot에도 나타나면 preflight는 그 hash를 자연 기회에서 제외해 recovery와 자연 공급을
두 번 세지 않는다. 영수증이 손상되면 빈 집합으로 간주하지 않고 `UNKNOWN`으로 닫는다.

## 5. 비용과 증거 경계

recovery provider 사용량은 공급 일일 정산액, 미상 예약액, overrun, 예산 위험에 포함한다. 다만 recovery를
자연 scheduled 공급으로 세지 않는다. 자연 증명의 분자·분모, 자연 회차 수율, 자연 Dn PASS는 기존
scheduled run token만 사용한다.

따라서 아래 둘은 별개다.

- **단계 개방 판단**: recovery 뒤 07:55 controller의 같은 정본 재판정과 07:58 저장 장애 fallback
- **자연 운영 증명**: 자연 scheduled 공급·발행·댓글·감사 결과만 사용

## 6. 관측과 진단

코드·계약 검사는 다음을 실행한다.

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
