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

🔴 **네이버 카페 템플릿은 아직 없다.** 수집기가 구현되지 않았다(PR-S2-b).
네이버는 쿠키 때문에 **로컬 전용**이며 GHA 로 올리지 않는다.
