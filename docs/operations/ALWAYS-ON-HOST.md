# 상시 실행 호스트 — 의존성 목록 · 이전 묶음 · 전환/되돌리기

> 작성 2026-09-29 · Track C (M3 상시 실행)
> 코드 정본: `scripts/host-migrate.mts` (CLI) · `scripts/lib/host-migrate.mts` (판정) · `scripts/host-migrate-check.mts` (검사)
> 🔴 이 문서의 숫자는 **2026-09-29 측정 스냅샷**이다. 현재값은 `npm run host:migrate` 로 다시 잰다.

## 1. 왜 필요한가

무인 루프 13개(공급 처리 · 네이버 수집 2 · 발행 heartbeat · 댓글 루프 · 자동 READY 감사 ·
단계 controller · 복구 · keep-awake · 매거진 4)가 **창업자 노트북의 launchd gui 도메인**에서 돈다.
노트북이 잠들거나, 덮개가 닫히거나, 로그아웃하거나, 네트워크가 끊기면 전부 선다.
`keep-awake`(caffeinate `-i -s`)는 임시 bridge 다 — `-s` 는 AC 전원에서만 듣는다.

이 문서는 ① 지금 무엇에 기대고 있는지(측정/추정 구분), ② 그것을 전용 Mac 한 대로 옮기는 묶음,
③ 두 호스트가 동시에 돌지 않게 하는 구조, ④ 창업자가 내려야 할 결정 하나를 적는다.

## 2. 의존성 목록 (2026-09-29 측정)

표기: **[측정]** 이 기계에서 명령으로 읽은 값 · **[추정]** 코드·문서·일반 동작에서 추론한 값

### 2.1 전원

| 항목 | 현재 | 위험 |
|---|---|---|
| 기계 | [측정] `Mac15,13` (MacBook Air 15", arm64) · macOS 15.7.5 | 노트북 — 배터리·덮개가 있다 |
| 전원 | [측정] `pmset -g batt` 배터리 23% 방전 중 · 9/28~29 pmset 로그 전원 표기 93건 중 81건이 `Using Batt` | 배터리에서는 caffeinate `-s` 무효 |
| 잠자기 | [측정] 9/29 03:10 `Software Sleep` → 05:20 사용자 깨움까지 **2시간 10분 잠듦**. 그 사이 DarkWake 만 8회(각 2~5초) | 이 창의 예약 job 은 돌지 않거나 깨어난 뒤 몰려서 돈다 |
| 잠자기 빈도 | [측정] 9/26 14회 · 9/27 32회 · 9/28 23회 Sleep 진입 | — |
| pmset | [측정] `sleep 0`(Chrome·caffeinate 등 assertion 때문) · `standby 1` · `powernap 1` · `hibernatemode 3` · `womp 0` · `autorestart` 항목 없음 | 정전 뒤 자동으로 켜지지 않는다 |
| keep-awake | [측정] `com.soransoran.keep-awake` pid 상주, `PreventSystemSleep` assertion 보유 | [추정] 덮개 닫힘(clamshell)·배터리 잠자기는 막지 못한다 |

### 2.2 로그인 세션

| 항목 | 현재 | 위험 |
|---|---|---|
| 도메인 | [측정] 13개 job 전부 `~/Library/LaunchAgents` (gui/501) | [추정] 로그아웃하면 전부 내려간다 |
| 자동 로그인 | [측정] `autoLoginUser` 없음 | [추정] 재부팅 뒤 **누군가 로그인할 때까지 job 0개** |
| FileVault | [측정] Off | 자동 로그인을 켤 수 있는 상태(FileVault 가 켜져 있으면 macOS 가 자동 로그인을 막는다) |

### 2.3 네트워크

| 대상 | 누가 쓰나 | 현재 |
|---|---|---|
| Supabase pooler (`DATABASE_URL` · `DIRECT_URL` 호스트) | 공급·발행·댓글·감사·단계 | [측정] TCP 연결됨 (호스트 이름은 기록하지 않는다) |
| generativelanguage.googleapis.com | 공급 처리 · 댓글 · 감사 (Gemini) | [측정] 443 연결됨 |
| api.anthropic.com · api.openai.com | 공급 LLM 경로 | [측정] 443 연결됨 |
| cafe.naver.com · nid.naver.com | 네이버 수집 2개 | [측정] 443 연결됨 · [추정] 새 기기·IP 에서 세션 쿠키가 무효가 될 수 있다(사람이 다시 로그인) |
| www.82cook.com | 82cook 수집 | [측정] 443 연결됨 |
| github.com | runtime clone · `runtime:deploy` fetch · 매거진 PR | [측정] 443 연결됨 |
| hooks.slack.com | 알림 | [측정] 443 연결됨 |
| sheets.googleapis.com · oauth2.googleapis.com | micro-seed 시트 | [측정] 443 연결됨 |
| Wi-Fi 끊김 | 전부 | [추정] 잠에서 깬 직후 네트워크가 늦게 붙어 회차가 exit 1 로 끝나는 모양이 반복된다 |

### 2.4 자격증명

| 무엇 | 위치 | 묶음 |
|---|---|---|
| 운영 env (DB·LLM 키·스위치 30개) | [측정] `~/Library/Application Support/soransoran/env.local` (0600) · runtime `.env.local` 은 이 파일로 가는 **심볼릭 링크** | 🔐 싣는다(0600) |
| 네이버 로그인 storage state | [측정] `…/soransoran/naver-session/` (0600) | 🔐 싣는다 |
| Slack webhook | [측정] `~/.config/soransoran/slack.env` (0600) | 🔐 싣는다 |
| GitHub | [추정] `gh` 토큰은 Keychain | ✋ 대상에서 `gh auth login` |
| gcloud ADC | [측정] `~/.config/gcloud/application_default_credentials.json` 존재 | ✋ 대상에서 다시 로그인(refresh token 을 두 기기가 나눠 쓰지 않는다) |
| ChatGPT 자동화 프로필 | [측정] `~/Library/Application Support/soransoran-chatgpt-auto` | ✋ 매거진 runbook 절차 |
| claude CLI | [측정] `~/.local/bin/claude` (매거진 plist PATH) | ✋ 대상에서 설치·로그인 |
| 옛 env 사본 9개 · `env-backup` | [측정] 운영 디렉터리 | ⚪ 싣지 않는다 — 비밀을 더 퍼뜨리지 않는다 |

### 2.5 절대경로 · nvm

- [측정] 설치 plist 13개 전부가 `/Users/yanadoo/...` 를 박고 있다 — runtime 경로, 로그 경로, 매거진 runtime, `HOME`, `PATH`.
- [측정] node 는 nvm `v24.14.0` 절대경로(`…/.nvm/versions/node/v24.14.0/bin/npx`)로 박혀 있다.
  [추정] nvm 으로 node 를 올리거나 지우면 job 전부가 `npx` 를 못 찾고 죽는다 — launchd PATH 에는 nvm 이 없다.
- [측정] env 키 중 `SORAN_NAVERCAFE_SESSION_PATH` 의 값이 홈 경로다 — 대상 홈으로 바꿔 써야 한다.
- [측정] runtime 배포기·격리 검사가 `join(homedir(), 'Documents', 'soransoran-runtime')` 를 박아 두었다 —
  대상에서도 **홈 아래 같은 배치**(`~/Documents/soransoran` · `-runtime` · `-magazine-runtime`)를 지킨다.
- [측정] runtime HEAD = pin = `7d29dbf`. 매거진 runtime HEAD = `ab17ca0`(분리되지 않은 `main` 브랜치).

### 2.6 재부팅하면

[추정] 전원이 다시 들어와도(지금은 `autorestart` 없음 → 켜지지도 않는다) 로그인 전까지 LaunchAgent 는 하나도 돌지 않는다.
로그인하면 `~/Library/LaunchAgents` 에 **파일이 있는 job 전부**가 다시 올라온다 — 내려 둔 job 도 파일이 남아 있으면 되살아난다
(2026-09-09 · 2026-09-16 실측 사고). 그래서 아래 quiesce 는 bootout 과 **파일 이동**을 함께 한다.

### 2.7 측정 중 발견 (다른 레인)

- [측정] 2026-09-29 07:35:21 KST `~/Library/LaunchAgents/com.soransoran.magazine-auto-register.plist` 가
  **23바이트 JSON(`[{"Hour":1,"Minute":0}]`)으로 덮여 있다**. 같은 날 07:3x 의 plan 에서는 정상 plist 였다.
  launchctl 은 아직 옛 설정을 물고 있지만(`last exit 1`), 다음 로그인·재부팅 때 이 job 은 올라오지 못한다.
  매거진 레인 소유라 이 작업에서는 고치지 않았다. export/verify 가 이것을 `PLIST` 문제로 잡는다.

## 3. 이전 묶음

```bash
npm run host:migrate                                             # plan (읽기 전용)
npm run host:migrate -- export --out=<dir> [--cutover]           # 묶음 만들기
npm run host:migrate -- verify --bundle=<dir>                    # 해시 · 권한 · 누출 · 템플릿
npm run host:migrate -- install --bundle=<dir> --target-home=$HOME [--target-node-bin=<dir>] [--render-to=<dir>] [--apply]
npm run host:migrate -- rollback --bundle=<dir> --target-home=$HOME [--apply]   # 대상
npm run host:migrate -- quiesce [--apply]                                       # 원 호스트
npm run host:migrate -- unquiesce --bundle-id=<id> [--apply]                    # 원 호스트
npm run host:migrate-check                                                      # 검사 (운영 홈 0 · launchctl 0)
```

### 3.1 묶음에 들어가는 것

| 폴더 | 내용 |
|---|---|
| `state/` | 운영 디렉터리 중 분류가 `state`·`secret` 인 항목 — 장부(llm·댓글·감사), 수집 원본, heartbeat 틱 표식, pin·manifest, env.local(0600), 네이버 세션(0600) |
| `home/.config/soransoran/slack.env` | Slack webhook (0600) |
| `launchd/*.plist.template` | 설치 plist 를 **호스트 중립 템플릿**으로 되돌린 것(`__REPO__` · `__NPX__` · `__NODEBIN__` · `__LOGDIR__` · `__MAGAZINE_REPO__` · `__HOME__`) |
| `logs/` | `~/Library/Logs/soransoran` (연속성) |
| `host-bundle.json` | manifest — 파일마다 sha256 · 크기 · 권한 · 종류, env **키 이름만**, plist 별 내보낼 때 loaded 여부 |

- 🔴 **모르는 항목은 싣지 않고 export 를 멈춘다**(`unclassified`). 분류는 `scripts/lib/host-migrate.mts` 의 규칙 표에 적는다.
- 🔴 쥔 잠금(`*.lock` · 매거진 임대 · 배포 잠금)은 싣지 않는다 — 대상에서 영영 풀리지 않는다. 예외: heartbeat `tick-<시각>.lock` 은 지난 틱 표식이라 싣는다.
- 🔴 묶음은 git 작업트리·운영 경로 안에 만들지 않는다. 묶음 디렉터리 0700 · 비밀 파일 0600.
- 🔴 화면에 나가는 모든 줄은 비밀 값·비밀 모양 패턴을 가린다. verify 는 비밀이 아닌 파일·manifest 에 비밀이 있으면 `LEAK` 으로 실패한다(파일·키 이름만 적는다).

### 3.2 plist 다시 찍기

설치본(= 지금 실제로 도는 설정, heartbeat/fixed 모드 · 댓글 러너 설치 여부 포함)을 긴 경로부터 placeholder 로 되돌리고,
대상에서 `launchd-install.render` 한 벌로 다시 찍는다. 찍은 뒤 **치환 안 된 placeholder 0 · 대상 홈이 아닌 `/Users/<누구>` 경로 0 ·
Label = 파일 이름 · ProgramArguments 있음**이어야 쓴다. 저장소 템플릿과 두 벌을 만들지 않는다.

## 4. 두 호스트가 동시에 돌 수 없게 하는 구조

같은 job 이 두 기계에서 돌면: 네이버·82cook 요청 간격이 두 배가 되고(영구 안전장치 위반), LLM 일 예산 장부가
기계마다 따로 차서 예산이 두 배가 되고, 발행·댓글은 DB 에서 경쟁한다.

1. **원 호스트를 먼저 완전히 내린다** — `quiesce --apply` 는 실행 중 회차가 있으면(keep-awake 제외) 거부하고,
   없으면 전부 `bootout` 한 뒤 **plist 파일을 LaunchAgents 밖**(`…/soransoran/host-migrate-quiesced/<시각>/`)으로 옮기고
   `host-handoff.json` 을 쓴다. 파일이 없으니 재부팅·로그인으로도 되살아나지 않는다.
2. **cutover 묶음은 원 호스트가 내려가 있을 때만 만들어진다** — `export --cutover` 는 launchctl 에 우리 job 0 ·
   LaunchAgents 에 plist 0 · handoff 있음 · 아직 다른 묶음으로 넘기지 않음을 확인한다. launchctl 을 못 읽으면 거부한다.
   만든 묶음 id 를 handoff 에 적는다 — 두 번째 cutover 묶음은 만들어지지 않는다.
3. **대상은 cutover 묶음만 올린다** — `install --apply` 는 rehearsal 묶음 · verify 실패 · 대상에 이미 plist/loaded job ·
   대상 운영 디렉터리 비어 있지 않음 · 대상 사용자 셸이 아님 · 사전 점검 미충족 중 하나라도 있으면 거부한다.
   소유 표식(`host-owner.json`)은 job 을 올리기 **전에** 쓴다.
4. **원 호스트 되살리기는 대상 내림을 증거로 요구한다** — `unquiesce --apply` 는 대상 `rollback` 이 찍어 준
   `--bundle-id` 가 handoff 의 id 와 같아야 한다. 원 호스트는 대상을 볼 수 없어서, 그 증거를 사람 손으로 한 번 건넨다.
5. **마지막 방어선(DB)** — 글·댓글 발행 트랜잭션은 Serializable 안에서 오늘 수를 다시 센다
   (`src/lib/original-post-publish-tx.ts` · `src/lib/persona-publish-tx.ts`). 두 회차가 같은 스냅샷을 읽어도 뒤의 것이 직렬화 실패로 진다.

🟡 **남는 구멍 — 정직하게 적는다.** 같은 cutover 묶음을 **두 대상**에 올리는 것은 막지 못한다(각 대상은 서로를 보지 못한다).
절차로 막는다: 묶음은 한 번 옮기고 곧바로 지운다(전환 순서 ⑨). DB 수준 lease 는 DB write 가 필요해 이번 범위 밖이다.

## 5. 전환 순서 · 되돌리기

CLI 가 같은 목록을 찍는다(`CUTOVER_ORDER` · `ROLLBACK_ORDER`).

전환
1. [원] `npm run host:migrate` — 계획
2. [원] `export --out=<외장/임시>` rehearsal 묶음 → 대상에서 `verify` · `install` dry-run 으로 사전 점검
3. [원] `quiesce --apply`
4. [원] `export --cutover --out=<dir>`
5. 옮기기 — 암호화된 외장 볼륨 또는 AirDrop. 클라우드 드라이브·메신저 금지
6. [대상] `verify --bundle=<dir>`
7. [대상] `install --bundle=<dir> --target-home=$HOME --apply` — clone(pin SHA) → 매거진 runtime → `npm ci`·`prisma generate` →
   state·로그 복원 → env(0600 · 홈 경로 키만 바꿈) + runtime `.env.local` 링크 → plist 쓰기·`plutil -lint` → 소유 표식 →
   `launchctl bootstrap`(내보낼 때 loaded 였던 것만) → `runtime:isolation-check --require-runtime`. plist 를 쓴 뒤 실패하면
   올린 job bootout → plist 보관 → 소유 표식 삭제(되돌리다 실패해도 나머지를 계속하고 남은 것을 적는다)
8. [대상] `npm run ops:status` · 첫 heartbeat · 댓글 회차 로그 확인
9. 양쪽 묶음 삭제

되돌리기
1. [대상] `rollback --bundle=<dir> --target-home=$HOME --apply`
2. [원] `unquiesce --bundle-id=<1이 찍은 id> --apply` — plist 제자리, 내리기 전 loaded 였던 job 만 bootstrap
3. [원] `npm run runtime:isolation-check -- --require-runtime`
- pin 은 되돌릴 것이 없다 — 원 호스트의 `runtime-pinned-sha` 는 이전 내내 바뀌지 않는다.

## 6. 이 기계에서 한 dry-run (2026-09-29 07:4x KST)

- `plan` — 운영 항목 41개 분류(state 19 · secret 2 · exclude 20 · 미분류 0), plist 13개 전부 다시 찍기 가능(당시), env 키 30개(이름만), 홈 경로 키 1개.
- `export --out=/private/tmp/soran-host-rehearsal-0929` (rehearsal) — 1,821 파일 · 57.2MB(state 1,773 · 비밀 3 · 템플릿 13 · 로그 32).
- `verify` — 해시·권한·누출 **통과**, `PLIST` 2건(§2.7 매거진 plist 손상) 때문에 실패로 끝남 — 의도대로 잡았다.
- `install --target-home=/private/tmp/soran-fake-home --render-to=…` (dry-run) — 다시 찍은 plist 13개 중 `/Users/yanadoo` 포함 0개,
  `plutil -lint` 실패 1개(손상된 매거진 plist). 사전 점검: 네트워크 12개 전부 연결, **배터리 있음 · autorestart 없음 · 자동 로그인 없음**으로 미충족 —
  이 노트북이 상시 호스트 조건을 못 맞춘다는 측정이다. `--apply` 는 rehearsal · verify 실패 · 다른 사용자 홈 · 사전 점검 미충족으로 거부.
- 묶음·렌더 결과는 곧바로 삭제했다. 실제 LaunchAgents · env.local · runtime · launchctl 은 건드리지 않았다.

## 7. 창업자 결정 하나

**전용 Mac 한 대를 정하고, 그 기계를 "AC 상시 전원 + 자동 로그인(FileVault 끔)" 으로 둘 것인가.**

- 권장: 새 Mac mini (Apple Silicon 기본형 · 16GB/256GB). 가격은 구매 시점에 확인한다 — M4 기본형 국내 출시가가
  약 89만 원(2024-11)이었다. 선택: 소형 UPS 약 10~20만 원(정전 뒤 깨끗한 종료 · `autorestart` 와 함께).
- 그 기계에 필요한 설정(설치 전 사람이 한다): `sudo pmset -a sleep 0 autorestart 1 womp 1` · 유선 LAN ·
  시스템 설정에서 자동 로그인 = 운영 사용자(→ FileVault 끔이 조건) · nvm node `v24.14.0` · gh/gcloud/claude 로그인.
- FileVault 를 끄지 않으면: 재부팅(업데이트·정전) 뒤 사람이 비밀번호를 칠 때까지 job 0개다. 이 교환을 받아들일지가 결정의 핵심이다.
