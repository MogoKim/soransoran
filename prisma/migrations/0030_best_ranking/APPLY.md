# 0030 적용·배포·복구 — 🔴 이 순서를 지킨다

> 이 문서는 **실측 결과**다(2026-09-28). 격리 Postgres 17(127.0.0.1 · 운영과 완전 분리)에서 확인했고,
> 운영 DB 는 `BEGIN TRANSACTION READ ONLY` 안의 SELECT 로만 읽었다. 운영 write 0.

## 0. 무엇을 바꾸는가

| 대상 | 변경 |
|---|---|
| `Post` | `bestRankScore DOUBLE PRECISION NOT NULL DEFAULT epoch(now)` · `bestReactionWeight INTEGER NOT NULL DEFAULT 0` |
| `Post` 기존 행 | `bestRankScore = epoch(createdAt)` 로 한 번 채운다(실반응 기여는 backfill 이 채운다) |
| `BestSelection` | 새 표. PK=postId, FK → Post **CASCADE** |
| 인덱스 | `Post(status, isMicroSeed, indexPromotionBlocked, bestRankScore DESC, id DESC)` · `BestSelection(firstEnteredAt DESC, postId DESC)` |

0028(StageDecision)·0029(AutoReadyAudit · 큐→Post FK)와 **표·칼럼이 겹치지 않는다**.

## 1. 운영 상태 — 2026-09-28 읽기 전용 실측

| 항목 | 값 |
|---|---|
| `_prisma_migrations` | 29 행 · 미완료 0 · 롤백 0 |
| `0028_stage_decision` · `0029_auto_ready_audit` | **2026-09-26 적용 완료** |
| `StageDecision` · `AutoReadyAudit` 표 · 큐→Post FK | 존재 |
| `BestSelection` · `Post.bestRankScore` | 없음(0030 미적용) |

→ main 에 0030 이 들어간 뒤의 정식 `npx prisma migrate deploy` 는 **0030 하나만** 적용한다.
🔴 이 값은 스냅샷이다. 적용 직전에 §3 S0 으로 다시 읽는다.

읽는 방법(쓰기 불가를 서버가 보장한다):
```
psql "$DIRECT_URL" -X <<'SQL'
BEGIN TRANSACTION READ ONLY;
SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at;
ROLLBACK;
SQL
```
`npx prisma migrate status` 도 읽기만 한다(격리 DB `log_statement=all` 실측: SELECT 5 · 쓰기 0).

## 2. 무엇이 언제 깨지는가 — 실측

| 조합 | 결과 |
|---|---|
| **새 schema client × 0030 미적용 DB** | 🔴 발행 `post.create`(select 있음 — D100 포함) · 공감 · 댓글 · /best 실패 |
| **옛 코드 × 0030 적용 DB** | 🟢 `post.create`(select 있음·없음) · 목록 · 공감 · 홈 · /best · 게시판 · 매거진 200 |
| migration 파일만 있고 schema 는 옛 것(PR-M 트리) | 🟢 validate · generate · typecheck · build · CI 격리 DB 검사 5종 통과 |

→ 새 schema client 가 옛 DB 를 만나는 구간을 **구조적으로** 만들지 않는 것이 이 문서의 목적이다.

## 3. 순서 — PR 세 개

🔴 **적용 명령은 정식 `npx prisma migrate deploy` 하나다.**
   `prisma db execute` · `prisma migrate resolve` · `prisma db push` 는 쓰지 않는다 —
   migration 장부(`_prisma_migrations`)와 정본 순서를 우회한다.
🔴 **PR-M 이 merge 돼도 운영 `migrate deploy` 는 별도 승인 전에 돌리지 않는다.** merge 는 파일 등록일 뿐이다.

```
PR-M  0030 migration 등록만 (이 폴더 두 파일). schema.prisma · 앱 코드 변경 0
      → 운영 앱 동작 변경 0. Preview 도 옛 코드라 옛 DB 에서 그대로 돈다
S0    적용 직전 읽기 전용 확인(§1) — 미적용이 0030 하나뿐인지
S1    PR-M merge 뒤 main 에서 정식 적용    npx prisma migrate deploy
      → S0 과 같은 방법으로 0030 finished · 표·칼럼 존재를 읽어 확인
PR-A  schema.prisma + 랭킹 writer + backfill 도구. /best 화면은 옛 동작 그대로
      🔴 S1 확인 뒤에만 push 한다 — Preview 는 운영 DB 를 공유한다
S2    PR-A merge → writer 가 공감·댓글·노출 변경마다 순위 키·기록을 유지
S3    backfill   npm run best:backfill                          # dry-run
                 npm run best:backfill -- --apply --remote-ok  # 쓴다
                 npm run best:backfill -- --apply --remote-ok  # 두 번째 "쓰기 합계 = 0"
                 → 순위 키가 바뀐 글 수 · BestSelection 행 수를 읽기 전용으로 확인
PR-B  /best 화면 전환 · 옛 /best 코드 제거 (backfill 확인 뒤)
```

🔴 S1 과 PR-A 사이에는 DB 가 schema 보다 한 회차 앞선다. 이 구간에 `prisma migrate dev` · `db push` 를
   돌리면 0030 객체를 지우려 한다 — 두 명령은 원래 금지다(CLAUDE.md). `prisma migrate diff` 가
   0030 객체 DROP 을 보여주는 것은 이 구간의 정상 모습이다.
🔴 PR-M merge 뒤 `migration.sql` 은 고치지 않는다 — 적용 뒤 바뀌면 Prisma 체크섬이 어긋난다.
   이 문서(APPLY.md)는 체크섬 대상이 아니다.

## 4. 복구

| 상황 | 할 일 |
|---|---|
| PR-M 만 merge, S1 전 | 되돌릴 것 없음(앱 변경 0). 필요하면 PR-M revert |
| S1 뒤, PR-A 전 | 그대로 둔다(옛 코드 × 0030 DB 안전) |
| PR-A 되돌림 | revert 만. DB 는 그대로. 순위 키 갱신이 멈춘다 → 다시 배포한 뒤 S3 한 번 더 |
| PR-B 되돌림 | revert 만. 옛 /best 가 돌아온다. writer·DB 는 그대로 |
| 계수를 바꾼다 | `src/lib/best-ranking.ts` 숫자와 `BEST_POLICY_VERSION` 만 바꾸고 S3. schema 변경 없음 |
| 표를 없애야 한다 | 새 migration 으로 DROP. `_prisma_migrations` 를 SQL 로 건드리지 않는다 |

## 5. 알아 둘 것

- 순위 갱신은 `Post.updatedAt` 을 **움직이지 않는다**(격리 DB 실측). 이 값은 sitemap `lastModified` 와
  어드민 "수정" 시각 — 글 내용이 바뀐 때다. 순위 쪽은 읽은 updatedAt 이 그대로일 때만 조건부로 잠그고
  그 값을 다시 쓴다(`best-ranking-db.ts` lockPost). 회원·비회원 댓글, 댓글 삭제·숨김, backfill 은
  updatedAt 을 바꾸지 않고, 실제 글 수정과 경합해도 수정 시각이 이긴다.
- 🔴 이번 작업과 별개로 **기존 경로**는 여전히 updatedAt 을 움직인다: 공감(`likeCount` 증감)과
  조회(`/api/view` 의 `viewCount` 증가). 그 동작은 이 회차가 바꾸지 않았다.
- backfill 은 과거 12위 진입을 재현하지 않는다. 기록은 **S3 시점의 12개 중 실반응 글**만, 그 시각으로 만든다.
- 격리 DB 검증: `npm run best:db-check`(DB 이름 soran_test) · 순수 식: `npm run check:best`.
