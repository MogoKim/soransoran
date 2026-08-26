# Micro Seed M1 운영 runbook

> 정본: [`docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md`](../constitution/MICRO_SEED_LANE_CONSTITUTION.md)
> 작성: 2026-08-26 · 첫 발행 4건으로 검증된 루프를 인수인계·장애대응용으로 남긴다.
>
> 🔴 **이 문서는 코드가 아니다.** 값과 절차는 실측으로 확인한 것이지만, 판정의 정본은 항상
> fixture 와 소스다. 문서와 코드가 어긋나면 **코드를 믿고 이 문서를 고친다.**

---

## 1. 현재 완료 상태 (2026-08-26 실측)

```
Candidate 4 · RawContent 4 · Post 4 · History 4 · divergence 0
Sheet 5행 (헤더 + 4건) · row2~row5 전부 PUBLISHED
```

| Sheet | 출처 | Post | 본문 | 제목 |
|---|---|---|---|---|
| row2 | `navercafe:remonterrace:34783204` | `cmt8o4ba7…` | 137자 | 대딩이 첫알바 도시락 |
| row3 | `82cook:4231968` | `cmt96c62b…` | 566자 | 물로만 세안 3개월이 지났어요. |
| row4 | `82cook:4231985` | `cmt9cegg1…` | 1071자 | 턱관절치과 다녀온후.. |
| row5 | `82cook:4231976` | `cmt9dh2sz…` | 236자 | 항공과 승무원 학원 |

**§12-0 완료 조건** — 4건 모두 확인:

| 축 | 결과 |
|---|---|
| 커뮤니티 노출 | `/community/free` 목록에 **4건 전부** · 상세 HTTP 200 |
| 검색 색인 | `<meta name="robots" content="noindex, follow">` |
| sitemap | 11개 URL 중 Micro Seed **0건** |
| 원장 정합 | `recover-live` divergence **0** |

> row2 는 사람이 Sheet 17열을 손으로 채웠다. **row3~row5 는 사람이 Sheet 에 한 글자도 입력하지 않았다** —
> 82cook 수집 → 상세 fetch → importer 적재까지 코드가 했고, 창업자는 승인만 했다.

---

## 2. 운영 절차

### 한 번에 보기

| # | 명령 | 주체 | write |
|---|---|---|---|
| 1 | `micro-seed:collect-82cook -- --list --pages=N --live` | 🤖 | 로컬 JSONL |
| 2 | (목록 검토 · 후보 선택) | 🧑 | — |
| 3 | `micro-seed:collect-82cook -- --fetch=<num> --live --from=<list>` | 🤖 | 로컬 JSONL |
| 4 | `micro-seed:import-82cook -- --sourceArticleId=<num>` | 🤖 | **0** (dry-run) |
| 5 | `micro-seed:import-82cook -- --sourceArticleId=<num> --apply --limit=1` | 🧑 승인 | DB 2행 + Sheet 1행 |
| 6 | Sheet B열 `HOLD → PENDING` | 🧑 **창업자** | Sheet 1셀 |
| 7 | `micro-seed:sync-approval-live` | 🤖 | DB status |
| 8 | `micro-seed:publish-live -- --dry-run` | 🤖 | **0** |
| 9 | `micro-seed:publish-live -- --limit=1` | 🧑 승인 | Post + DB + Sheet |
| 10 | §12-0 확인 · `micro-seed:recover-live` | 🤖 | **0** (dry-run 기본) |

### 실제 소요 (4번째 발행 실측)

```
적재        09:33:42
승인+sync   09:34:13 → 09:34:27   14초
예약 대기   09:34:48 → 09:45:16   약 10분   ← 예약 09:45 (적재 +8분, 5분 올림)
발행        09:45:24
────────────────────────────────────────
총          11분 52초
```

### 단계별 상세

**1. 목록 수집** — 공개 목록만. robots.txt 를 매 실행 확인하고 대상이 하나라도 막히면 `exit 1`.
```bash
SORAN_82COOK_COLLECT_ENABLED=true npm run micro-seed:collect-82cook -- --list --pages=1 --live
```
kill switch(`SORAN_82COOK_COLLECT_ENABLED=true`)와 `--live` 가 **둘 다** 있어야 네트워크를 탄다.

**2. 후보 선택** — 목록에는 본문이 없다. 제목·댓글수로 고른다.
실측(25건): 정치·실명 소재 **24%** · 댓글 0건 **44%**. → §5 한계 참조.

**3. 상세 fetch** — 고른 것만 연다. 댓글 본문·이미지는 수집하지 않는다.
```bash
SORAN_82COOK_COLLECT_ENABLED=true npm run micro-seed:collect-82cook -- \
  --fetch=4231985 --live --from=./.microseed-data/82cook.list.jsonl
```

**4~5. 적재** — dry-run 이 기본. 실제 write 는 `--apply` **와** `--limit=1` 이 둘 다 필요하다.
```bash
npm run micro-seed:import-82cook -- --sourceArticleId=4231985                      # 확인
npm run micro-seed:import-82cook -- --sourceArticleId=4231985 --apply --limit=1    # 적재
```
- `RawContent(origin=live)` + `Candidate(HOLD)` 한 트랜잭션 · Sheet A:Q 1행(`bootstrap`)
- 예약 제안값이 함께 들어간다 — 기본 **적재 +8분, 5분 올림**. `--in=<분>` 으로 조정, `--no-schedule` 로 비움
- 🔴 **예약은 제안값이다.** 창업자가 Sheet F열에서 고칠 수 있다
- 멱등: DB(`dedupKey` · `sourceSite`+`sourceArticleId`)와 Sheet(`dedupKey`)를 **쓰기 전에** 본다

**6~7. 승인** — Sheet B열이 정본이고, `sync-approval-live` 가 DB로 옮긴다.
```bash
npm run micro-seed:sync-approval-live
```
승격 조건: `Sheet=PENDING` · `DB=HOLD` · `createdPostId` 없음(R9) · `dedupKey` 일치(R11) · 편집칸 유효 · **예약이 미래**(R5).
과거 예약이면 승격하지 않고 사유를 출력한다 — **시각을 자동으로 밀지 않는다**(정책 21).

**8~9. 발행** — 예약 도래 후 **30분 유예창** 안에서만.
```bash
npm run micro-seed:publish-live -- --dry-run      # IN_WINDOW / DRY_RUN_WOULD_PUBLISH 확인
npm run micro-seed:publish-live -- --limit=1      # 발행
```
획득(PENDING→PROCESSING) 후 **재판정**한다 — dry-run 결과를 신뢰하지 않는다.
`Post → Candidate → History` 한 트랜잭션, 그 뒤 Sheet 역기록.

**10. 정합 확인**
```bash
npm run micro-seed:recover-live              # 진단만 (기본)
npm run micro-seed:recover-live -- --apply   # 복구 (명시 필요)
```

### 보조 명령

| 명령 | 용도 |
|---|---|
| `micro-seed:reschedule-live -- --candidate=<id> --in=20` | 예약을 다시 민다. 과거로는 못 민다 |
| `micro-seed:dry-run-live` | Sheet 전체 판정. 발행 대기가 아닌 행은 `판정 제외`로 뺀다 |
| `micro-seed:inventory` | live Sheet 를 세기만 한다 |

### fixture (네트워크·DB 없이)

| 명령 | 건수 | 대상 |
|---|---|---|
| `micro-seed:read` | 65 | 17열 · 매핑 · validator 연결 · Sheet write 계약 |
| `micro-seed:plan` | 58 | R1~R11 · G-A/G-B · write-guard · publisher/recover 소스 계약 |
| `micro-seed:validate` | 29 | 규칙 단건 |
| `micro-seed:plan-wiring` | 17 | 원장 주입 |
| `micro-seed:collect-check` | 17 | 82cook 수집·적재 계약 |

---

## 3. 안전장치

### 스코프 — read 와 write 를 나눈다

| 경로 | 스코프 |
|---|---|
| `createGoogleSheetSource` (읽기) | `spreadsheets.readonly` |
| `updateCandidateRow` (쓰기) | `spreadsheets` — **write 토큰을 받는 유일한 함수** |

`micro-seed:read` 가드가 **소스를 읽어** 확인한다: read 경로가 write 스코프를 쥐지 않는가 · write 스코프 참조가 1곳뿐인가 · `append` 경로가 없는가.

### Sheet write 는 read-back 이 필수다

`updateCandidateRow` 가 write 직후 같은 범위를 `values:batchGet` 으로 되읽어 **값 단위로 대조**한다.
어긋나면 `SheetWriteNotPersistedError` 로 중단한다.

허용 열은 4개뿐이다(§6-7-A): `status` · `holdReason` · `postUrl` · `updatedBySystemAt`.
창업자 편집 칸(`board`·`founderTitle`·`scheduledPublishAt`·`declineReason`)은 `columns` 모드로 쓸 수 없다.

**발행 3종 세트**: `status='PUBLISHED'` ⟺ `postUrl` 있음 AND `updatedBySystemAt` 있음. 한쪽만 오면 거부.

### DB ↔ Sheet 불일치

DB 를 바꾼 **모든** 경로가 Sheet 에도 같은 상태를 남긴다(성공·TOO_LATE·재판정 실패 전부).
Sheet 반영이 실패해도 **DB 를 되돌리지 않는다** — 되돌리면 재승인으로 이중 발행이 된다(§6-3).
대신 불일치를 모아 출력하고 `exit 2` 한다.

```
🔴 DB ↔ Sheet 불일치 N건 — 사람이 Sheet 를 맞춰야 한다
   · <candidateId>
     DB=PUBLISHED · Sheet=(반영 실패)
   DB 가 정본이다.
```

### cap (§6-9-F)

| 상수 | 값 | 비고 |
|---|---|---|
| first-run | 1 | **해제됨** (PUBLISHED 4건) |
| burst | 1 | 1회 실행 1건 |
| soft daily | 3 | 창업자 조정 가능 |
| hard daily | 10 | 🔴 코드 상수 |
| 예약 유예창 | 30분 | 도래 후 이 안에서만 발행 |
| PROCESSING timeout | 30분 | |
| attempt 상한 | 3 | 초과 시 FAILED 고정 |

**R10 은 발행 대기(PENDING)만 센다.** PUBLISHED·SKIPPED·DECLINED·TAKEDOWN·FAILED 와 HOLD 는 세지 않는다 — §4 참조.

### PUBLISHED 는 비가역이다

- R9: 발행 이력이 있으면 `PUBLISHED`·`TAKEDOWN` 외로 되돌리지 못한다
- `recover-live` 는 PUBLISHED 후보를 **조회 단계에서 배제**한다(where + 조회 후 이중 확인)
- publisher 에 `PENDING` 반환 경로가 없다 — 타입과 fixture 로 막는다

### 노출 3축 (C-2)

`isMicroSeed` · `permanentNoindex` · `indexPromotionBlocked` 는 `src/lib/post-visibility.ts` 가 유일한 지점.
`buildMicroSeedPostData` 가 마지막에 펼치고 `assertMicroSeedPostData` 가 `create` 직전 확인한다.
`check:visibility` 가 CI 에서 강제한다.

---

## 4. 장애 대응 — 실제로 일어난 4건

### 4-1. Sheet write 가 성공 응답인데 반영되지 않았다 (2026-08-25)

**증상**: `totalUpdatedCells: 17` + HTTP 200 을 받았는데 시트 값이 이전 상태였다. 창업자가 화면에서 옛 값을 보고 발견했다.
**원인**: **규명되지 않음.**
**현재 상태**: `updateCandidateRow` 에 read-back 을 내장했다. 응답을 성공 근거로 쓰지 않는다.
**재발 시**:
```bash
npm run micro-seed:recover-live          # divergence 목록
npm run micro-seed:read                  # "write 는 read-back 으로 확인된다" 가드
```

### 4-2. PUBLISHED write 가드가 publisher 를 막았다 (2026-08-25, 첫 발행)

**증상**: 첫 발행에서 Post 는 생성됐는데 Sheet 역기록이 `status 를 PUBLISHED 로 쓰지 않는다` 로 거부됐다.
**원인**: publisher 가 없던 시절 만든 가드가, publisher 가 실제로 그 값을 써야 하는 시점에 정당한 write 를 막았다.
**현재 상태**: 계약을 **발행 3종 세트**(`PUBLISHED` ⟺ `postUrl`+`updatedBySystemAt`)로 바꿨다. 막고 싶었던 것은 글자가 아니라 **근거 없는 발행 기록**이었다.
**교훈**: 🔴 **가드를 세울 때 "무엇을 막는가"뿐 아니라 "언제까지 옳은가"를 함께 적는다.**
**재발 시**: `npm run micro-seed:read` — `PUBLISHED + postUrl + updatedBySystemAt → 통과` 외 5종

### 4-3. dry-run-live 가 R10 오탐을 냈다 (2026-08-26)

**증상**: 발행 대기가 1건인데 `REJECT [R10]` — 이미 발행이 끝난 행까지 PASS 로 세었다.
**원인**: `validateCandidate` 는 `wantsPublish = (status === 'PENDING')` 이라 PENDING 이 아닌 행은 게이트를 건너뛰고 "위반 없음 PASS" 가 된다. R10 이 그것을 "발행 예정" 으로 셌다.
**현재 상태**: R10 이 **발행 대기(PENDING)만** 센다. all-or-nothing 제재도 같은 범위. `dry-run-live` 는 발행 대기가 아닌 행을 `판정 제외` 로 빼고 집계만 남긴다.
**재발 시**: `npm run micro-seed:read` — `R10 — PUBLISHED 1건 + PENDING 1건이면 PENDING 은 통과한다` 외 6종
> ⚠️ **publisher 는 이 문제와 무관했다.** DB `status='PENDING'` 만 픽업하므로 정확히 1건만 본다.

### 4-4. 예약 기본값 25분이 과보수였다 (2026-08-26)

**증상**: 기본 제안값 +25분 탓에 발행까지 **28분** 대기. `reschedule --in=5` 로 당겨서야 4분이 됐다.
**원인**: "승인까지 보통 몇 분" 이라는 **가정을 실측 없이 상수로 굳혔다.** 실측은 80초(4번째는 14초)였다.
**현재 상태**: 기본값 **8분**. fixture 에 값을 박아 조용히 바뀌지 않게 했다.
**재발 시**: `npm run micro-seed:collect-check` — `기본 8분 · --in 으로 조정`
> 창업자가 직접 천천히 승인하는 흐름이면 `--in=30` 을 쓴다. 8분은 **Claude 대행 기준**이다.

---

## 5. 남은 한계

### 5-1. 품질 플래그가 없다
목록에는 본문이 없어 제목·댓글수로만 고른다. 실측(25건): **정치·실명 소재 24%** · 댓글 0건 44%.
매번 사람이 눈으로 거른다. → **Q-1 PR 제안**: collect 단계에 플래그(거부 아님) — 댓글수·정치/실명·낚시성·본문 길이·링크 비중.
> 🔴 정치성 **자동 거부는 반대**한다. 경계 사례에서 오탐이 나고, 조용히 버려진 글은 아무도 모른다.

### 5-2. 승인 전용 명령이 없다
Sheet B열 `HOLD→PENDING` 은 창업자 편집 칸이라 의도적으로 명령이 없다.
실제 운영에서는 Claude 가 임시 스크립트(`columns` 모드 · `status` 셀만)로 대행했다.
원격 승인이 필요해지면 전용 경로를 설계해야 한다.

### 5-3. 네이버 카페는 판단이 필요하다
우나어 크롤러는 **창업자 개인 Chrome 프로필의 로그인 쿠키**(`NID_AUT`/`NID_SES`)로 회원 전용 글을 읽는다.
soransoran 은 그 경로를 들이지 않았다. row2 는 창업자가 본문을 직접 제공했다.
자동 수집하려면 이용약관·개인 자격증명 문제를 먼저 정리해야 한다.

### 5-4. Voice Engine 미착수
§12 마일스톤의 Raw / Derived / Publishing Input 3계층 자산화(M5)는 시작하지 않았다.
현재는 M2 가 필요로 하는 최소본(`MicroSeedRawContent`)만 있다.

### 5-5. 그 밖에
- **자동화 없음** — §6-9-F 확정 정책. cron·workflow 를 붙이지 않았다
- `dry-run-live` 는 `FAILED` 행을 `판정 제외` 로 빼지만, 그 판정이 무의미하다는 표시일 뿐 복구는 하지 않는다
- `tsconfig.json` 은 `scripts` 를 exclude 한다 — `.mts` 는 `typecheck:ops` 로 따로 본다

---

## 6. 자주 쓰는 확인 명령

```bash
# 원장 상태
npm run micro-seed:recover-live                    # divergence
npm run micro-seed:dry-run-live                    # Sheet 전체 판정

# 게이트가 살아 있는가
npm run micro-seed:read && npm run micro-seed:plan && \
npm run micro-seed:validate && npm run micro-seed:plan-wiring && \
npm run micro-seed:collect-check

# 타입 · 빌드
npm run typecheck && npm run typecheck:ops && npm run build && npm run check:visibility
```
