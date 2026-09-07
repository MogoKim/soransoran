# launchd 템플릿 — 🔴 등록되어 있지 않다

> 정본: [Raw 공급망 설계 §5](../2026-09-03-raw-supply-chain-design.md) ·
> [헌법 §6-9-F](../../constitution/MICRO_SEED_LANE_CONSTITUTION.md)

이 디렉터리의 `.plist.template` 은 **템플릿이다. `~/Library/LaunchAgents/` 에 복사되어 있지 않고
`launchctl load` 되지도 않았다.**

🔴 **등록은 창업자 승인 후 별도 절차다.** 등록하는 순간 되돌리는 주체가 사람이 된다 —
이 PR 은 "무엇을 등록할 것인가" 까지만 정한다.

## 왜 템플릿까지만 두는가

```
🟢 이 PR      무엇을 · 언제 · 어떤 인자로 돌릴지 확정
🔴 별도 절차   실제 등록 (창업자 승인 + 첫 수동 실행 검증 후)
```

헌법 §6-9-F 개정으로 **공급 cron 을 붙일 자격**이 생겼을 뿐,
자격과 등록은 다르다. 첫 live 수집을 사람이 한 번 보고 나서 붙인다.

## 등록 절차 (승인 후)

```bash
# 1) 값 치환 — 템플릿의 __PLACEHOLDER__ 를 실제 경로로
sed -e "s#__NODE__#$(which node)#g" \
    -e "s#__NPX__#$(which npx)#g" \
    -e "s#__REPO__#/Users/yanadoo/Documents/soransoran-m0#g" \
    docs/operations/launchd/com.soransoran.raw-collect-82cook.plist.template \
    > ~/Library/LaunchAgents/com.soransoran.raw-collect-82cook.plist

# 2) 등록
launchctl load ~/Library/LaunchAgents/com.soransoran.raw-collect-82cook.plist

# 3) 확인 — 두 번째 컬럼이 마지막 exit status 다
launchctl list | grep soransoran
```

🔴 **`.env.local` 에 `SORAN_82COOK_COLLECT_ENABLED=true` 가 없으면 `--live` 는 무시된다.**
kill switch 는 plist 가 아니라 환경변수다 — plist 를 지우지 않고도 멈출 수 있어야 한다.

## 되돌리기

```bash
launchctl unload ~/Library/LaunchAgents/com.soransoran.raw-collect-82cook.plist
rm ~/Library/LaunchAgents/com.soransoran.raw-collect-82cook.plist
```

또는 **더 빠르게**: `.env.local` 에서 `SORAN_82COOK_COLLECT_ENABLED` 를 `false` 로.
plist 는 계속 돌지만 수집이 일어나지 않는다.

## 목록

| 템플릿 | 무엇을 | 환경 |
|---|---|---|
| `com.soransoran.raw-collect-82cook.plist.template` | 82cook 자동 수집 (2시간 간격 10슬롯) | 로컬 또는 GHA 대체 가능 |
| `com.soransoran.raw-import.plist.template` | 수집분 Raw Vault 적재 (하루 4슬롯) | 로컬 |
| `com.soransoran.navercafe-collect.plist.template` | 네이버 카페 수집 (카페별 1슬롯) | 🔴 **로컬 전용** |
| `com.soransoran.supply-autopilot.plist.template` | 공급 Autopilot v1 — 재고 14 미만일 때만 수집→판정→생성→적재 (21:10 KST 1슬롯) | 🔴 **로컬 전용** (§4-AU) |

## 공급 Autopilot 등록 (승인 후)

```bash
# 0) 🔴 .env.local 에 스위치 둘. 하나라도 없으면 러너가 시작 전에 멈춘다
#    SORAN_SUPPLY_AUTOPILOT_ENABLED=true
#    SORAN_82COOK_THIN_DETAIL_ENABLED=true

# 1) 첫 실행은 사람이 본다 — dry-run 은 네트워크 0 · LLM 0 · DB write 0
npm run supply:autopilot                      # 오늘 재고로 판정만
npm run supply:autopilot -- --simulate-stock=5  # 부족했다면 무엇을 할지

# 2) 🔴 로그 디렉터리를 **먼저** 만든다
#    StandardOutPath 의 상위 디렉터리가 없으면 launchd 가 job 을 띄우지 못한다.
#    "등록은 됐는데 아무 일도 안 일어나는" 상태가 되고, 원인이 화면에 안 보인다.
mkdir -p /Users/yanadoo/Documents/soransoran-m0/logs

# 3) 값 치환 + 문법 검증 — 🔴 lint 를 통과해야 등록한다
sed -e "s#__NPX__#$(which npx)#g" \
    -e "s#__REPO__#/Users/yanadoo/Documents/soransoran-m0#g" \
    docs/operations/launchd/com.soransoran.supply-autopilot.plist.template \
    > ~/Library/LaunchAgents/com.soransoran.supply-autopilot.plist

plutil -lint ~/Library/LaunchAgents/com.soransoran.supply-autopilot.plist

# 4) 등록 — 🔴 멱등적이다. 이미 있으면 걷어내고 다시 올린다
launchctl unload ~/Library/LaunchAgents/com.soransoran.supply-autopilot.plist 2>/dev/null || true
launchctl load  ~/Library/LaunchAgents/com.soransoran.supply-autopilot.plist

# 5) 확인 — 두 번째 컬럼이 마지막 exit status 다
launchctl list | grep supply-autopilot
```

🔴 **위 절차는 몇 번을 돌려도 같은 상태가 된다.** `mkdir -p` · `sed >` · `unload || true` 는
이미 그런 상태면 아무 일도 하지 않는다. 반쯤 등록된 상태가 남지 않는다.

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
`09:20 remonterrace` · `13:20 wgang` · `17:20 dlxogns01` · `21:20 masanmam`.
