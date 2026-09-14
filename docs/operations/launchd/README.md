# launchd 템플릿

> 정본: [Raw 공급망 설계 §5](../2026-09-03-raw-supply-chain-design.md) ·
> [헌법 §6-9-F](../../constitution/MICRO_SEED_LANE_CONSTITUTION.md)

이 디렉터리에는 `.plist.template` 만 있다. **템플릿이 있다는 것과 job 이 돌고 있다는 것은
다른 사실이다** — 템플릿은 "무엇을 · 언제 · 어떤 인자로 돌릴 것인가" 를 확정한 것이고,
등록은 사람이 별도 절차로 한다.

🔴 **"등록됐는가" 의 정본은 이 디렉터리가 아니라 `launchctl list` 와 `~/Library/LaunchAgents/` 다.**
   이 문서에 "등록됨" 이라고 적지 않는다. 적는 순간 그 문장이 관측을 대신하게 되고,
   실제로는 내려가 있는 job 을 며칠씩 돌고 있다고 믿게 된다(2026-09-11 이전 판이 그랬다).

```bash
npx tsx -e "import {observeJobs} from './scripts/lib/launchd-observe.mjs'; console.log(observeJobs())"
npm run supply:health          # ④-b 에 current · prepared · required 가 나온다
```

수집 능력은 **세 값을 절대 합치지 않는다**(MASTER §8.0).

```
current   launchctl 에 올라와 있는 job 의 **실제 슬롯 수** × 회차당 상세 × 성공률
prepared  이 디렉터리에 템플릿이 있고 계획이 성립하는 것
required  그 capacity 단계가 요구하는 상세 요청 수
```

템플릿을 만든 것은 `prepared` 다. `current` 는 **정확한 Label 과 정확한 슬롯 수**로
올라와 있을 때만 늘어난다 — 다회 Label 이어도 슬롯이 2개면 그것은 2회 job 이다.


🔴 **등록은 창업자 승인 후 별도 절차다.** 등록하는 순간 되돌리는 주체가 사람이 된다 —
이 PR 은 "무엇을 등록할 것인가" 까지만 정한다.

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

## 왜 템플릿까지만 두는가

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
REPO=/Users/yanadoo/Documents/soransoran-m0
NPX="$(which npx)"
NODEBIN="$(dirname "$(which node)")"
LOGDIR="$HOME/Library/Logs/soransoran"   # 🔴 Documents 밖이어야 한다
# 🔴 JOB 하나가 **템플릿 파일명이자 launchd Label** 이다. 이 디렉터리의 템플릿은
#    파일명과 Label 을 일치시켜 두었으므로, 아래 render·lint·load·print 가 전부 같은 것을 가리킨다.
JOB=com.soransoran.supply-collect-82cook-thin

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
(`raw-collect-82cook` → `SORAN_82COOK_COLLECT_ENABLED` ·
 `supply-collect-82cook-thin` → `SORAN_82COOK_THIN_DETAIL_ENABLED`)
kill switch 는 plist 가 아니라 환경변수다 — plist 를 지우지 않고도 멈출 수 있어야 한다.

## 되돌리기

```bash
launchctl unload ~/Library/LaunchAgents/com.soransoran.supply-collect-82cook-thin.plist
rm ~/Library/LaunchAgents/com.soransoran.supply-collect-82cook-thin.plist
```

또는 **더 빠르게**: `.env.local` 에서 그 job 의 스위치를 `false` 로.
plist 는 계속 돌지만 수집이 일어나지 않는다.

## 확정 수집원은 셋뿐이고, 수집 job 은 서로 독립이다

🔴 **한 source 의 실패가 다른 source 의 공급을 세우지 않는다.** 그래서 수집은 job 으로 나뉘어 있다 —
세 source 를 한 회차에 묶어 돌리던 옛 구조에서는 82cook 하나가 `ECONNREFUSED` 이면
이미 받아 둔 네이버 수집물까지 처리되지 못했다(2026-09-10 실측: 이틀간 신규 공급 0).
그 구조의 폐기 경위는 [Raw 공급망 설계 §4-AU](../2026-09-03-raw-supply-chain-design.md) 에 있다.

| 수집원 | Label / 템플릿 파일명 | 시각 (KST) | 명령 |
|---|---|---|---|
| 82cook 목록 | `com.soransoran.raw-collect-82cook` | **07:00 · 10:00 · 13:00 · 16:00 · 19:00** (5회) | `micro-seed-collect-82cook.mts --list --pages=3 --live` |
| 82cook 본문 (공급 레인) | `com.soransoran.supply-collect-82cook-thin` | **07:40 · 10:40 · 13:40 · 16:40 · 19:40** (5회 · 목록 40분 뒤) | `micro-seed-82cook-thin-detail.mts --cap=17 --live` |
| navercafe:remonterrace (레몬테라스) | `com.soransoran.navercafe-collect-remonterrace-multi` | **07:30 · 10:30 · 13:30 · 16:30 · 21:30** (5회) | `micro-seed-navercafe-run.mts --cafe=remonterrace --phase=start --thin --live` |
| navercafe:wgang (우아한 갱년기) | `com.soransoran.navercafe-collect-wgang-multi` | **09:30 · 11:30 · 15:30 · 20:30** (4회) | `micro-seed-navercafe-run.mts --cafe=wgang --phase=start --thin --live` |

🔴 **82cook 은 두 job 이 같은 서버를 두드린다.** 하루 상한 400건을 나눠 쓴다 —
목록 job = robots 1 + 목록 3 = **4/회차** × 5 = 20
본문 job = robots 1 + 상세 17 = **18/회차** × 5 = 90
→ **110/day** (상한 400, 여유 290).
🔴 목록 job 은 본문을 열지 않는다 — `--auto --auto-max=30` 은 2026-09-13 에 뗐다.
🔴 본문은 목록의 **40분 뒤**다. 목록이 먼저 쌓여야 열 대상이 생긴다 —
같은 분에 두면 빈 목록을 보고 0건으로 끝난다.
`--cap` 의 정본은 [`src/lib/collect-schedule.ts`](../../../src/lib/collect-schedule.ts) 의
`THIN_82COOK_CAP_PER_RUN` 이고, fixture 가 plist 인자와 대조한다.

🔴 **네이버 두 카페는 `--pages` · `--max` 를 인자로 받지 않는다.** 회차가 읽을 게시판·페이지와
회차당 상세 몫은 runner 가 `BOARD_TARGETS` · `RUNS_PER_DAY` · 하루 요청 상한에서 역산한다.
무엇을 넘길지 보려면 `--live` 없이 돌린다 (네트워크 0 · DB 0):

```bash
npx tsx scripts/micro-seed-navercafe-run.mts --cafe=remonterrace
```

🟡 `dlxogns01` · `masanmam` · `goondae` · `yeowooya` 는 **미활성 장래 후보**다.
수집기가 아는 카페일 뿐 확정 수집원도 현재 스케줄도 아니며, **실행 템플릿을 두지 않는다.**
늘리려면 그때 승인을 받고 템플릿을 새로 만든다 — fixture 가 이 넷의 템플릿이 없는지 검사한다.

## 🔴 확정 운영 일정 (2026-09-11 · 전부 KST)

```
82cook 목록      07:00 10:00 13:00 16:00 19:00        5회
82cook 본문      07:40 10:40 13:40 16:40 19:40        5회   ← 목록 40분 뒤
remonterrace     07:30 10:30 13:30 16:30 21:30        5회
wgang            09:30 11:30 15:30 20:30              4회
supply-process   08:15 12:15 14:15 17:15 21:15 22:15  6회   ← 수집 뒤에 비운다
```

🔴 **노트북을 켜 두는 07:00~22:30 안에만 둔다.** 앞선 판은 하루에 고르게 폈고,
그래서 02:50 · 04:20 · 01:10 처럼 **기계가 꺼져 있는 시각**에 슬롯이 있었다 —
예약은 있는데 회차는 돌지 않는다. **돌지 않는 슬롯은 능력이 아니다.**

🔴 **게시판·페이지 설정은 바꾸지 않았다** (jjong 2~16p · humor 1p · wgang:all 1~5p).
바뀐 것은 **언제 도는가** 하나다.

🔴 시각의 정본은 [`src/lib/collect-schedule.ts`](../../../src/lib/collect-schedule.ts) 의
`SLOTS` · `THIN_82COOK_SLOTS` · `SUPPLY_PROCESS_SLOTS` 다.
이 문서의 표는 그것을 옮겨 적은 것이고, fixture 가 **render 한 실제 plist** 와 대조한다.

## 🔴 운영 예약 job 은 다섯이다

정본은 [`src/lib/runtime-isolation.ts`](../../../src/lib/runtime-isolation.ts) 의 `RUNTIME_JOBS` 다.
격리 검사와 배포가 **이 목록과 실제 loaded 를 정확히 대조**한다.

```
① com.soransoran.navercafe-collect-remonterrace-multi   수집
② com.soransoran.navercafe-collect-wgang-multi          수집
③ com.soransoran.raw-collect-82cook                     수집 — 목록을 만든다
④ com.soransoran.supply-collect-82cook-thin             수집 — ③의 목록을 소비한다
⑤ com.soransoran.supply-process                         처리
```

🔴 **82cook 은 두 job 이 함께 있어야 한다.** ④는 목록을 스스로 만들지 않는다 —
③이 없으면 열 대상이 0 이고, 82cook 공급은 조용히 0 이 된다.
🔴 `raw-import`(Raw Vault 적재)는 이 목록에 없다. 공급 레인이 아니라 보관 레인이다.

## 목록

| 템플릿 | 무엇을 | 환경 |
|---|---|---|
| `com.soransoran.raw-collect-82cook.plist.template` | 82cook Raw Vault 수집 (**5회/day** 07:00·10:00·13:00·16:00·19:00 KST) | 로컬 또는 GHA 대체 가능 |
| `com.soransoran.supply-collect-82cook-thin.plist.template` | 82cook 얇은 상세 수집 (4슬롯) | 로컬 또는 GHA 대체 가능 |
| `com.soransoran.raw-import.plist.template` | 수집분 Raw Vault 적재 (하루 4슬롯) | 로컬 |
| `com.soransoran.navercafe-collect-remonterrace-multi.plist.template` | 레몬테라스 수집 (4슬롯) | 🔴 **로컬 전용** (세션이 이 기계에만 있다) |
| `com.soransoran.navercafe-collect-wgang-multi.plist.template` | 우아한 갱년기 수집 (4슬롯) | 🔴 **로컬 전용** (세션이 이 기계에만 있다) |
| `com.soransoran.supply-process.plist.template` | 공급 처리(drain) — 미처리 입력을 변환→판정→초안→적재 (6슬롯) | 🔴 **로컬 전용** (§4-AU) |

## 공급 처리(drain) 등록 (승인 후)

🔴 **이 job 은 수집하지 않는다.** 수집 job 들이 남긴 **미처리 입력만** 비운다.
그래서 어느 수집원이 실패했는지 묻지 않고, 반대로 수집 job 도 이 job 의 상태를 보지 않는다.

```bash
# ── 0) 🔴 .env.local 에 스위치 하나 ──
#    SORAN_SUPPLY_PROCESS_ENABLED=true
#    🔴 수집 job 의 스위치는 따로다 (SORAN_82COOK_THIN_DETAIL_ENABLED ·
#       SORAN_82COOK_COLLECT_ENABLED · SORAN_NAVERCAFE_COLLECT_ENABLED).
#       한 스위치가 수집과 처리를 동시에 끄면, 82cook 을 멈추려다 공급 전체가 멈춘다.

# ── 1) 첫 실행은 사람이 본다 — dry-run 은 네트워크 0 · LLM 0 · DB write 0 ──
npm run supply:process                        # 무엇이 밀려 있는지 · 무엇을 할지
npm run supply:process -- --simulate-stock=5  # 재고가 모자랐다면 무엇을 할지

# ── 2) 위 "등록 절차" 의 0~5 를 JOB 만 바꿔 그대로 돌린다 ──
JOB=com.soransoran.supply-process
```

실행 시각은 **08:15 · 12:15 · 14:15 · 17:15 · 21:15 · 22:15 KST** 6회다.
🔴 **수집 슬롯 뒤에 붙인다** — 07:00/07:30/07:40 수집 → 08:15 처리, 21:30 수집 → 22:15 처리.
입력이 생긴 뒤에 비워야 대기 시간이 줄고, 그만큼 APPROVED 순증이 빨라진다.
🔴 22:15 가 마지막이다 — 노트북이 22:30 쯤 꺼지므로 그 앞에 한 번 더 비운다.

🔴 **미처리 입력이 없으면 정상 no-op 이다** — 네트워크 0 · LLM 0 · DB write 0.
조용한 날이 실패로 보이지 않아야 진짜 실패가 눈에 띈다.

🔴 **재고 700 은 APPROVED 버퍼 목표이지 수집 스위치가 아니다.** 재고가 700 이상이면
파일 단계(얇은 변환 · 검수용 변환)만 돌고 모델과 DB 는 쉰다. **수집 job 은 영향받지 않는다.**

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
   npx tsx scripts/micro-seed-collect-navercafe.mts --cafe=remonterrace --pages=1 --max=3 --live
   🔴 목록 셀렉터는 첫 live 실측으로 확정한다 — 네이버는 iframe 구조이고
      신형·구형 DOM 이 섞여 있어 실제 페이지를 보기 전에는 확정할 수 없다.
      0건이면 스크립트가 throw 한다(조용히 넘어가지 않는다).
```

**카페마다 plist 를 따로 둔다.** 한 카페를 연속으로 긁지 않고 시간대를 나눈다.

`-multi` job 이 정본이다. 시(hour)를 어긋나게 두어 두 카페가 같은 시각에 돌지 않는다.

```
remonterrace  07:30 · 10:30 · 13:30 · 16:30 · 21:30 KST (5회)
wgang         09:30 · 11:30 · 15:30 · 20:30 KST (4회)
```

🔴 **카페는 이 둘이 전부**이며, 같은 시각에 돌지 않는 것을 fixture 가 검사한다.

> 📜 **역사** — Wave B 이전에는 1회판 job 두 개(`09:20 remonterrace` · `13:20 wgang`)가 돌았다.
> 그 job 도 템플릿도 지금은 없다. 아래 문서에 남은 09:20/13:20 표기는 **그때의 기록**이지
> 운영 정본이 아니다: `2026-09-08-scale-foundation.md` · `2026-09-08-d10-activation-prep.md` ·
> `2026-09-03-raw-supply-chain-design.md`.
