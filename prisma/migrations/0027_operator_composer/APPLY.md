# 0027 적용·merge·배포·복구 — 🔴 이 순서를 지킨다

> 🔴 이 회차는 **정식 이력(`prisma/migrations/`)에 들어와 있다.**
> `migrations-draft/` 에서 옮겨 왔고, 적용은 `prisma migrate deploy` 하나로 한다.

이 문서는 **실측 결과**다. 추정이 아니다.
격리 Postgres 17(`127.0.0.1:54329` · 운영과 완전히 분리)에서
0001~0025 를 올린 DB 와 0027 까지 올린 DB 두 개를 만들어 양방향으로 확인했다.

---

## 1. 무엇이 언제 깨지는가 — 실측

### ① 새 코드 × 0027 **미적용** DB  ← merge 만 하고 적용을 건너뛴 경우

| 경로 | 결과 |
|---|---|
| 게시판 목록 · 댓글 목록 · 회원 조회 (**고객 화면**) | 🟢 **돈다** |
| `REAL_MEMBER_WHERE` 를 쓰는 어드민 (회원·신고·운영 홈) | 🔴 `OperatorWriter does not exist` |
| 페르소나 관제실의 실회원 수 | 🔴 같은 이유 |
| `/admin/compose` 전체 | 🔴 같은 이유 |
| **자동 댓글 대상 수집** (`operatorWriterId` select) | 🔴 `Post.operatorWriterId does not exist` |

🔴 **고객 화면은 멀쩡하다.** 깨지는 것은 어드민과 **자동 댓글 레인**이다.
자동 레인이 포함된다는 점이 중요하다 — 사람이 화면을 안 보는 시간에 조용히 멈춘다.

### ② 구버전 코드 × 0027 **적용된** DB  ← 적용 후 배포 전 / 코드만 롤백한 경우

| 경로 | 결과 |
|---|---|
| `select` 없는 `post.create()` · `comment.create()` | 🟢 **돈다** (draft README 가 지목한 모양) |
| 구버전 회원 집계 · 글 목록 조회 | 🟢 돈다 |
| 댓글 목록 (**고객 화면 모양** — `commentOrigin` 을 select 하지 않는다) | 🟢 **돈다** |
| 댓글 조회 중 **`commentOrigin` 을 select 하는** 경로 | 🔴 `Value 'OPERATOR' not found in enum 'CommentOrigin'` |

🔴 **적용만 하고 배포 전인 동안은 완전히 안전하다.** 그때는 `OPERATOR` 행이 하나도 없다 —
그 값을 만들 수 있는 것은 새 코드뿐이다. label 이 DB 에 존재하는 것 자체는 무해하다.

🔴 **위험은 롤백이다.** 창업자가 운영 댓글을 한 건이라도 쓴 뒤 구버전으로 되돌리면,
`commentOrigin` 을 읽는 경로가 깨진다. 실측으로 그 경로는 **자동 댓글 레인뿐**이다
(`persona-publish-tx` · `persona-comment-source-db` · persona runner/health/plan/queue 스크립트).
**고객 화면은 이 필드를 한 번도 읽지 않는다.**

---

## 2. 정식 이력에 들어온 시점

🔴 **적용하는 작업에서 옮겼다.** `migrations-draft/` 에 두었던 이유는 "아직 DB 에 없다" 는
사실을 파일 위치로 말하기 위해서였고, 그 상태가 끝났으므로 정식 이력으로 옮겼다.

🔴 **SQL 을 psql 로 직접 붙여 넣지 않는다.** 그러면 `_prisma_migrations` 에 기록이 남지 않아
다음 `migrate deploy` 가 drift 로 막히거나 같은 SQL 을 다시 실행한다.
격리 DB 에서 아래 순서가 그대로 도는 것을 확인했다.

---

## 3. 순서 — 🔴 ③ 이 끝나기 전에 ④ 를 하지 않는다

```
① npx prisma migrate status         # 🔴 미적용이 0027 하나인지 먼저 본다
② npx prisma migrate deploy         # 운영 DB. 표·컬럼·enum 이 생기고 이력에 기록된다
③ 확인:
     select count(*) from "OperatorWriter";                      -- 0 (표가 있다)
     select migration_name, finished_at from _prisma_migrations
       where migration_name = '0027_operator_composer';          -- 1행 · finished_at 있음
④ PR #535 merge → 배포
⑤ 배포 후 /admin/compose 가 "작성자 0명" 으로 뜨는지 확인 (정상이다)
⑥ 운영용 닉네임 적재 — 별도 승인 절차
```

🔴 **①에서 0027 말고 다른 미적용이 보이면 멈춘다.** 이 문서는 0027 **하나**를 적용하는
절차이고, 밀려 있던 다른 회차가 같이 나가면 무엇이 무엇을 깨뜨렸는지 가릴 수 없다.

**②는 기존 행을 건드리지 않는다.** 더하는 컬럼은 전부 NULL 허용·기본값 없음이라
Postgres 가 표를 재작성하지 않고, 백필도 없다. 락 시간은 메타데이터 변경 수준이다.

---

## 4. 실패하면 — 단계별 복구

### ② 에서 실패했다 (migration 이 도중에 멈췄다)

🔴 **아무것도 지우지 말고 먼저 상태를 본다.** 실패한 migration 을 자동으로 치우고
다시 돌리는 절차를 만들지 않는다 — 한 번 잘못 치우면 무엇이 남았는지 알 수 없어진다.

```
npx prisma migrate status            # 무엇이 실패로 기록돼 있는지
psql "$DATABASE_URL" -c "\dt"        # 표가 어디까지 생겼는지
```

**그 결과를 창업자에게 보고한 뒤**에 아래 중 하나를 고른다.
🔴 **아직 merge 전이므로 운영 코드는 옛 코드다.** 새 표가 있든 없든 옛 코드는 돈다(§1-②).
서두를 이유가 없다 — 판단할 시간이 있다.

#### 복구는 Prisma 정식 경로로 한다 (`prisma@6.19.3`)

🔴 **`_prisma_migrations` 를 직접 건드리지 않는다.** SQL 로 그 표의 행을 지우면
Prisma 가 아는 이력과 실제가 갈라지고, 그 어긋남은 다음 배포에서야 드러난다.
그 표를 고치는 정식 수단은 `prisma migrate resolve` 하나다.

```
# (가) 실패한 회차가 DB 에 아무 흔적도 남기지 않았다
#      → 되돌린 것으로 기록하고, 원인을 고친 뒤 다시 deploy
npx prisma migrate resolve --rolled-back 0027_operator_composer
npx prisma migrate deploy

# (나) 실패로 기록됐지만 실제로는 SQL 이 전부 반영돼 있다 (사람이 확인한 경우에만)
#      → 적용된 것으로 기록한다
npx prisma migrate resolve --applied 0027_operator_composer
```

🔴 **(가) 를 쓰기 전에 DB 를 실제로 원래대로 되돌려 놓아야 한다.**
`--rolled-back` 은 *"되돌렸다고 기록만"* 하는 명령이지 스스로 되돌리지 않는다.
일부만 생긴 상태라면 §4-되돌리기로 정리한 **뒤에** 이 명령을 쓴다.

🔴 `migrate reset` · `db push` 는 쓰지 않는다. 운영 DB 에서 그 둘은 데이터를 지운다.

### ④ 이후 배포한 코드에 문제가 있다 — 🔴 여기가 유일하게 까다롭다

```
운영 댓글이 아직 0건인가?
  예 → 코드만 롤백하면 된다. DB 는 그대로 두어도 무해하다
  아니오 → 🔴 코드만 롤백하면 자동 댓글 레인이 깨진다 (§1-②)
```

#### 🔴 kill switch 로는 막지 못한다 — 실제 경로를 따라가 확인했다

처음에 이 문서는 *"kill switch 를 켜면 깨질 경로가 돌지 않는다"* 고 적었다. **틀렸다.**
코드를 읽어 보면 `commentOrigin` 조회가 kill switch 판정보다 **먼저** 있다.

| 경로 | 순서 |
|---|---|
| `scripts/persona-comment-runner.mts` | 44행에서 `commentOrigin` 을 읽고, **54행**에서야 kill switch 를 본다 |
| `src/lib/persona-publish-tx.ts` | 228행에서 읽고, 판정(`judgeReadiness`)은 259행 뒤다 |

즉 kill switch 를 켜 두어도 그 **조회 자체가 먼저 터진다.**
결과적으로 자동 발행은 어느 쪽이든 멈추므로 **잘못된 글이 나가지는 않는다**(fail-closed).
다만 "깔끔히 멈춤" 이 아니라 **"회차가 오류로 죽음"** 이고, runner 는 매 회차 같은 곳에서 죽는다.

#### 그래서 이렇게 한다

```
(가) 🔴 **가능하면 롤백하지 않고 앞으로 고친다.**
      운영 댓글이 있는 상태의 코드 롤백은 자동 댓글 레인을 반드시 멈춘다.

(나) 꼭 롤백해야 한다면 — **runner 를 먼저 내린다.**
      launchd 잡 / workflow 를 멈춰 매 회차 죽는 상태를 만들지 않는다.
      kill switch 도 함께 켜 둔다 — 그 쿼리는 못 막지만, 코드를 되돌린 뒤
      다시 켤 때 발행이 바로 나가지 않게 하는 안전장치로는 여전히 유효하다.

(다) 🔴 `commentOrigin` 을 'MEMBER' 로 바꾸지 않는다.
      실회원 댓글로 둔갑해 30% 비율의 분모가 부푼다 — 지금 막고 있는 바로 그 일이다.
      `isDeleted=true` 로도 부족하다(그 행도 조회에 딸려 온다).
      정말 지워야 한다면 delete 이고, 그 전에 감사 기록(OperatorWriteLog)을 남긴다.
```

🔴 **고객 화면은 어느 경우에도 정상이다.** `commentOrigin` 을 읽는 곳은 위 자동 레인뿐이다.

🔴 **enum label 은 되돌릴 수 없다.** Postgres 는 `ALTER TYPE ... DROP VALUE` 를 지원하지 않는다.
남아 있어도 쓰는 코드가 없으면 아무 일도 일어나지 않는다 — 지우려 애쓰지 않는다.

### §4-되돌리기 — 표·컬럼만 (enum 은 남는다)

🔴 **자동으로 돌리지 않는다.** 사람이 상태를 보고 판단한 뒤 손으로 실행한다.

```sql
ALTER TABLE "Post"    DROP CONSTRAINT IF EXISTS "Post_operatorWriterId_fkey";
ALTER TABLE "Comment" DROP CONSTRAINT IF EXISTS "Comment_operatorWriterId_fkey";
DROP INDEX IF EXISTS "Post_operatorWriterId_createdAt_idx";
DROP INDEX IF EXISTS "Comment_operatorWriterId_createdAt_idx";
ALTER TABLE "Post"    DROP COLUMN IF EXISTS "operatorWriterId";
ALTER TABLE "Comment" DROP COLUMN IF EXISTS "operatorWriterId";
DROP TABLE IF EXISTS "OperatorWriteLog";
DROP TABLE IF EXISTS "OperatorWriter";
DROP TYPE  IF EXISTS "OperatorWriteKind";
DROP TYPE  IF EXISTS "OperatorWriteAction";
DROP TYPE  IF EXISTS "OperatorWriterStatus";
-- 🔴 "CommentOrigin" 의 'OPERATOR' 는 지울 수 없다. 남겨 둔다.
--
-- 🔴 **이력 표(_prisma_migrations)는 이 SQL 로 건드리지 않는다.**
--    위 DDL 로 DB 를 되돌린 **뒤**, 이력은 Prisma 정식 명령으로만 맞춘다:
--      npx prisma migrate resolve --rolled-back 0027_operator_composer
```

🔴 **운영 글·댓글이 하나라도 있으면 컬럼 DROP 은 그 연결을 영구히 잃는다.**
되돌리기는 **운영 콘텐츠가 0건일 때만** 쓴다.

---

## 5. 운영용 닉네임 — 적재에 필요한 것

🔴 **이 PR 은 닉네임을 하나도 만들지 않았다.** 창업자가 정한 뒤 별도 승인으로 넣는다.
적재 전까지 `/admin/compose` 는 *"아직 운영용 작성자가 없습니다"* 로 뜬다.

한 사람당 필요한 값은 셋뿐이다.

| 항목 | 예 | 규칙 |
|---|---|---|
| `code` | `OP01` | 내부 코드 · 고객에게 보이지 않는다 · 자동 Persona 의 `P01` 과 겹치지 않게 `OP` 접두사 |
| 닉네임 | `봄날의정원` | 🔴 **고객에게 보이는 유일한 이름** (`User.nickname`) · 전체에서 겹치면 안 된다 |
| `note` | `50대 초반 · 수도권 · 담담한 말투` | 선택 · 운영자가 자기에게 남기는 메모 · 고객에게 나가지 않는다 |

적재는 `User` 1행 + `OperatorWriter` 1행이다. 🔴 그 `User` 에 **Account(로그인 수단)를
붙이지 않는다** — 붙는 순간 실회원으로 판정되어 쓰기가 막히고(설계대로), 회원 수에도 섞인다.

닉네임은 회원 닉네임과 같은 규칙을 지킨다 — "시니어·어르신·노인·실버" 는 쓰지 않는다.

---

## 6. 이 문서의 근거를 다시 만들려면

실측을 되풀이할 수 있게 절차를 코드로 남겨 두었다.

```
scripts/operator-compose-db-check.mts   격리 Postgres 세우는 법이 파일 머리에 있다
npm run operator:compose-db-check       실제 트랜잭션 44건 (🔴 CI 에는 넣지 않는다 — DB 가 필요하다)
npm run operator:compose-check          순수 판정 82건 (CI 필수 단계)
```

🔴 `operator:compose-db-check` 는 `DATABASE_URL` 이 격리 주소가 아니면 **즉시 멈춘다.**
Preview 도 운영 DB 를 공유하므로 그쪽에서 돌리지 않는다.
