# 매거진 자동화 운영 runbook

작성 2026-09-15 · 대상: `com.soransoran.magazine-producer` · `com.soransoran.magazine-auto-register`

이 문서가 **설치·가동·롤백의 정본**이다. 다른 곳에 절차를 다시 적지 않는다.

---

## 0. 경계 — 무엇을 자동으로 하고 무엇을 안 하나

| | 자동 | 사람·CI |
|---|---|---|
| 글감 선정 · brief 생성 | ✅ producer | |
| 원고 회수 (ChatGPT 웹 UI) + 관문 | ✅ producer | |
| 변환 · QA · hero · batch-qa | ✅ auto-register | |
| `articles.ts` 등록 (**PR 브랜치 위에서**) | ✅ auto-register | |
| **PR 생성** (`[merge 금지]`) | ✅ auto-register | |
| **merge** | 🔴 절대 안 함 | 사람 |
| **production 공개** | 🔴 절대 안 함 | merge 후 `publishAt` 도달 시 |

🔴 **자동화는 PR 까지다.** merge 와 공개는 사람이 한다.
원고 품질 통제 지점은 **PR merge 전의 CI 와 사람 검수**다.

🔴 **이것은 "완전 자동 공개" 가 아니다.** 매일 생기는 PR 을 사람이 읽고 merge 해야
글이 나간다. merge 하지 않으면 그날부터 재고가 늘지 않는다 — 아래 §0.1 때문이다.

### 0.1 미해결 자동 PR 은 **한 번에 하나**

🔴 **이전 PR 을 merge 하거나 명시적으로 폐기하기 전에는 다음 생산 회차가 HOLD 한다.**

왜 그런가 — 자동 PR 을 만든 뒤 runtime 은 main 으로 돌아온다. 그 main 의
`articles.ts` 에는 **그 등록이 아직 없다**(PR 안에만 있다). 그대로 다음 날 회차가 돌면

```
Day 1  autumn-low-mood 선정 → PR #A (OPEN) → main 복귀
Day 2  main 의 articles.ts 를 읽는다 → autumn-low-mood 가 없다
       → 같은 slug 를 또 선정하고, 빈 슬롯도 같은 날짜를 고른다 → PR #B
```

`register.mjs` 의 중복 가드는 **main 만** 보므로 이것을 막지 못한다.
그래서 producer 와 auto-register가 **시작 전에 같은 판정**을 본다
(`scripts/lib/magazine-outstanding.mjs`).

| 상태 | 판정 | 종료 코드 | 사람이 할 일 |
|---|---|---|---|
| OPEN 자동 PR 있음 | `OUTSTANDING_PR` · **HOLD** | 0 (정상) | PR 을 읽고 merge 한다 |
| CLOSED(미merge) + 브랜치 잔존 | `ABANDONED_PR_BRANCH` · **HOLD** | 0 (정상) | **브랜치를 지운다** = 명시적 폐기 |
| push 됐는데 PR 없음 | `ORPHAN_REMOTE_BRANCH` · 🔴 실패 | 1 | PR 을 열거나 브랜치를 지운다 |
| 로컬에만 남은 자동 브랜치 | `ORPHAN_LOCAL_BRANCH` · 🔴 실패 | 1 | 내용 확인 후 살리거나 지운다 |
| GitHub 을 못 읽음 | `GITHUB_QUERY_FAILED` · 🔴 실패 | 1 | 네트워크·gh 인증 확인 |
| 미해결 0건 | `CLEAR` | — | 없음 (그냥 진행) |

🔴 **merge 판정은 GitHub 의 PR state 가 정본이다.** commit ancestry 로 보지 않는다 —
squash merge 는 PR 커밋을 main 에 남기지 않아 merge 된 PR 이 영원히 "미해결" 로 남는다.

🔴 **모르면 멈춘다(fail closed).** GitHub 을 읽지 못하면 "미해결 없음" 이 아니라
"확정할 수 없음" 이다. 확정하지 못한 채 새 PR 을 만들면 중복을 막을 길이 없다.

---

## 1. 무엇이 고장나 있었나 (2026-09-03 ~ 09-15)

두 job 이 **12일간 한 번도 돌지 않았다.** 로그가 없으니 아무도 몰랐다.

### 근인 — TCC 가 plist 를 읽지 못한다

```
kernel [com.apple.sandbox.reporting:violation]
System Policy: smd(…) deny(1) file-read-data
/Users/…/Documents/soransoran/launchd/com.soransoran.magazine-producer.plist
```

옛 설치는 `~/Library/LaunchAgents` 에 `~/Documents` 를 가리키는 **symlink** 를 두었다.
macOS 의 Documents 접근 보호가 `smd` 의 plist 읽기를 거부한다 —
읽지 못하니 **서비스 등록 자체가 되지 않는다.**

같은 기계의 D100 job 4개는 `~/Library/LaunchAgents` 안의 **실제 파일**이라 정상이었다.

### 그 밖에 켰으면 사고가 났을 것들

| | 증상 |
|---|---|
| `gh` 가 launchd PATH 에 없음 | `add → commit → push → gh pr create` 순서라 **push 뒤에** gh 부재를 안다. PR 없는 브랜치가 origin 에 조용히 올라간다 |
| main 복귀 코드 없음 | 첫 성공 회차 뒤 저장소가 자동 브랜치에 남아 **다음 날부터 매일 `NOT_ON_MAIN`** |
| exit 0 고정 + Slack 발송 0 | 실패가 종료 코드에도 Slack 에도 안 남는다 |
| lock 없음 | 사람 수동 실행과 02:00 회차가 겹칠 수 있다 |
| `imageMode=REQUIRED` | 호출부가 `alt: null` 고정 → **구조적으로 언제나 BLOCKED** |
| 대상 저장소가 개발 작업트리 | 진단 시점 브랜치가 `fix/write-guest-start-flow` |

전부 이 PR 에서 고쳤다.

---

## 2. runtime worktree

```
/Users/yanadoo/Documents/soransoran-magazine-runtime
```

🔴 **개발 작업트리를 쓰지 않는다.** 그날 누가 브랜치를 바꿨는지에 따라 결과가 달라진다.
🔴 **D100 의 `soransoran-runtime` 과도 다르다.** 두 레인이 서로의 배포에 묶이지 않는다.
설치기가 `soransoran` · `soransoran-m0` · `soransoran-runtime` 을 명시적으로 거부한다.

만드는 법 (한 번):

```bash
git -C ~/Documents/soransoran worktree add ~/Documents/soransoran-magazine-runtime main
```

조건: 브랜치 `main` · 추적 변경 0건. 설치기가 확인한다.

---

## 3. 활성화 게이트 — supervised 1회 end-to-end 성공

🔴 **옛 "5일 관찰 후 허용" 조건은 경영 결정(2026-09-15)으로 폐기됐다.**

대신 **사람이 지켜보는 앞에서 `--write --pr` 이 1회 성공**해야 한다.
성공의 정의는 하나다 — **PR 이 실제로 열렸다.**

그 사실을 영수증으로 남긴다:

```
~/Library/Application Support/soransoran/magazine-supervised-run.json
{
  "result": "SUCCESS",
  "prUrl": "https://github.com/MogoKim/soransoran/pull/NNN",
  "ranAt": "2026-09-16T02:00:00+09:00"
}
```

영수증이 없거나 `result !== "SUCCESS"` 거나 PR URL 이 없으면
`magazine:launchd-install --apply` 가 **아무것도 설치하지 않고 멈춘다.**

### supervised 실행 중의 진행 규칙

🔴 **gate 가 통과하면 중간에 창업자에게 "계속할까요" 를 다시 묻지 않는다.**
producer → auto-register 검증까지 **이어서** 끝낸다. 매 단계 확인을 받으면
그 자체가 새로운 병목이 되고, 무엇을 승인한 것인지도 흐려진다.
판단이 필요한 자리는 이미 코드가 막는다 — gate · 관문 · preflight · 미해결 판정.

🔴 **예외는 하나다 — ChatGPT 전용 프로필 로그인이 실제로 필요할 때.**
`LOGIN_REQUIRED` · `CLOUDFLARE_BLOCKED` 처럼 사람이 화면에서 로그인해야만
풀리는 상태면, 그때만 창업자에게 화면을 넘긴다. 그 밖의 실패는 보고하고 멈춘다.

---

## 4. 설치

```bash
npm run magazine:launchd-check          # 판정 함수 회귀 (파일 변경 0)
npm run magazine:launchd-install        # 계획만 (변경 0)
npm run magazine:launchd-install -- --apply   # 🔴 실제 설치
```

설치기가 하는 일:

1. runtime worktree 확인 (존재 · main · 깨끗함 · 개발 트리 아님)
2. supervised 영수증 확인
3. `docs/operations/launchd/*.plist.template` 렌더 — placeholder 가 하나라도 남으면 중단
4. 기존 **symlink 를 보관소로 옮긴다** (지우지 않는다)
   → `~/Library/Application Support/soransoran/launchd-rollback/`
5. 실제 plist 파일을 `~/Library/LaunchAgents` 에 원자적으로 쓴다

🔴 **설치기는 `launchctl` 을 부르지 않는다.** 파일만 놓는다.

### 가동 (사람이 한다)

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.soransoran.magazine-producer.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.soransoran.magazine-auto-register.plist

# 등록됐는지 확인 — "Could not find service" 가 나오면 실패다
launchctl print gui/$(id -u)/com.soransoran.magazine-producer | head -20
launchctl print gui/$(id -u)/com.soransoran.magazine-auto-register | head -20
```

---

## 5. 감시

### producer 종료 코드의 뜻

🔴 옛 판은 brief·원고 회수 실패를 **삼키고** plan 의 코드만 돌려줬다.
ChatGPT 로그인이 만료돼 원고를 한 건도 못 받아도 `exit 0` 이었다.
지금은 `launchctl` 의 last exit status 만 봐도 구분된다.

| 코드 | 판정 | 뜻 |
|---|---|---|
| 0 | `OK` | 정상 |
| 0 | `CONTENT` | 일부 slug 가 brief 게이트에 막혔다 — **정상이다**. 관문이 일한 것 |
| 0 | `HOLD` | 미해결 자동 PR 을 기다리는 중 — **정상이다** |
| 1 | `SYSTEM` | plan 실패 · claude 부재 · **ChatGPT 접근 실패 · 브라우저 시작 실패** · 회수기 전역 실패 |

🔴 Slack 은 판정을 바꾸지 않는다 — 양방향으로. 알림이 실패해도 원래 실패는 실패이고,
실패 회차에서도 알림은 **반드시 시도한다**.

### 알림 계약 — 종료 경로는 하나다

🔴 non-dry-run producer 의 **모든** 종료 경로가 단일 finalizer 를 지난다
(`scripts/lib/magazine-producer-flow.mjs`). 알림은 거기 한 곳에만 있고 **회차당 정확히 한 번** 돈다.

| 중단 사유 | exit | Slack | write·AI |
|---|---|---|---|
| `TOOL_MISSING` (claude·gh 부재) | 1 | ✅ 1회 | 0 |
| `NOT_ON_MAIN` · `DIRTY_TREE` | 1 | ✅ 1회 | 0 |
| `OUTSTANDING_PR` (HOLD) | 0 | ✅ 1회 — **PR 번호·URL 포함** | 0 |
| `ORPHAN_*` · `GITHUB_QUERY_FAILED` | 1 | ✅ 1회 | 0 |
| plan·brief·fetch 실패 | 1 | ✅ 1회 | 실행된 단계까지 |
| 정상 | 0 | ✅ 1회 | 전부 |

🔴 **알림을 보내려고 파일을 쓰거나 AI 를 부르지 않는다.** 중단 경로에서는
`plan`·`brief`·`fetch` 를 **한 번도 호출하지 않는다** — 회귀가 호출 횟수로 증명한다.

🔴 **HOLD 알림에는 PR 번호와 URL 이 반드시 들어간다.**
로그에만 있고 Slack 에 없으면 창업자는 무엇을 merge 해야 하는지 모른 채
"또 HOLD 네" 만 보게 된다. auto-register 의 HOLD 알림도 같은 PR 을 지목한다.

🔴 **dry-run 은 실제로 보내지 않는다.**

> **2026-09-16 에 배운 것** — 직전 판은 이 계약을 문서와 주석에 적어 두고도
> 두 경로가 `process.exit(1)` 로 빠져나가 실제로는 성립하지 않았다.
> 회귀는 있었지만 **소스에서 `runNotify()` 의 위치만** 봤다. 위치는 도달 여부를 보지 못한다.
> 지금 회귀는 주입한 흐름을 **실제로 돌려** 호출 횟수와 종료 코드를 본다.

| 무엇 | 어디 |
|---|---|
| producer 로그 | `~/Library/Logs/soransoran/magazine-producer.log` |
| auto-register 로그 | `~/Library/Logs/soransoran/magazine-auto-register.log` |
| write 회차 리포트 | `drafts/magazine/_runs/{date}/auto-register.json` (runtime 안) |
| Slack | write 회차는 **성공도 실패도** 보낸다 (`#소란소란-알림`) |
| launchd 종료 코드 | write 회차 실패는 non-zero 로 남는다 |

🔴 로그에 반드시 남는 것: PR URL · 처리 slug · 막힌 단계 이름 · 남은 브랜치.

### 매일 30초 점검

```bash
launchctl print gui/$(id -u)/com.soransoran.magazine-auto-register | grep -E 'last exit|runs'
tail -40 ~/Library/Logs/soransoran/magazine-auto-register.log
```

---

## 6. 상태도 — 성공 · 실패 · 복귀

```
02:00 회차 시작
  │
  ├─ lock 잡기 ────────── 실패(LOCK_HELD/STUCK/CORRUPT) ─→ exit 1 · main 복귀 안 함(남의 회차)
  │                                                        🔴 재시도하지 않는다
  ├─ writePreflight
  │    ├ 도구(git·gh·node·claude) ─ 없음 ─→ TOOL_MISSING ─┐
  │    ├ gh 인증 ──────────────── 실패 ─→ GH_AUTH_FAILED ─┤
  │    ├ git(main·clean·ff-only) ─ 실패 ─→ NOT_ON_MAIN 등 ─┤→ 🔴 파일 변경 0 · main 복귀 · exit 1
  │    └ push 자격(--dry-run) ──── 실패 ─→ PUSH_NOT_READY ─┘
  │
  ├─ PR 브랜치 생성 ───── 실패 ─→ BRANCH_CREATE_FAILED ─→ 파일 변경 0 · main 복귀 · exit 1
  │
  ├─ slug 별 drive()  gate → 회수 → 변환 → QA → hero → batch-qa → register write
  │      (막히면 그 slug 만 BLOCKED. 다른 slug 는 계속 간다)
  │
  ├─ finishPr  stage(명시) → stageCheck → commit → push → gh pr create
  │      ├ stageCheck 실패 ─→ restore --staged · commit 안 함 · pushed:false
  │      ├ push 실패 ───────→ pushed:false
  │      └ PR 실패 ────────→ 🔴 pushed:true 를 남긴다 ("브랜치는 origin 에 있다")
  │
  └─ finish
       ├ main 복귀 시도
       │   ├ 깨끗함 ─→ switch main ─→ RETURNED (작업 브랜치는 남긴다)
       │   └ 미커밋 변경 ─→ 🔴 RETURN_DIRTY — 아무것도 지우지 않고 BLOCKED
       ├ lock 해제
       ├ Slack 발송 (write 회차는 성공도 알린다)
       └ exit  BLOCKED 있으면 non-zero
```

### 복구 가능한 실패의 처리

| 상황 | 자동화가 하는 것 | 사람이 하는 것 |
|---|---|---|
| push 성공 · PR 실패 | 브랜치명 로그·Slack 에 남기고 **main 복귀** | GitHub 에서 그 브랜치로 PR 을 연다 |
| 미커밋 변경으로 복귀 실패 | 🔴 **아무것도 지우지 않는다.** BLOCKED + 복구 방법 | `git -C <runtime> status` 로 확인 후 판단 |
| 살아 있는 lock | 그 회차 건너뜀 | 없음 (다음 회차가 정상 진행) |
| 45분 이상 붙잡힌 lock | `LOCK_STUCK` 으로 멈춤 | 프로세스 확인 후 lock 파일 제거 |

🔴 **어떤 경우에도 `reset --hard` · `switch -f` · `branch -D` 를 쓰지 않는다.**

---

## 7. 롤백

```bash
# ① 가동 중지
launchctl bootout gui/$(id -u)/com.soransoran.magazine-auto-register
launchctl bootout gui/$(id -u)/com.soransoran.magazine-producer

# ② 파일 제거 — 🔴 bootout 만으로는 로그인 때 다시 등록된다
rm ~/Library/LaunchAgents/com.soransoran.magazine-auto-register.plist
rm ~/Library/LaunchAgents/com.soransoran.magazine-producer.plist

# ③ 확인 — "Could not find service" 가 정상이다
launchctl print gui/$(id -u)/com.soransoran.magazine-auto-register
```

옛 symlink 로 되돌려야 한다면 보관소에 있다:
`~/Library/Application Support/soransoran/launchd-rollback/`
🔴 다만 그 symlink 는 TCC 때문에 **애초에 동작하지 않는다.** 되돌릴 이유는 없다.

### 자동 PR 만 끄고 싶다면

템플릿의 `ProgramArguments` 에서 `--write` · `--pr` 두 줄을 빼고 다시 설치한다.
그러면 dry-run 리포트만 나간다 (파일 변경 0 · Slack 발송 0).

---

## 8. 회귀 테스트

```bash
npm run magazine:auto-check       # 자동 레인 게이트 · 관문 · git lifecycle (node)
npm run magazine:launchd-check    # 설치기 판정 · 템플릿 렌더 (tsx)
```

🔴 **clean checkout 에서 0 FAIL 이어야 한다.**
옛 테스트는 커밋된 적 없는 원고 3건에 의존해 CI 에서 언제나 1 FAIL 이었다.
지금 표본은 `scripts/__fixtures__/magazine/` 에 추적돼 있다.

---

## 9. 알려진 것

- `drafts/magazine/after-holiday-body-ache/draft.md` 에는 ChatGPT 인용 마커가 **아직 남아 있다.**
  `dea1c7a` (#299) 가 `articles.ts` 본문만 고쳤다. 관문은 이것을 정상적으로 막는다 —
  회귀 테스트가 "여전히 막힌다" 를 시험한다. 원본 정리는 별건이다.
- `imageMode: OPTIONAL` 은 여전히 기본 스킵이다. 자동 hero 생성 범위를 넓히지 않았다.
- HIGH · `autoEligible=false` 는 gate 와 `register.mjs` 의 `AUTO_RISK` 두 겹으로 막힌다.
