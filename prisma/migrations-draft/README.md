# migration 초안 — 🔴 **여기 있는 것은 아직 적용하지 않는다**

`prisma/migrations/` 가 아니라 여기 두는 이유는 하나다.

🔴 **활성 schema 에 컬럼을 올려 두고 DB 에 적용하지 않으면 배포가 깨진다.**

Prisma 의 `create()` 는 `select` 를 주지 않으면 **모든 스칼라 필드를 돌려준다.**
그러면 `RETURNING` 에 없는 컬럼이 들어가고 그 자리에서 죽는다.
실측(2026-09-17) — `scripts/micro-seed-import-82cook-live.mts` 의 `create()` 두 곳이
`select` 없이 부른다. 읽기 질의는 전부 `select` 를 주고 있어 안전하지만, 그 둘이 남는다.

그래서 **schema 변경과 migration 적용은 같은 작업으로 묶는다.** 나눠 내보내지 않는다.

## 적용 절차 (별도 작업)

```
① prisma/schema.prisma 에 컬럼을 더한다
② 이 디렉터리의 회차를 prisma/migrations/ 로 옮긴다
③ migration 을 실제 DB 에 적용한다
④ 그 다음에야 적재 코드가 새 컬럼에 쓴다
```

세 번째까지 끝나기 전에 네 번째를 하지 않는다.

## 지금 상태

| 회차 | 무엇 | 짝이 되는 파일 산출물 |
|---|---|---|
| `0026_raw_content_source_times` | `MicroSeedRawContent` 에 `sourcePostedAt` · `sourceListedAt` | 🟢 **이미 흐르고 있다** — thin → adapt → 후보 파일 |
| `0027_operator_composer` | `OperatorWriter` · `OperatorWriteLog` 표 · `Post`/`Comment` 에 `operatorWriterId` · `CommentOrigin.OPERATOR` | 🔴 **아직 흐르지 않는다** — 적용 전까지 `/admin/compose` 는 작성자 0명으로 뜬다 |

### `0027_operator_composer` 를 적용할 때

🔴 **schema 변경이 같은 PR 에 들어 있다.** 위 절차의 ①은 끝나 있고 ②③이 남았다.
`prisma/migrations/0027_operator_composer/` 로 옮겨 적용한 **뒤에** merge 한다.

🔴 **기존 행을 건드리지 않는다.** 더하는 컬럼은 전부 NULL 허용·기본값 없음이라
Postgres 가 표를 재작성하지 않고, 백필도 없다. NULL = "운영 직접 작성이 아니다" 이고
기존 글·댓글은 전부 그쪽이 맞다.

🔴 **`ALTER TYPE ... ADD VALUE` 는 되돌릴 수 없다.** Postgres 는 enum label 삭제를
지원하지 않는다. 롤백이 필요하면 표·컬럼만 되돌리고 `OPERATOR` label 은 남겨 둔다 —
남아 있어도 쓰는 코드가 없으면 아무 일도 일어나지 않는다.

🔴 파일 경로의 시각 전달은 **이 초안과 무관하게 이미 동작한다.** DB 저장만 미뤄져 있다.
