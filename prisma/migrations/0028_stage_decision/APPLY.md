# 0028 StageDecision — 적용 절차

🔴 **2026-09-25 현재 적용하지 않았다.** 창업자 승인 범위는
schema/migration 파일과 저장 adapter 의 **구현·격리 검증**까지다.
production migration apply · PR 병합 · 배포 · controller 스케줄 연결 ·
supply/publish 소비 배선 · feature flag ON 은 **승인되지 않았다.**

## 무엇이 바뀌나

새 표 `StageDecision` 하나를 만든다. **기존 표를 건드리지 않는다.**
컬럼 추가도 없고 FK 도 없다 — 그래서 구버전 Prisma client 로 도는 코드가
이 회차 때문에 깨지지 않는다(없는 표를 select 하지 않기 때문이다).

## 적용 순서

이 회차는 **적용이 merge 보다 먼저일 필요가 없다.** 새 표를 읽는 코드가 아직
아무 데도 없고(`STAGE_CONTROLLER_ENABLED` 가 꺼져 있다), 표가 없어도 기존 경로는
그대로 돈다.

```
① npx prisma migrate deploy          # 표를 만든다
② (확인) SELECT count(*) FROM "StageDecision";   → 0
③ 그 뒤에 controller 배선·flag ON 을 **따로 승인받아** 진행한다
```

## 되돌리기

새 표 하나뿐이다.

```sql
DROP TABLE "StageDecision";
```

🔴 **행을 남긴 채 되돌리지 않는다.** 되돌린 뒤 다시 적용하면 그날 결정이 사라진
상태로 시작하는데, 그때 consumer 는 "결정 없음 → 가장 안전한 단계" 로 간다.
그것이 의도한 동작이다(fail-closed).

## 왜 `kstDate` 가 기본키인가

`(kstDate, contractVersion)` 로 두면 **같은 날 계약 판을 올릴 때 두 번째 행**이 생긴다.
그러면 하루 결정이 둘이 되고, 아침에 옛 판으로 낸 글과 낮에 새 판으로 낸 글이
서로 다른 상한 아래 놓인다. 판이 달라지면 두 번째 행을 만들지 않고
`BROKEN` 으로 멈춰 legacy/가장 안전한 단계로 간다.

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
