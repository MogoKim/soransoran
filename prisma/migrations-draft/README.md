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

🔴 파일 경로의 시각 전달은 **이 초안과 무관하게 이미 동작한다.** DB 저장만 미뤄져 있다.
