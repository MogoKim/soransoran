# 0028 StageDecision — 적용 절차

🔴 **이 문서의 상태 (2026-10-01 정리).** 이 회차는 production 에 적용됐고, 그 뒤
controller(`scripts/stage-controller.mts`) · consumer 감싸기(`scripts/stage-consume-exec.mts`)
배선이 활성화됐다. 아래 "적용 순서" 는 **처음 적용할 때의 역사 기록**이지 지금 따라 할 runbook 이 아니다.
지금 쓰는 절차는 "되돌리기" 하나다. 운영 상태(행 수 · env 실제 값)는 이 문서에 적지 않는다 —
[`docs/operations/CURRENT-MILESTONE.md`](../../../docs/operations/CURRENT-MILESTONE.md) 가 적는다.

## 무엇이 바뀌나

새 표 `StageDecision` 하나를 만든다. **기존 표를 건드리지 않는다.**
컬럼 추가도 없고 FK 도 없다 — 그래서 구버전 Prisma client 로 도는 코드가
이 회차 때문에 깨지지 않는다(없는 표를 select 하지 않기 때문이다).

## 적용 순서 — 📜 역사 (2026-09-25 당시)

당시에는 새 표를 읽는 코드가 아직 없었다. 그래서 적용이 merge 보다 먼저일 필요가 없었다.

```
① npx prisma migrate deploy          # 표를 만든다
② (확인) SELECT count(*) FROM "StageDecision";   → 0
③ 그 뒤에 controller 배선·flag ON 을 **따로 승인받아** 진행한다
```

## 되돌리기 — 정본은 `STAGE_CONTROLLER_ENABLED=off` 다

```
STAGE_CONTROLLER_ENABLED=off
```

이 한 줄이 일반 rollback 절차의 **전부**다. switch 는 정확히 `on` 일 때만 켜진다 —
`off` · 빈 값 · 누락은 모두 꺼짐이다. 꺼지면 controller 는 결정을 저장하지 않고,
consumer 는 결정을 읽지 않고 **가장 안전한 단계(d1)** 를 명시해서 러너에 넣는다(감속).
🔴 옛 env 단계 · canary 경로로 돌아가지 않는다 — 그 경로는 지웠다. env 파일에 손으로 적은
단계 값이 남아 있어도 consumer 가 넣은 d1 이 덮는다.

🔴 switch 는 단계 authority 가 아니다. 켜져 있을 때 그날의 단계는 `StageDecision` 한 행이 정한다.

🔴 **이때 `StageDecision` 표와 그때까지의 결정 행은 그대로 보존한다.**
지우지 않는다. 꺼진 동안 아무도 그 행을 읽지 않으므로 운영에 영향이 없고,
나중에 다시 켤 때 이력이 이어진다.

### schema 제거는 일반 rollback 이 아니다

표 자체를 없애는 일(`DROP TABLE`)은 **이 절차에 포함되지 않는다.**
결정 이력을 잃는 별개의 작업이고, 하려면

- **별도 승인**을 받고
- **별도 migration** 으로 만든다

flag 를 끄는 것으로 되돌리기가 끝나므로, 표를 지울 이유는 평소에 없다.

## 왜 `kstDate` 가 기본키인가

`(kstDate, contractVersion)` 로 두면 **같은 날 계약 판을 올릴 때 두 번째 행**이 생긴다.
그러면 하루 결정이 둘이 되고, 아침에 옛 판으로 낸 글과 낮에 새 판으로 낸 글이
서로 다른 상한 아래 놓인다. 판이 달라지면 두 번째 행을 만들지 않고
`BROKEN` 으로 멈춰 가장 안전한 단계(d1)로 간다.

## 불변(immutable)은 어디서 지켜지나

🔴 **이 SQL 이 아니다.** `UPDATE`·`DELETE` 는 그대로 돈다.
`src/lib/stage-decision-repo.ts` 가 `create`/`read` 만 내주는 것으로 지킨다.
`npm run stage:ladder-check` 가 그 파일에 `update`·`upsert`·`delete*` 호출이
0 인지 본다.

## 격리 DB 에서 확인한 것

```
npm run stage:db-check     # 🔴 격리 DATABASE_URL 이 아니면 즉시 멈춘다
```

- 결정 → DB → 읽기 → validator 왕복 (값 손실 0)
- 같은 날짜 동시 create 두 건 중 **한 건만** 생성 · 패자는 승자 행을 읽음
- 다른 contractVersion 의 같은 날짜 두 번째 행 차단
- JSON null · supply · transition 왕복
- 깨진 JSON 행을 consumer 가 차단
- adapter 에 update/delete 경로 0
