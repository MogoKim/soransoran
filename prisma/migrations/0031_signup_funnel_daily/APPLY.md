# 0031 SignupFunnelDaily — 적용·확인·복구 절차

> 🔴 이 순서를 지킨다. 이 문서는 0031 적용·확인·복구의 단일 실행 절차다.
> 제품 정책, D100 운영 정책, 회원가입 전환 정책을 새로 결정하지 않는다.
> 회원가입 전환 영역 정책은 `docs/operations/MEMBER-CONVERSION-CANON.md`가 정한다 — 회원가입 전환 영역 정본
> §8(측정 계약) · §8-7(gate) · §8-8(저장과 보관).
>
> 🔴 이 문서는 적용 절차다. 운영 DB 상태를 적지 않는다 — 상태는 적용 직전 S0 에서 다시 읽는다.
> Production·Preview 가 어떤 DB 에 연결돼 있는지도 과거 기록을 현재 사실로 쓰지 않고 S0 에서 재확인한다.

## 0. 무엇을 바꾸는가

| 대상 | 변경 |
|---|---|
| `SignupFunnelDaily` | 새 표 하나. `day` · `step` · `contentType` · `entryPoint` (모두 `TEXT NOT NULL`) · `count INTEGER NOT NULL DEFAULT 0` · `updatedAt TIMESTAMP(3) NOT NULL` |
| 기본키 | 복합 PK `("day","step","contentType","entryPoint")` — 이름 `SignupFunnelDaily_pkey` |
| 그 밖 | 없음. 다른 표 변경 · FK · 별도 인덱스 · enum · seed · backfill 0 |

개인정보 열과 콘텐츠 식별 열은 없다(회원가입 전환 영역 정본 §8-9).

## 1. PR 구성 — 앱 동작 변경 0

```
PR-M   이 폴더의 두 파일만 (migration.sql · APPLY.md)
       schema.prisma · 앱 코드 · package.json · workflow 변경 0
       → merge 해도 앱 동작이 바뀌지 않는다. 어떤 코드도 새 표를 읽거나 쓰지 않는다
PR-A   schema.prisma 모델 · 앱 코드 (MC-M4 구현) — 별도 PR · 별도 승인
```

🔴 **PR-M merge 와 운영 DB 적용은 각각 별도 승인이다.** merge 는 파일 등록일 뿐이고, merge 됐다고 적용하지 않는다.

## 2. 적용 순서

### S0 — 적용 직전 읽기 전용 재확인

쓰기가 불가능한 읽기만 한다. 아래 여섯 항목이 모두 맞을 때만 S1 로 간다.

| 확인 | 기대 |
|---|---|
| `_prisma_migrations` 장부 | 읽을 수 있다 |
| 활성 미완료 migration (`finished_at IS NULL AND rolled_back_at IS NULL`) | 0 |
| 롤백 이력 (`rolled_back_at IS NOT NULL`) — 별도로 읽어 보고한다 | 0. 다르면 S1 로 가지 않고 보고한다 |
| `0031_signup_funnel_daily` | 장부에 **없다**(미적용) |
| `SignupFunnelDaily` 표 | **존재하지 않는다** |
| 대상 DB | 이번 적용을 승인받은 그 DB 다 (Production·Preview 연결을 이 시점에 다시 확인) |

읽는 방법 예 — 서버가 쓰기를 거부하는 트랜잭션 안에서만 읽는다:

```
BEGIN TRANSACTION READ ONLY;
SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at;

SELECT count(*) AS unfinished_count
FROM _prisma_migrations
WHERE finished_at IS NULL AND rolled_back_at IS NULL;

SELECT count(*) AS rolled_back_count
FROM _prisma_migrations
WHERE rolled_back_at IS NOT NULL;

SELECT to_regclass('public."SignupFunnelDaily"');
ROLLBACK;
```

하나라도 기대와 다르면 적용하지 않고 보고한다.

### S1 — 적용 (별도 승인 뒤)

별도 승인 뒤, PR-M 이 merge 된 **main** 에서 정식 명령 **한 번만** 쓴다.

```
npx prisma migrate deploy
```

🔴 금지 — migration 장부와 승인된 적용 순서를 우회한다:

- `prisma db push`
- `prisma migrate dev`
- `prisma migrate resolve`
- `prisma db execute` 로 이 SQL 을 직접 돌리기
- `_prisma_migrations` 장부를 SQL 로 직접 수정

### S2 — 적용 후 읽기 전용 확인

| 확인 | 기대 |
|---|---|
| `_prisma_migrations` 의 `0031_signup_funnel_daily` | `finished_at` 있음 · `rolled_back_at` 없음 |
| 표 | `SignupFunnelDaily` 존재 · 행 0 |
| 열 (`information_schema.columns`) | 정확히 6개 — 이름 · 타입 · NOT NULL · `count` 기본값 0 이 §0 과 같다 |
| 기본키 (`information_schema.table_constraints` · `key_column_usage`) | `SignupFunnelDaily_pkey` = (`day`,`step`,`contentType`,`entryPoint`) 순서 |
| FK | 0 |
| 인덱스 (`pg_indexes`) | `SignupFunnelDaily_pkey` 를 받치는 PK index 1개는 정상. 그 밖의 별도 index 0 |

## 3. 복구

| 상황 | 할 일 |
|---|---|
| PR-M 만 merge, S1 전 | 앱 변경 0. 필요하면 PR-M 을 revert 한다 |
| S1 뒤, PR-A 전 | 그대로 둔다. 기존 코드는 새 표를 쓰지 않는다 |
| PR-A 를 되돌린다 | PR-A revert 만. 표와 행은 그대로 둔다(익명 집계 · 최소 24개월 보존, 회원가입 전환 영역 정본 §8-8) |
| 표를 없애야 한다 | 새 migration 으로 처리한다. `_prisma_migrations` 를 SQL 로 건드리지 않는다 |

🔴 **적용 뒤 `migration.sql` 을 수정하지 않는다.** 장부의 checksum 과 어긋난다. 바꿀 것이 있으면 새 migration 이다.

## 4. 알아 둘 것

- 행 수 상한은 하루 최대 10행(5단계 × 2유형 × 1출입구)이다. 별도 인덱스가 필요 없다.
- 이 표를 읽고 쓰는 코드는 회원가입 전환 영역 정본 §8-7 gate(`VERCEL_ENV === 'production'` · 유효한 `SIGNUP_FUNNEL_COLLECTION_START` ·
  오늘 ≥ 시작일)가 활성일 때만 DB 에 접근한다. 표가 생겨도 gate 가 꺼져 있으면 쓰기·읽기 0 이다.
- `SIGNUP_FUNNEL_COLLECTION_START` 추가는 MC-M5 별도 승인이다. 이 migration 과 같은 단계가 아니다.
- 자동 삭제 job 은 만들지 않는다(회원가입 전환 영역 정본 §8-8).
