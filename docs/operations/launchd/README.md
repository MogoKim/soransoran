# launchd 템플릿 — 🔴 등록되어 있지 않다

> 정본: [Raw 공급망 설계 §5](../2026-09-03-raw-supply-chain-design.md) ·
> [헌법 §6-9-F](../../constitution/MICRO_SEED_LANE_CONSTITUTION.md)

이 디렉터리의 `.plist.template` 은 **템플릿이다. `~/Library/LaunchAgents/` 에 복사되어 있지 않고
`launchctl load` 되지도 않았다.**

🔴 **"등록됐는가" 의 정본은 이 디렉터리가 아니라 `launchctl list` 와 `~/Library/LaunchAgents/` 다.**

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

## 왜 템플릿까지만 두는가

```
🟢 이 PR      무엇을 · 언제 · 어떤 인자로 돌릴지 확정
🔴 별도 절차   실제 등록 (창업자 승인 + 첫 수동 실행 검증 후)
```

헌법 §6-9-F 개정으로 **공급 cron 을 붙일 자격**이 생겼을 뿐,
자격과 등록은 다르다. 첫 live 수집을 사람이 한 번 보고 나서 붙인다.

## 🔴 등록이 조용히 실패하는 두 가지 (2026-09-07 실측)

supply-autopilot 을 처음 등록했을 때 job 은 `loaded` 인데 **exit 78 로 죽고 로그가 0바이트**였다.
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
JOB=com.soransoran.raw-collect-82cook

# ── 1) 로그 디렉터리를 먼저 만든다 ──
mkdir -p "$LOGDIR"

# ── 2) 치환 ──
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

🔴 **`.env.local` 에 `SORAN_82COOK_COLLECT_ENABLED=true` 가 없으면 `--live` 는 무시된다.**
kill switch 는 plist 가 아니라 환경변수다 — plist 를 지우지 않고도 멈출 수 있어야 한다.

## 되돌리기

```bash
launchctl unload ~/Library/LaunchAgents/com.soransoran.raw-collect-82cook.plist
rm ~/Library/LaunchAgents/com.soransoran.raw-collect-82cook.plist
```

또는 **더 빠르게**: `.env.local` 에서 `SORAN_82COOK_COLLECT_ENABLED` 를 `false` 로.
plist 는 계속 돌지만 수집이 일어나지 않는다.

## 확정 수집원은 셋뿐이다

| 수집원 | Label / 템플릿 파일명 | 시각 (KST) | 명령 |
|---|---|---|---|
| 82cook | `com.soransoran.raw-collect-82cook` | 2시간 간격 10슬롯 (07:10~01:10) | `micro-seed-collect-82cook.mts --list --pages=3 --auto --auto-max=30 --live` |
| navercafe:remonterrace (레몬테라스) | `com.soransoran.navercafe-collect-remonterrace` | **09:20** | `micro-seed-collect-navercafe.mts --cafe=remonterrace --pages=1 --max=10 --live` |
| navercafe:wgang (우아한 갱년기) | `com.soransoran.navercafe-collect-wgang` | **13:20** | `micro-seed-collect-navercafe.mts --cafe=wgang --pages=1 --max=10 --live` |

🟡 `dlxogns01` · `masanmam` · `goondae` · `yeowooya` 는 **미활성 장래 후보**다.
수집기가 아는 카페일 뿐 확정 수집원도 현재 스케줄도 아니며, **실행 템플릿을 두지 않는다.**
늘리려면 그때 승인을 받고 템플릿을 새로 만든다 — fixture 가 이 넷의 템플릿이 없는지 검사한다.

## 목록

| 템플릿 | 무엇을 | 환경 |
|---|---|---|
| `com.soransoran.raw-collect-82cook.plist.template` | 82cook 자동 수집 (2시간 간격 10슬롯) | 로컬 또는 GHA 대체 가능 |
| `com.soransoran.raw-import.plist.template` | 수집분 Raw Vault 적재 (하루 4슬롯) | 로컬 |
| `com.soransoran.navercafe-collect-remonterrace.plist.template` | 레몬테라스 수집 (09:20 KST 1슬롯) | 🔴 **로컬 전용** |
| `com.soransoran.navercafe-collect-wgang.plist.template` | 우아한 갱년기 수집 (13:20 KST 1슬롯) | 🔴 **로컬 전용** |
| `com.soransoran.supply-autopilot.plist.template` | 공급 Autopilot v1 — 재고 14 미만일 때만 수집→판정→생성→적재 (21:10 KST 1슬롯) | 🔴 **로컬 전용** (§4-AU) |

## 공급 Autopilot 등록 (승인 후)

```bash
# ── 0) 🔴 .env.local 에 스위치 둘. 하나라도 없으면 러너가 시작 전에 멈춘다 ──
#    SORAN_SUPPLY_AUTOPILOT_ENABLED=true
#    SORAN_82COOK_THIN_DETAIL_ENABLED=true

# ── 1) 첫 실행은 사람이 본다 — dry-run 은 네트워크 0 · LLM 0 · DB write 0 ──
npm run supply:autopilot                        # 오늘 재고로 판정만
npm run supply:autopilot -- --simulate-stock=5  # 부족했다면 무엇을 할지

# ── 2) 위 "등록 절차" 의 0~5 를 JOB 만 바꿔 그대로 돌린다 ──
JOB=com.soransoran.supply-autopilot
```

실행 시각은 **21:10 KST**, auto-publish(00:05 KST)보다 약 3시간 앞선다.
재고가 목표(14건) 이상이면 그 한 번도 네트워크로 나가지 않는다.

🔴 **멈추는 가장 빠른 방법**은 `.env.local` 의 `SORAN_SUPPLY_AUTOPILOT_ENABLED` 를 지우는 것이다.
job 은 계속 돌지만 재고만 읽고 끝난다 — 네트워크도 모델도 DB 도 건드리지 않는다.

## 🔴 네이버 카페는 등록 전 선행 조건이 셋이다 (PR-S2-b-2)

```
① 소란소란 전용 네이버 계정 · 세션 발급 (PR-S2-b-3)
   npx tsx scripts/navercafe-session-setup.mts --open   🔴 창업자가 직접 로그인한다
   .env.local  SORAN_NAVERCAFE_SESSION_PATH=.naver-session/soransoran-storage-state.json
               SORAN_NAVERCAFE_COLLECT_ENABLED=false    (수집 개시는 별도 승인)
   🔴 우나어 storage-state.json 재사용은 judgeSession 이 코드로 막는다 —
      한쪽이 막히면 둘 다 멈추고, 계정 정지는 되돌릴 수 없다
   🔴 세션 파일은 .gitignore 가 막는다. 헬퍼는 막혀 있지 않으면 저장을 거부한다

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

**카페마다 plist 를 따로 둔다.** 한 카페를 연속으로 긁지 않고 시간대를 나눈다 —
`09:20 remonterrace` · `13:20 wgang`. 🔴 **이 둘이 확정 수집원의 전부**이며,
같은 시각에 돌지 않는 것을 fixture 가 검사한다.
