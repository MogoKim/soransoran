# launchd 템플릿

> 역사 설계 근거: [Raw 공급망 설계 §5](../2026-09-03-raw-supply-chain-design.md) ·
> 좁은 안전 계약: [헌법 §6-9-F](../../constitution/MICRO_SEED_LANE_CONSTITUTION.md)

이 디렉터리에는 `.plist.template` 만 있다. **템플릿이 있다는 것과 job 이 돌고 있다는 것은
다른 사실이다** — 템플릿은 "무엇을 · 언제 · 어떤 인자로 돌릴 것인가" 를 확정한 것이고,
등록은 사람이 별도 절차로 한다.

🔴 **"등록됐는가" 의 정본은 이 디렉터리가 아니라 `launchctl list` 와 `~/Library/LaunchAgents/` 다.**
   이 문서에 "등록됨" 이라고 적지 않는다. 적는 순간 그 문장이 관측을 대신하게 되고,
   실제로는 내려가 있는 job 을 며칠씩 돌고 있다고 믿게 된다(2026-09-11 이전 판이 그랬다).

```bash
npx tsx -e "import {observeJobs} from './scripts/lib/launchd-observe.mjs'; console.log(observeJobs())"
npm run d100:readiness -- --json
# 🔴 direct supply:health 는 stage env 기본값을 읽는 결함이 있다. 고칠 때까지 wrapper 로만 본다.
npx tsx scripts/stage-consume-exec.mts --by=supply -- npx tsx scripts/supply-health.mts --json
```

수집 능력은 **세 값을 절대 합치지 않는다**(MASTER §8.0).

```
current   launchctl 에 올라와 있는 job 의 **실제 슬롯 수** × 회차당 상세 × 성공률
prepared  이 디렉터리에 템플릿이 있고 계획이 성립하는 것
required  그 capacity 단계가 요구하는 상세 요청 수
```

템플릿을 만든 것은 `prepared` 다. `current` 는 **정확한 Label 과 정확한 슬롯 수**로
올라와 있을 때만 늘어난다 — 다회 Label 이어도 슬롯이 2개면 그것은 2회 job 이다.


첫 등록은 승인된 cutover 절차가 필요하고, 이후 변경은 `runtime:deploy`가 rollback과 함께 수행한다.
현재 등록 여부는 이 문장이 아니라 `launchctl`로만 판정한다.

## 🔴 현재 구조 — 자동 일정 owner 는 launchd 하나 · 단계는 StageDecision 하나

정책은 [D100 canon](../2026-09-21-d100-goal-canon.md) §6 자동 사다리가 정하고, 이 문서는 그 **실행 설명**이다.

- D100 레인의 자동 일정(수집 · 공급 처리 · 발행 · 첫 댓글 · 감사 · 단계 controller)은 **이 기계의 launchd 하나**가
  소유한다. 같은 일을 GitHub Actions schedule 이 따로 돌리면 owner 가 둘이다 — 결함이다.
- 오늘 단계는 **`StageDecision` 행 하나**가 정한다. GitHub stage Variables · `.env` 의 단계 값 · canary 창은
  단계를 정하는 근거가 아니다. 사람이 단계를 올리는 routine 절차는 없다.
- 이 구조는 main과 보조 Mac runtime에 배포됐다. 보조 Mac이 D100 job의 유일한 owner이고(상시 job 10개 — 아래 「상시 job 시각표」),
  회사 Mac의 D100 job은 0개다. exact runtime·오늘 단계·loaded 상태는
  [`CURRENT-MILESTONE.md`](../CURRENT-MILESTONE.md)와 실제 관측이 정한다.
- 🔴 `supply:health` 같은 하위 명령이 wrapper 없이 env 기본값을 읽어 d1을 보고하는 결함은 아직 남아 있다.
  운영 판정은 `stage-consume-exec` wrapper 또는 `d100:readiness`를 쓰며, direct 명령은 authority 보정 전까지 금지한다.

## 🔴 손으로 치지 않는다 — `runtime:deploy` 가 cutover 를 한다 (2026-09-11)

아래 "등록 절차" 는 **첫 등록과 진단용**이다. 평소 전환은 배포가 한다.

```bash
npm run runtime:deploy                                  # 계획만 — 무엇을 설치·퇴역할지 찍는다
npm run runtime:deploy -- --apply --target=<full sha>   # 🔴 실제 cutover
```

배포가 한 회차에 하는 일:

```
설치 plist 원문·loaded 상태 보존  →  예약 job + 퇴역 job unload
  →  target SHA checkout · npm ci · prisma generate  →  offline 게이트
  →  🔴 저장소 템플릿을 render 해 **설치 plist 로 쓴다**  →  plutil 검증
  →  퇴역 job 의 설치본을 보관소로 이동  →  manifest·pin  →  job load
  →  실제 ProgramArguments · WorkingDirectory 대조  →  격리 검사
```

🔴 **중간에 실패하면 SHA · plist 원문 · loaded 상태까지 되돌린다.**
원래 없던 설치본은 지우고, 원래 내려가 있던 job 은 다시 내린다 — 어중간한 상태를 남기지 않는다.

🔴 **이것이 없던 동안 무슨 일이 있었나.** 배포기는 기존 설치 plist 를 `unload` 하고 그대로
다시 `load` 했다. 저장소의 새 템플릿이 설치본에 닿지 못해, 배포를 몇 번 해도 네이버 job 은
옛 `micro-seed-collect-navercafe.mts --pages=1 --max=10` 을 계속 돌았고
`BOARD_TARGETS` 의 2~16p 는 한 번도 열리지 않았다.

## 📜 왜 템플릿까지만 두었는가 — 첫 등록 당시 기록

```
🟢 이 PR      무엇을 · 언제 · 어떤 인자로 돌릴지 확정
🔴 별도 절차   실제 등록 (창업자 승인 + 첫 수동 실행 검증 후)
```

헌법 §6-9-F 개정으로 **공급 cron 을 붙일 자격**이 생겼을 뿐,
자격과 등록은 다르다. 첫 live 수집을 사람이 한 번 보고 나서 붙인다.

## 🔴 등록이 조용히 실패하는 두 가지 (2026-09-07 실측)

공급 job 을 처음 등록했을 때 job 은 `loaded` 인데 **exit 78 로 죽고 로그가 0바이트**였다.
프로세스가 뜨기도 전에 죽어서 stdout·stderr 어디에도 원인이 남지 않는다 —
사람 눈에는 "등록은 됐는데 아무 일도 안 일어나는" 상태로 보인다.

| 원인 | 왜 |
|---|---|
| **PATH** | launchd 기본 PATH 는 `/usr/bin:/bin:/usr/sbin:/sbin` 뿐이다. `npx` 의 shebang 이 `#!/usr/bin/env node` 라 nvm 의 node 를 못 찾는다 (`env: node: No such file or directory`) |
| **로그 위치** | 로그를 `~/Documents` 아래 두면 macOS 의 Documents 접근 보호(TCC)로 launchd 가 그 파일을 열지 못한다 |

그래서 템플릿은 `__NODEBIN__` 과 `__LOGDIR__` 을 요구한다.
`~` 나 `$HOME` 은 plist 안에서 **확장되지 않으므로** 아래 절차가 절대경로로 치환한다.

## 등록 절차 (승인 후) — 🔴 몇 번을 돌려도 같은 상태가 된다

```bash
# ── 0) 값을 한 번만 계산한다 ──
REPO="$HOME/Documents/soransoran-runtime"   # 상시 호스트의 runtime 트리(모든 plist 의 WorkingDirectory)
NPX="$(which npx)"
NODEBIN="$(dirname "$(which node)")"
LOGDIR="$HOME/Library/Logs/soransoran"   # 🔴 Documents 밖이어야 한다
# 🔴 JOB 하나가 **템플릿 파일명이자 launchd Label** 이다. 이 디렉터리의 템플릿은
#    파일명과 Label 을 일치시켜 두었으므로, 아래 render·lint·load·print 가 전부 같은 것을 가리킨다.
JOB=com.soransoran.supply-process

# ── 1) 로그 디렉터리를 먼저 만든다 ──
mkdir -p "$LOGDIR"

# ── 2) 치환 — 🔴 평소에는 runtime:deploy 가 이 일을 대신한다 ──
sed -e "s#__NODE__#$(which node)#g" \
    -e "s#__NPX__#${NPX}#g" \
    -e "s#__NODEBIN__#${NODEBIN}#g" \
    -e "s#__LOGDIR__#${LOGDIR}#g" \
    -e "s#__REPO__#${REPO}#g" \
    "docs/operations/launchd/${JOB}.plist.template" \
    > "$HOME/Library/LaunchAgents/${JOB}.plist"

# ── 3) 문법 검증 — 🔴 통과해야 등록한다 ──
plutil -lint "$HOME/Library/LaunchAgents/${JOB}.plist"

# ── 4) 등록 (unload 후 load — 이미 있으면 걷어내고 다시 올린다) ──
launchctl unload "$HOME/Library/LaunchAgents/${JOB}.plist" 2>/dev/null || true
launchctl load  "$HOME/Library/LaunchAgents/${JOB}.plist"

# ── 5) 확인 ──
launchctl list | grep soransoran                       # 2번째 컬럼 = 마지막 exit status
launchctl print "gui/$(id -u)/${JOB}" | grep -E 'state|program|path ='
```

🔴 **치환 후 남은 `__…__` 가 하나라도 있으면 안 된다.** 확인:

```bash
grep -o '__[A-Z_]*__' "$HOME/Library/LaunchAgents/${JOB}.plist" || echo "남은 placeholder 없음"
```

🔴 **`plutil -extract` 로 값을 볼 때는 `-o -` 를 붙여라.** 안 붙이면 **원본 파일을 덮어쓴다** —
2026-09-07 에 등록된 plist 하나를 그렇게 날렸다. 읽기만 할 거면 `plutil -p` 를 쓴다.

🔴 **`.env.local` 에 그 job 의 스위치가 없으면 `--live` 는 무시된다.**
(`supply-process` → `SORAN_SUPPLY_PROCESS_ENABLED` ·
 네이버 수집 → `SORAN_NAVERCAFE_COLLECT_ENABLED`)
kill switch 는 plist 가 아니라 환경변수다 — plist 를 지우지 않고도 멈출 수 있어야 한다.

## 되돌리기

```bash
launchctl unload ~/Library/LaunchAgents/com.soransoran.supply-process.plist
rm ~/Library/LaunchAgents/com.soransoran.supply-process.plist
```

또는 **더 빠르게**: `.env.local` 에서 그 job 의 스위치를 `false` 로.
plist 는 계속 돌지만 수집이 일어나지 않는다.

## 수집 — job 하나가 바퀴마다 원천 목록을 차례로 돈다 (2026-11-19)

- **언제**: `com.soransoran.navercafe-collect` 가 바퀴 시각에 뜬다. 시각의 정본은
  [`src/lib/cycle-schedule.ts`](../../../src/lib/cycle-schedule.ts) 의 `CYCLES` 하나다 — 이 문서에 적지 않는다.
  템플릿은 손으로 고치지 않는다: 바퀴를 바꾸면 `npm run launchd:collect-template -- --write` 로 다시 만들고,
  `launchd:template-check` 가 "파일 == 생성 결과" 를 본다.
- **무엇을**: [`src/lib/collect-sources.ts`](../../../src/lib/collect-sources.ts) 의 `COLLECT_SOURCES` — 카페마다 한 줄
  (카페 번호 · 게시판 · 목록 최대 쪽 · 하루 요청 상한 · 호칭 낱말)과 수집 계정 전체 하루 상한(`ACCOUNT_DAILY_REQUESTS`).
  카페를 더하는 일은 **이 배열에 한 줄 + 수집 계정 가입**이다. job 수는 그대로다.
- **차례로**: runner(`micro-seed-navercafe-run.mts`)가 카페마다 수집기 프로세스를 띄운다. 잠금이 하나라 같은 시각에
  두 job 을 올리면 뒤쪽이 `LOCK_BUSY` 였다 — 그래서 job 하나다. 한 카페가 실패해도 다음 카페는 돈다(실패는 exit 1).
- **얼마나**: 바퀴의 본문 수는 수집기가 목록을 본 뒤 정한다(`cycleDetailQuota`) — 남은 하루 예산(남은 바퀴마다 회원 확인 ·
  목록 · 본문 1건을 먼저 뗀다)을 "앞 바퀴 뒤 새 글 : 어제 같은 시간대 바퀴들이 본 새 글" 비율로 나눈다. 13바퀴가 어떻게 돌아도
  카페 상한 · 계정 상한을 넘지 않는다(`collect:sources-check` 가 최악의 경우까지 잰다). 목록은 1쪽부터, 그 쪽이 전부 새 글이면 다음 쪽.
- **남기는 것**: 버린 글은 상세 원장에 사유 코드(`reasons`), 목록 단계 제외는 로그 한 줄(▸ 고정 글 · 이미 연 글 · 한자 제목 · 몫 밖),
  차단은 회차 기록에 `HTTP_403` · `HTTP_429` · `LOGIN_WALL`(로그인 화면) 로 남고 사람을 부른다.

무엇을 할지 보려면 `--live` 없이 돌린다 (네트워크 0 · DB 0):

```bash
npx tsx scripts/micro-seed-navercafe-run.mts
```

🔴 82cook · 유머 게시판 수집은 끝났다 — 수집기 · 템플릿을 지웠고 옛 job(카페별 `…-multi` 둘 · 82cook 둘)은
`RETIRED_JOBS` 라 배포가 내린다. 지난 라운드에 뺀 후보 카페(dlxogns01 · masanmam · goondae · yeowooya)는 실행 템플릿이 없다.

🔴 공급 처리(`supply-process`) 시각도 바퀴 표에서 계산된다 — 바퀴마다 수집 시작 뒤 `SUPPLY_AFTER_COLLECT_MINUTES` 분
([`src/lib/cycle-schedule.ts`](../../../src/lib/cycle-schedule.ts)). 템플릿은 손으로 고치지 않는다: 바퀴나 지연을 바꾸면
`npm run launchd:supply-template -- --write` 로 다시 만들고, `launchd:template-check` 가 "템플릿 == 생성 결과" 와
"템플릿이 띄우는 분마다 러너가 정기 회차로 판정한다" 를 본다.

## 🔴 상시 job 시각표 (전부 KST)

상시 호스트의 D100 job 은 열 개다. 시각의 출처는 템플릿과 설치기 코드이고, 2026-11-18 호스트 plist 와 대조했다.
지금 올라와 있는지는 언제나 `launchctl list | grep soransoran` 으로 본다.

| job (`com.soransoran.` 생략) | 하는 일 | 언제 |
|---|---|---|
| `navercafe-collect` | 네이버 카페 수집(원천 목록을 차례로) | 바퀴 시각 — `cycle-schedule.ts` 의 `CYCLES` |
| `supply-process` | 공급 처리(글 만들기) | 바퀴마다 수집 시작 뒤 `SUPPLY_AFTER_COLLECT_MINUTES` 분 — `cycle-schedule.ts` |
| `stage-controller` | 그날 단계 결정 | 07:00 · 07:20 · 07:40 · 07:55 · 07:58 (5회 — 결정은 하루 한 번만 저장된다) |
| `original-post-runner` | 글 발행 | 08:00~22:00 10분마다 (85회 · 한 회차 1편) |
| `persona-comment-runner` | 첫 댓글 · 추가 댓글 | 08:07~22:00 약 20분마다 (43회) |
| `auto-ready-audit` | 발행 뒤 감사 | 08:10~23:40 30분마다 (32회) |
| `runner-recover` | 놓친 회차 복구 | 30분마다 |
| `ops-shadow-observer` | 읽기 전용 관측(권위 0) | 60초마다 |
| `keep-awake` | 잠들지 않게 유지 | 상시 |

🔴 **1회용 job 은 끝나면 내린다.** 배포·투입을 위해 잠깐 올린 job 은 상시 목록이 아니다. 아래 셋은 퇴역했다 —
호스트에 남아 있으면 내리고 plist 를 지운다. 다시 등록하지 않는다.

```
com.soransoran.overnight-deploy-1117   퇴역 (11-17 밤 배포용)
com.soransoran.overnight-audit-1117    퇴역 (11-17 05:30 점검용)
com.soransoran.persona-d30-oneshot     퇴역 (11-17 Persona 투입용 · 스크립트는 저장소에서 지웠다)
```

## 🔴 운영 공급 job 은 둘이다 — 수집 하나 · 처리 하나

정본은 [`src/lib/runtime-isolation.ts`](../../../src/lib/runtime-isolation.ts) 의 `RUNTIME_JOBS` 다.
격리 검사와 배포가 **이 목록과 실제 loaded 를 정확히 대조**한다.

운영 공급 job은 네이버 수집 1개와 `supply-process` 1개다. D100 전체 allowlist는 발행·댓글·감사·controller·recovery·
keep-awake를 포함한 9개와 ops shadow observer 1개이고 `ALWAYS-ON-HOST.md`가 싣는다.

> 🔴 **ops shadow observer(`com.soransoran.ops-shadow-observer`) · 권위 0 · 상시 job 이다(60초마다 · 2026-11-18 호스트에서 설치 확인)** —
> 정적 템플릿이 아니다. `scripts/lib/ops-loop-templates.ts` 의 `renderOpsShadowObserverPlist` 가 동적으로 render 하고
> ops-loop 설치기가 설치 · snapshot · rollback 을 맡는다. 🔴 **`npm run ops:loop-install -- --apply --observer=on` 으로만 설치**한다 —
> 플래그가 없으면 지금 상태를 유지한다(설치돼 있으면 새 원문으로 교체 · 없으면 없는 채로). 제거는 `--observer=off`.
> 60초 `StartInterval` 하나뿐이다(WatchPaths · 공급 hook · 공급 plist 명령 연쇄 0). `RUNTIME_JOBS` 밖이다.
> 배포 quiesce 의 **reader**(`DEPLOY_QUIESCE_READER_JOBS`)다 — runtime:deploy 가 실행 중이면 멈추고 idle 이면 내렸다 원래 상태로
> 되올린다. writer 가 아니므로 production activation 의 writer 판정(`D100_WRITER_JOBS`)에는 없다. `runtime-deploy.lock` 이 있으면
> tick 을 바로 끝낸다. `--now`(주입 시각)는 격리 시험 계약(격리 DB · 임시 HOME)에서만 받는다.
> 끝난 자연 공급 회차(정본 `naturalScheduledRunEvidenceAt`)마다 감사 장부(`ops-shadow/<KST>.jsonl`)에 한 줄을 적을 뿐이고,
> 관측 시각은 실제 tick 이고 `completedAt` 은 출처로만 남는다. 완료 뒤 5분 안(causal)만 지금 상태를 보고, 그 뒤(backfill)는
> 결정 · 장부 · DB 를 읽지 않는 marker 한 줄이다. tick 전체는 감사 장부 디렉터리의 `.observer.lock` 단일 실행 잠금 안에서 돈다
> (손 실행과 launchd tick 이 겹쳐도 진행 중인 causal 을 뒤 tick 의 backfill 이 앞지르지 못한다 · 기다리지 않고 다음 tick 에 넘긴다).
> 주인이 죽은 잠금은 정리 claim(`.observer-cleanup.lock`) 하나를 쥔 쪽만 원문 재검증 뒤 지우고 그 tick 은 잡지 않는다.
> 정리 claim 의 주인이 죽어 남으면 자동으로 지우지 않는다 — observer 가 exit 1(`cleanupStranded`)로 알리고 사람이 확인해 지운다.
> `status: done` 은 완료 관측일 뿐 공급 exit 0 이 아니다(`integrity: unknown`). causal 인데 그날 결정이 없으면 기록 0 으로 다음 tick 이
> 다시 보고, 완료 뒤 5분이 지나면 결정을 읽지 않는 backfill marker 한 줄로 끝난다.
> 실패는 이 job 의 exit · log 에만 남는다 — 공급 lease · provider · DB · stage · 장부 쓰기 · job kick 0.

```
① com.soransoran.navercafe-collect   수집 — 바퀴마다 원천 목록을 차례로
② com.soransoran.supply-process      처리
```

## 목록

| 템플릿 | 무엇을 | 환경 |
|---|---|---|
| `com.soransoran.navercafe-collect.plist.template` | 네이버 카페 수집 (바퀴 시각 · 생성된 파일) | 🔴 **로컬 전용** (세션이 이 기계에만 있다) |
| `com.soransoran.supply-process.plist.template` | 공급 처리(drain) — 미처리 입력을 변환→판정→초안→적재 (7슬롯) | 🔴 **로컬 전용** (§4-AU) |

매거진 템플릿 5개는 `magazine/` 에 따로 있다(producer 00:10 · auto-register 01:00 · auto-merge-recovery 02:00 · watch 11:00 ·
graph-watch 11:05). 회사 Mac 전용이고 절차는 [`magazine-automation-runbook.md`](../magazine-automation-runbook.md)가 싣는다.

## 공급 처리(drain) 등록 (승인 후)

🔴 **이 job 은 수집하지 않는다.** 수집 job 들이 남긴 **미처리 입력만** 비운다.
그래서 어느 수집원이 실패했는지 묻지 않고, 반대로 수집 job 도 이 job 의 상태를 보지 않는다.

```bash
# ── 0) 🔴 .env.local 에 스위치 하나 ──
#    SORAN_SUPPLY_PROCESS_ENABLED=true
#    🔴 수집 job 의 스위치는 따로다 (SORAN_NAVERCAFE_COLLECT_ENABLED).
#       한 스위치가 수집과 처리를 동시에 끄면, 수집을 멈추려다 공급 전체가 멈춘다.

# ── 1) 첫 실행은 사람이 본다 — dry-run 은 네트워크 0 · LLM 0 · DB write 0 ──
npm run supply:process                        # 무엇이 밀려 있는지 · 무엇을 할지
npm run supply:process -- --simulate-stock=5  # 다가오는 슬롯 중 eligible READY 가 5개 덮었다면(JIT 모의)

# ── 2) 위 "등록 절차" 의 0~5 를 JOB 만 바꿔 그대로 돌린다 ──
JOB=com.soransoran.supply-process
```

실행 시각은 수집 바퀴마다 한 번이다 — 그 바퀴의 수집이 시작되고 `SUPPLY_AFTER_COLLECT_MINUTES` 분 뒤(`cycle-schedule.ts`).
입력이 생긴 직후에 비워야 수집된 글이 그 시간대 안에 대기열까지 간다.
🔴 템플릿의 시각과 러너의 정기 회차 창은 같은 표에서 나온다. 설치된 plist 가 옛 시각이면 job 은 뜨지만 러너가 "창 밖에서 시작한
회차"로 보고 유료 요청을 한 건도 보내지 않는다 — 배포 때 이 job 은 반드시 새 템플릿으로 다시 올린다(`runtime:deploy` 가 한다).

🔴 **미처리 입력이 없으면 정상 no-op 이다** — 네트워크 0 · LLM 0 · DB write 0.
조용한 날이 실패로 보이지 않아야 진짜 실패가 눈에 띈다.

🔴 **유료 생성 수요는 JIT 하나다** — 다가오는 슬롯 수 − 그 슬롯들에 eligible 로 남을 READY 수(`judgeJitDemand`).
수요가 0 이거나 모르면 파일 단계(얇은 변환 · 검수용 변환)만 돌고 모델과 DB 는 쉰다. **수집 job 은 영향받지 않는다.**

📜 HISTORICAL — 옛 판은 "APPROVED 재고 700 이상이면 모델 · DB 를 쉰다" 는 버퍼 목표(`judgeBuffer` · `STOCK_BANDS`)로
이 job 을 켜고 껐다. 2026-09-30 D100 canon 이 완성 글 재고 목표를 폐기했고, 코드에서도 지웠다.

🔴 **멈추는 가장 빠른 방법**은 `.env.local` 의 `SORAN_SUPPLY_PROCESS_ENABLED` 를 지우는 것이다.
job 은 계속 돌지만 무엇이 밀려 있는지만 읽고 끝난다.

## 🔴 네이버 카페는 등록 전 선행 조건이 셋이다 (PR-S2-b-2)

```
① 소란소란 전용 네이버 계정 · 세션 발급 (PR-S2-b-3)
   npx tsx scripts/navercafe-session-setup.mts --open   🔴 창업자가 직접 로그인한다
   🔴 세션 정본은 **worktree 밖 절대 경로**다 (2026-09-10 정정)
   공유 env  SORAN_NAVERCAFE_SESSION_PATH=/Users/<user>/Library/Application Support/soransoran/naver-session/soransoran-storage-state.json
             SORAN_NAVERCAFE_COLLECT_ENABLED=false    (수집 개시는 별도 승인)
   권한      디렉터리 700 · 파일 600

   🔴 **상대 경로를 쓰지 않는다.** launchd 의 WorkingDirectory 는 runtime worktree 인데
      세션 파일은 개발 트리에만 있었다 — 다회 수집 job 이 등록 이후 8회 연속
      SESSION_FILE_MISSING 으로 중단됐고, 그동안 관제는 "수집 능력 80건/day" 라고 말했다.
      지금은 judgeSession 이 상대 경로·worktree 내부 경로를 운영에서 막는다(fail-closed).

   🔴 이전 도구  node scripts/naver-session-migrate.mjs [--apply]
      temp copy → digest 대조 → atomic rename · env 한 항목만 교체 · 쿠키 값 미출력

   🔴 우나어 storage-state.json 재사용은 judgeSession 이 코드로 막는다 —
      한쪽이 막히면 둘 다 멈추고, 계정 정지는 되돌릴 수 없다
   🔴 세션 파일은 .gitignore 가 막는다. 헬퍼는 막혀 있지 않으면 저장을 거부한다
   🔴 세션이 만료되면 자동 로그인·재시도하지 않는다. 사람이 headed 로 재발급한다
   🔴 setup 은 target 에 직접 쓰지 않는다 — staging → 모양·인증·만료 검사 → 600 → rename.
      인증이 없으면 **기존 정본을 덮어쓰지 않고** 멈춘다

   🔴 회차 증거  ~/Library/Application Support/soransoran/collect-runs/*.jsonl
      runId 별 시작·종료 기록. 관제는 이 **최신 종료 회차**로 현재 상태를 판정한다 —
      append-only stderr 의 옛 낱말로 "세션 만료" 를 만들어 내지 않는다.
      launchd 가 띄운 회차만 trigger=schedule 이다(XPC_SERVICE_NAME).
      🔴 --scout 는 상세 요청이 0이라 예약 성공 증거가 되지 못한다

② 브라우저 — 🔴 추가 설치가 필요 없다 (PR-S2-b-3 정정)
   playwright-core 는 이미 devDependency 이고, 기본값은 설치된 Google Chrome
   (channel: 'chrome') 이라 브라우저 바이너리를 받지 않는다.
   ⚠️ 앞선 문서는 "의존성이 아니다 · npm i -D playwright" 라고 적었다 — 사실이 아니었다.
   번들 chromium 을 쓰려면 SORAN_BROWSER_CHANNEL=chromium + 별도 설치가 필요하다
   (playwright-core@1.62.1 은 rev 1234 를 기대하는데 로컬 캐시에는 1208 · 1217 뿐이다).

③ 첫 live 를 사람이 한 번 본다
   npx tsx scripts/micro-seed-collect-navercafe.mts --source=remonterrace --live
   🔴 목록 셀렉터는 첫 live 실측으로 확정한다 — 네이버는 iframe 구조이고
      신형·구형 DOM 이 섞여 있어 실제 페이지를 보기 전에는 확정할 수 없다.
      0건이면 스크립트가 throw 한다(조용히 넘어가지 않는다).
```

**수집 job 은 하나다.** 바퀴마다 원천 목록을 차례로 돈다(위 "수집" 절).

> 📜 **역사** — Wave B 이전에는 1회판 job 두 개(`09:20 remonterrace` · `13:20 wgang`)가 돌았다.
> 그 job 도 템플릿도 지금은 없다. 아래 문서에 남은 09:20/13:20 표기는 **그때의 기록**이지
> 운영 정본이 아니다: `2026-09-08-scale-foundation.md` · `2026-09-08-d10-activation-prep.md` ·
> `2026-09-03-raw-supply-chain-design.md`.

## 무인 Persona 댓글 루프 — 설치는 선택 (2026-09-28 · Track B)

🔴 **파일 템플릿이 아니다.** plist 는 `scripts/lib/persona-comment-runner-template.ts` 가 코드로 렌더한다
(Label `com.soransoran.persona-comment-runner` · 실행 `scripts/persona-comment-loop.mts --live` ·
하루 43회 08:07~22:00 · 회차 간격 최대 20분 — 한 글이 첫 댓글 시한 60분 안에 시도 3번). 공급 job(`RUNTIME_JOBS`)이 아니고,
배포 동안만 잠시 멈추는 job(`DEPLOY_QUIESCE_JOBS`)이다 — 격리 검사가 설치됐으면 원문·인자·SHA 를 대조한다.

```bash
# runtime 트리에서 — 계획만(변경 0) → 실제 설치
npm run persona:comment-loop-install
npm run persona:comment-loop-install -- --apply
npm run runtime:isolation-check -- --require-runtime
```

🔴 설치해도 `SORAN_PERSONA_COMMENT_STAGE=bootstrap-auto` 가 아니면 매 회차 provider 0 · write 0 이다.
멈추는 가장 빠른 방법은 plist 가 아니라 그 env 를 내리는 것이다.
