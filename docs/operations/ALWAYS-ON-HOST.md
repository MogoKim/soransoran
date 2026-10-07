# 상시 실행 호스트 — 의존성 목록 · 이전 묶음 · 전환/되돌리기

> 작성 2026-09-29 · Track C (M3 상시 실행) · 개정 2026-10-07 — 집 Mac 단일 owner 확정 · 기종 무관(AC 필수) ·
> 미분류 2→0 · rehearsal PASS(§6.4)
> 코드 정본: `scripts/host-migrate.mts` (CLI) · `scripts/lib/host-migrate.mts` (판정) · `scripts/host-migrate-check.mts` (검사)
> 🔴 §2와 §6.1~6.2의 숫자는 **작성 당시 측정 스냅샷**이다. 최신 plan은 §6.3과
> `npm run host:migrate`가 정한다. 단계·콘텐츠 정책은 D100 canon이 정한다.

## 1. 왜 필요한가 · 이번 범위

D100 무인 루프 9개가 **창업자 노트북의 launchd gui 도메인**에서 돈다.
노트북이 잠들거나, 덮개가 닫히거나, 로그아웃하거나, 네트워크가 끊기면 전부 선다.
`keep-awake`(caffeinate `-i -s`)는 임시 bridge 다 — `-s` 는 AC 전원에서만 듣는다.

**대상은 상시 켜 둘 Mac 한 대다 — 기종은 묻지 않는다.** 배터리 있는 MacBook 도 된다.
단 **D100 운영 조건은 AC 전원**이다: 사전 점검은 `pmset -g batt`(못 읽으면 `pmset -g ps`)를 읽어
"AC 에 꽂혀 있음(charging · charged · AC attached)" 이면 통과, "배터리로 돌고 있음(discharging · Battery Power)" 이면 실패로 본다.

### 1.0 2026-10-07 확정한 owner

- **집 Mac 한 대를 D100 9개 job의 유일한 owner로 쓴다.** 회사 Mac에는 매거진 job만 남긴다.
- 회사 Mac은 창업자의 통근 시간 08:15~09:40, 18:10~20:30에 덮개가 닫히므로 D100 owner 조건을 만족하지 못한다.
- 10월 7일 08:19:56 clamshell sleep → 09:12:50 wake가 실제로 관측됐고, 그 사이 09:10:27 첫 댓글
  마감을 놓쳐 D5 증명이 실패했다. `caffeinate`는 clamshell sleep을 막는 해결책이 아니다.
- 정상 운영은 창업자가 새벽에 일어나거나 통근 중 노트북을 열어 주는 것에 의존하지 않는다.
- owner 변경은 아래 cutover 절차로만 한다. 두 Mac에서 D100을 동시에 실행하지 않는다.

### 1.1 첫 이전 범위 = D100 레인 하나 (단일 정본 `D100_LANE_LABELS`)

| job | 무엇 |
|---|---|
| `com.soransoran.navercafe-collect-wgang-multi` | 네이버 수집 |
| `com.soransoran.navercafe-collect-remonterrace-multi` | 네이버 수집 |
| `com.soransoran.supply-process` | 공급 처리 |
| `com.soransoran.original-post-runner` | 발행 heartbeat |
| `com.soransoran.persona-comment-runner` | 댓글 루프 |
| `com.soransoran.auto-ready-audit` | 자동 READY 감사 |
| `com.soransoran.stage-controller` | 단계 controller |
| `com.soransoran.runner-recover` | 러너 복구 |
| `com.soransoran.keep-awake` | 잠자기 방지 |

묶음 · quiesce · 설치 · 되돌리기 · 소유/handoff 표식이 **전부 이 목록 하나에서 나온다**(`scripts/lib/host-migrate.mts`).
판정 함수가 스스로 목록으로 거른다 — 부르는 쪽이 걸러 주기를 믿지 않는다.

### 1.2 범위 밖 — 원 호스트에 그대로 남는다 (기본 거부)

- **매거진 전부**: `magazine-producer` · `magazine-watch` · `magazine-graph-watch` · `magazine-auto-register` job,
  매거진 runtime 작업트리(`~/Documents/soransoran-magazine-runtime`), 매거진 상태(`Application Support/soransoran/magazine-*` ·
  `regen-packets`), 매거진 로그, 매거진 자격증명(ChatGPT 프로필 `soransoran-chatgpt*` · claude CLI).
  원 호스트의 매거진 job 은 **loaded 그대로, plist 제자리**다. 묶음은 매거진 plist 를 **열어 보지도 않는다**.
- **꺼 둔 82cook job**: `supply-collect-82cook-thin` · `raw-collect-82cook` (로그도 싣지 않는다).
- **개발용·모르는 job**: allowlist 에 없으면 이름을 몰라도 건드리지 않는다.

## 2. 의존성 목록 (2026-09-29 측정)

표기: **[측정]** 이 기계에서 명령으로 읽은 값 · **[추정]** 코드·문서·일반 동작에서 추론한 값

### 2.1 전원

| 항목 | 현재 | 위험 |
|---|---|---|
| 기계 | [측정] `Mac15,13` (MacBook Air 15", arm64) · macOS 15.7.5 | 배터리·덮개가 있다 — 그 자체는 괜찮다. **AC 에 꽂혀 있지 않은 시간**이 문제다 |
| 전원 | [측정] `pmset -g batt` 배터리 23% 방전 중(09/29 새벽) · 9/28~29 pmset 로그 전원 표기 93건 중 81건이 `Using Batt` | 배터리에서는 caffeinate `-s` 무효 |
| 잠자기 | [측정] 9/29 03:10 `Software Sleep` → 05:20 사용자 깨움까지 **2시간 10분 잠듦**. 그 사이 DarkWake 만 8회(각 2~5초) | 이 창의 예약 job 은 돌지 않거나 깨어난 뒤 몰려서 돈다 |
| 잠자기 빈도 | [측정] 9/26 14회 · 9/27 32회 · 9/28 23회 Sleep 진입 | — |
| pmset | [측정] `sleep 0`(Chrome·caffeinate 등 assertion 때문) · `standby 1` · `powernap 1` · `hibernatemode 3` · `womp 0` · `autorestart` 항목 없음 | 배터리 없는 Mac 이면 정전 뒤 자동으로 켜지지 않는다 |
| keep-awake | [측정] `com.soransoran.keep-awake` pid 상주, `PreventSystemSleep` assertion 보유 | [추정] 덮개 닫힘(clamshell)·배터리 잠자기는 막지 못한다 |

### 2.2 로그인 세션

| 항목 | 현재 | 위험 |
|---|---|---|
| 도메인 | [측정] D100 9개 · 매거진 4개 job 전부 `~/Library/LaunchAgents` (gui/501) | [추정] 로그아웃하면 전부 내려간다 |
| 자동 로그인 | [측정] `autoLoginUser` 없음 | [추정] 재부팅 뒤 **누군가 로그인할 때까지 job 0개** |
| FileVault | [측정] Off | 자동 로그인을 켤 수 있는 상태(FileVault 가 켜져 있으면 macOS 가 자동 로그인을 막는다) |

### 2.3 네트워크

| 대상 | 누가 쓰나 | 현재 |
|---|---|---|
| Supabase pooler (`DATABASE_URL` · `DIRECT_URL` 호스트) | 공급·발행·댓글·감사·단계 | [측정] TCP 연결됨 (호스트 이름은 기록하지 않는다) |
| generativelanguage.googleapis.com | 공급 처리 · 댓글 · 감사 (Gemini) | [측정] 443 연결됨 |
| api.anthropic.com · api.openai.com | 공급 LLM 경로 | [측정] 443 연결됨 |
| cafe.naver.com · nid.naver.com | 네이버 수집 2개 | [측정] 443 연결됨 · [추정] 새 기기·IP 에서 세션 쿠키가 무효가 될 수 있다(사람이 다시 로그인) |
| github.com | runtime clone · `runtime:deploy` fetch | [측정] 443 연결됨 |
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
| ChatGPT 프로필 · claude CLI | [측정] `~/Library/Application Support/soransoran-chatgpt*` · `~/.local/bin/claude` | ⚪ 매거진 전용 — 이번 범위 밖, 싣지 않는다 |
| 옛 env 사본 9개 · `env-backup` | [측정] 운영 디렉터리 | ⚪ 싣지 않는다 — 비밀을 더 퍼뜨리지 않는다 |

#### 2.4.1 네이버 수집 세션 — 바꾸면 바로 다시 발급한다

- 🔴 **수집 계정의 아이디·비밀번호·보안 설정을 바꾸면 쿠키 만료일과 무관하게 세션이 즉시 끊길 수 있다.**
  [측정] 2026-10-07 15:2x 비밀번호 변경 → 15:30 회차가 로그아웃 상태로 상세 16 · 본문 0. 쿠키 만료일 검사는 통과했다.
  [측정] 2026-10-03 재발급 세션은 로그인됐지만 두 카페가 회원으로 인정하지 않아 10/4~10/7 본문 대신 가입 안내가 저장됐다.
- 변경 직후 운영 호스트에서 `npm run navercafe:session-setup -- --open` 으로 headed 재발급한다.
  저장 전에 활성 카페 둘 다 **회원**(카페 홈에 "카페 글쓰기")인지 setup 이 확인하고, 아니면 저장하지 않는다.
  사람은 같은 창에서 두 카페의 회원 전용 글 본문이 실제로 열리는지 한 번 본다.
- 가능하면 예약 수집 회차 사이에 한다(레몬테라스 07:30·10:30·13:30·16:30·21:30 · 우아한 갱년기 09:30·11:30·15:30·20:30).
- 수집 회차는 시작할 때 카페 홈으로 회원 상태를 확인하고, 회원이 아니거나 확인할 수 없으면 상세를 열지 않고
  `MEMBER_GATE` / `MEMBER_STATUS_UNKNOWN` 실패로 끝낸다. 상세를 열고 본문 0건이면 `BODY_EMPTY` 실패다. 셋 다 Slack 알림(같은 카페·같은 사유 하루 1회).
- 실제 비밀번호·쿠키 값은 어디에도 기록하지 않는다. 세션 파일은 0600, 열어 보거나 공유하지 않는다.

### 2.5 절대경로 · nvm

- [측정] 설치 plist 13개 전부가 `/Users/yanadoo/...` 를 박고 있다 — runtime 경로, 로그 경로, `HOME`, `PATH`(매거진 4개는 매거진 runtime 도).
- [측정] node 는 nvm `v24.14.0` 절대경로(`…/.nvm/versions/node/v24.14.0/bin/npx`)로 박혀 있다.
  [추정] nvm 으로 node 를 올리거나 지우면 job 전부가 `npx` 를 못 찾고 죽는다 — launchd PATH 에는 nvm 이 없다.
- [측정] env 키 중 `SORAN_NAVERCAFE_SESSION_PATH` 의 값이 홈 경로다 — 대상 홈으로 바꿔 써야 한다.
- [측정] runtime 배포기·격리 검사가 `join(homedir(), 'Documents', 'soransoran-runtime')` 를 박아 두었다 —
  대상에서도 **홈 아래 같은 배치**(`~/Documents/soransoran` · `-runtime`)를 지킨다. 대상에는 매거진 runtime 을 만들지 않는다.
- [측정] runtime HEAD = pin = `7d29dbf`.

### 2.6 재부팅하면

[추정] 전원이 다시 들어와도(지금은 `autorestart` 없음 → 켜지지도 않는다) 로그인 전까지 LaunchAgent 는 하나도 돌지 않는다.
로그인하면 `~/Library/LaunchAgents` 에 **파일이 있는 job 전부**가 다시 올라온다 — 내려 둔 job 도 파일이 남아 있으면 되살아난다
(2026-09-09 · 2026-09-16 실측 사고). 그래서 아래 quiesce 는 bootout 과 **파일 이동**을 함께 한다.

### 2.7 측정 중 발견 (다른 레인)

- [측정] 2026-09-29 07:35:21 KST `~/Library/LaunchAgents/com.soransoran.magazine-auto-register.plist` 가
  **23바이트 JSON(`[{"Hour":1,"Minute":0}]`)으로 덮여 있다**. launchctl 은 아직 옛 설정을 물고 있지만(`last exit 1`),
  다음 로그인·재부팅 때 이 job 은 올라오지 못한다. 매거진 레인 소유라 이 작업에서는 고치지 않았다.
  🔴 D100 묶음은 이 파일을 **열지 않는다**(allowlist 밖) — 매거진 plist 가 손상돼도, 아예 없어도 D100 이전은 막히지 않는다.
  반대로 D100 plist 가 같은 모양으로 손상되면 verify 가 `PLIST` 로 잡는다(검사 ⑪ 반례).

## 3. 이전 묶음

```bash
npm run host:migrate                                             # plan (읽기 전용 · D100 레인)
npm run host:migrate -- export --out=<dir> [--cutover]           # 묶음 만들기
npm run host:migrate -- verify --bundle=<dir>                    # 해시 · 권한 · 누출 · 템플릿
npm run host:migrate -- install --bundle=<dir> --target-home=$HOME [--target-node-bin=<dir>] [--render-to=<dir>] [--apply]
npm run host:migrate -- rollback --bundle=<dir> --target-home=$HOME [--apply]   # 대상
npm run host:migrate -- quiesce [--apply]                                       # 원 호스트 · D100 만 내린다
npm run host:migrate -- unquiesce --bundle-id=<id> [--apply]                    # 원 호스트 · D100 만 되살린다
npm run host:migrate-check                                                      # 검사 (운영 홈 0 · launchctl 0)
```

### 3.1 묶음에 들어가는 것

| 폴더 | 내용 |
|---|---|
| `state/` | 운영 디렉터리 중 분류가 `state`·`secret` 인 항목 — 장부(llm·댓글·감사), 수집 원본, heartbeat 틱 표식, 러너 복구 표식, pin·manifest, env.local(0600), 네이버 세션(0600). 🔴 `magazine-*` · `regen-packets` 는 싣지 않는다 |
| `home/.config/soransoran/slack.env` | Slack webhook (0600) |
| `launchd/*.plist.template` | **D100 allowlist 의** 설치 plist 를 **호스트 중립 템플릿**으로 되돌린 것(`__REPO__` · `__NPX__` · `__NODEBIN__` · `__LOGDIR__` · `__HOME__`). 매거진 runtime 을 가리키는 D100 plist 는 거부한다 |
| `logs/` | `~/Library/Logs/soransoran` 중 **D100 job 의 로그만** (연속성) |
| `host-bundle.json` | manifest — `lane: "d100"` · `formatVersion 2`, 파일마다 sha256 · 크기 · 권한 · 종류, env **키 이름만**, plist 별 내보낼 때 loaded 여부, allowlist 에 있지만 설치 plist 가 없던 label(`laneMissing`) |

- 🔴 **모르는 항목은 싣지 않고 export 를 멈춘다**(`unclassified`). 분류는 `scripts/lib/host-migrate.mts` 의 규칙 표에 적는다.
  이름은 정확히 하나씩만 등록한다 — `persona-autogen-old` · `queue-locks.bak` 같은 비슷한 이름은 여전히 `unclassified` 다.
- 🔴 **내용 규칙** — 이름만으로 안에 무엇이 쌓일지 보장할 수 없는 항목은 안의 모양까지 본다. `persona-autogen` 은
  creative JSON 파일만, `queue-locks` 는 매거진 큐 잠금 파일(`<scope>.queue.lock` · `.reclaim`)만 있어야 한다.
  하위 디렉터리 · 링크 · 다른 이름의 파일이 하나라도 있으면 그 항목은 `unclassified` 로 떨어져 export 가 멈춘다
  (제외 항목 안의 영구 데이터가 조용히 빠지지 않고, state 항목 안의 모르는 것이 조용히 퍼지지 않는다).
- 🔴 쥔 잠금(`*.lock` · 매거진 임대 · 배포 잠금)은 싣지 않는다 — 대상에서 영영 풀리지 않는다. 예외: heartbeat `tick-<시각>.lock` 은 지난 틱 표식이라 싣는다.
- 🔴 묶음은 git 작업트리·운영 경로 안에 만들지 않는다. 묶음 디렉터리 0700 · 비밀 파일 0600.
- 🔴 화면에 나가는 모든 줄은 비밀 값·비밀 모양 패턴을 가린다. verify 는 비밀이 아닌 파일·manifest 에 비밀이 있으면 `LEAK` 으로 실패한다(파일·키 이름만 적는다).

### 3.2 plist 다시 찍기

설치본(= 지금 실제로 도는 설정, heartbeat/fixed 모드 · 댓글 러너 설치 여부 포함)을 긴 경로부터 placeholder 로 되돌리고,
대상에서 `launchd-install.render` 한 벌로 다시 찍는다. 찍은 뒤 **치환 안 된 placeholder 0 · 대상 홈이 아닌 `/Users/<누구>` 경로 0 ·
Label = 파일 이름 · ProgramArguments 있음**이어야 쓴다. 저장소 템플릿과 두 벌을 만들지 않는다.

## 4. D100 이 두 Mac 에서 동시에 돌 수 없게 하는 구조 (레인 단위)

같은 job 이 두 기계에서 돌면: 네이버 요청 간격이 두 배가 되고(영구 안전장치 위반), LLM 일 예산 장부가
기계마다 따로 차서 예산이 두 배가 되고, 발행·댓글은 DB 에서 경쟁한다.
🔴 소유권은 **호스트가 아니라 레인 단위**다 — 표식은 `host-handoff-d100.json`(원) · `host-owner-d100.json`(대상).
원 호스트의 매거진은 이 표식과 무관하게 계속 돈다.

1. **원 호스트 D100 을 먼저 완전히 내린다** — `quiesce --apply` 는 D100 회차가 실행 중이면(keep-awake 제외) 거부하고,
   없으면 **D100 job 만** `bootout` 한 뒤 **D100 plist 파일만** LaunchAgents 밖(`…/soransoran/host-migrate-quiesced-d100/<시각>/`)으로 옮기고
   `host-handoff-d100.json` 을 쓴다. 파일이 없으니 재부팅·로그인으로도 되살아나지 않는다. 매거진·개발 job 은 loaded 그대로, plist 제자리다.
2. **cutover 묶음은 원 호스트 D100 이 내려가 있을 때만 만들어진다** — `export --cutover` 는 launchctl 에 D100 job 0 ·
   LaunchAgents 에 D100 plist 0 · d100 handoff 있음 · 아직 다른 묶음으로 넘기지 않음을 확인한다. launchctl 을 못 읽으면 거부한다.
   만든 묶음 id 를 handoff 에 적는다 — 두 번째 cutover 묶음은 만들어지지 않는다.
3. **대상은 d100 cutover 묶음만 올린다** — `install --apply` 는 rehearsal 묶음 · 다른 레인(또는 v1) 묶음 · verify 실패 ·
   대상에 이미 D100 plist/loaded job · 대상에 이미 `host-owner-d100.json` · 묶음이 쓸 운영 항목이 대상에 이미 있음 ·
   대상 runtime 있음 · 대상 사용자 셸이 아님 · 사전 점검 미충족 중 하나라도 있으면 거부한다.
   소유 표식은 job 을 올리기 **전에** 쓴다.
4. **원 호스트 되살리기는 대상 내림을 증거로 요구한다** — `unquiesce --apply` 는 대상 `rollback` 이 찍어 준
   `--bundle-id` 가 handoff 의 id 와 같아야 한다. 되살리는 것은 handoff 에 적힌 것 중 **allowlist 안**만이다.
5. **마지막 방어선(DB)** — 글·댓글 발행 트랜잭션은 Serializable 안에서 오늘 수를 다시 센다
   (`src/lib/original-post-publish-tx.ts` · `src/lib/persona-publish-tx.ts`). 두 회차가 같은 스냅샷을 읽어도 뒤의 것이 직렬화 실패로 진다.

🟡 **남는 구멍 — 정직하게 적는다.** 같은 cutover 묶음을 **두 대상**에 올리는 것은 막지 못한다(각 대상은 서로를 보지 못한다).
절차로 막는다: 묶음은 한 번 옮기고 곧바로 지운다(전환 순서 ⑨). DB 수준 lease 는 DB write 가 필요해 이번 범위 밖이다.

## 5. 전환 순서 · 되돌리기

CLI 가 같은 목록을 찍는다(`CUTOVER_ORDER` · `ROLLBACK_ORDER`).

전환
1. [원] `npm run host:migrate` — 계획
2. [원] `export --out=<외장/임시>` rehearsal 묶음 → 대상에서 `verify` · `install` dry-run 으로 사전 점검
3. [원] `quiesce --apply` — D100 만
4. [원] `export --cutover --out=<dir>`
5. 옮기기 — 암호화된 외장 볼륨 또는 AirDrop. 클라우드 드라이브·메신저 금지
6. [대상] `verify --bundle=<dir>`
7. [대상] `install --bundle=<dir> --target-home=$HOME --apply` — clone(pin SHA) → `npm ci`·`prisma generate`(매거진 runtime 은 만들지 않는다) →
   state·로그 복원 → env(0600 · 홈 경로 키만 바꿈) + runtime `.env.local` 링크 → D100 plist 쓰기·`plutil -lint` → d100 소유 표식 →
   `launchctl bootstrap`(내보낼 때 loaded 였던 것만) → `runtime:isolation-check --require-runtime`. plist 를 쓴 뒤 실패하면
   올린 job bootout → plist 보관 → 소유 표식 삭제(되돌리다 실패해도 나머지를 계속하고 남은 것을 적는다)
8. [대상] `npm run ops:status` · 첫 heartbeat · 댓글 회차 로그 확인
9. 양쪽 묶음 삭제

되돌리기
1. [대상] `rollback --bundle=<dir> --target-home=$HOME --apply` — D100 job 만 bootout · plist 보관 · `host-owner-d100.json` 삭제
2. [원] `unquiesce --bundle-id=<1이 찍은 id> --apply` — D100 plist 제자리, 내리기 전 loaded 였던 D100 job 만 bootstrap
3. [원] `npm run runtime:isolation-check -- --require-runtime`
- pin 은 되돌릴 것이 없다 — 원 호스트의 `runtime-pinned-sha` 는 이전 내내 바뀌지 않는다.
- 매거진은 되돌릴 것이 없다 — 이전 내내 원 호스트에서 돌았다.

### 5.1 이 절차 자체를 되돌리려면

- 코드: `scripts/host-migrate.mts` · `scripts/lib/host-migrate.mts` · `scripts/host-migrate-check.mts` 와 이 문서는 **새 파일**이다.
  다른 코드는 이것을 부르지 않는다 — PR 을 revert 하면 끝난다(운영 launchd·env·DB 에 흔적 0).
- `quiesce --apply` 까지만 했다면: `unquiesce --apply`(export 전이라 bundle-id 없이 허용).
- cutover 묶음을 만든 뒤라면: 대상에 올리지 않았다는 것을 사람이 확인하고 묶음을 지운 뒤 `unquiesce --bundle-id=<그 id> --apply`.

## 6. 이 기계에서 한 dry-run

### 6.1 첫 판 (2026-09-29 07:4x KST · 호스트 전체 묶음 — 지금은 쓰지 않는다)

- 호스트 전체(13 job) 묶음은 손상된 매거진 plist 때문에 verify `PLIST` 2건으로 실패했다. 이것이 레인 단위로 바꾼 이유 중 하나다.

### 6.2 D100 레인 판 (2026-09-29 09:3x KST)

- `plan` — D100 allowlist 9개 전부 설치본 있음 · 전부 다시 찍기 가능. 건드리지 않는 job 4개(매거진) 표시. 미분류 0.
- `export --out=/private/tmp/…` (rehearsal) — 1,748 파일 · 57.2MB(state 1,718 · 비밀 3 · 템플릿 9 · 로그 18).
  "다른 레인 plist 4개는 싣지 않았다". **verify 통과**(손상된 매거진 plist 를 열지 않았다).
- `install --target-home=/private/tmp/soran-fake-target --render-to=…` (dry-run) — 다시 찍은 plist 9개 중 `/Users/yanadoo` 포함 0개.
  전원: 🟢 `AC 연결 · 배터리 charging` (이 MacBook 이 당시 AC 에 꽂혀 있었다). `--apply` 는 rehearsal · 가짜 홈 node 없음 · 자동 로그인 없음으로 거부.
- 묶음·렌더 결과는 곧바로 삭제했다. 실제 LaunchAgents · env.local · runtime · launchctl 은 건드리지 않았다.

### 6.3 최신 plan (2026-10-07 09:51 KST)

- runtime HEAD=pin `38efdd3ee5cb69fc5142d065825ce3d25f764a39`, Node `v24.14.0`.
- D100 allowlist 9개는 모두 설치돼 있고 loaded다. 매거진 4개 job은 범위 밖이다.
- state·secret·D100 로그의 예상 bundle은 76.2MB다.
- 이 plan 시점에는 **미분류 2건 때문에 export가 fail-closed였다.** 아래 분류를 코드에 적은 뒤 미분류는 0이다(§6.4).

| 경로 | 실측 구조 (2026-10-07) | 처리 |
|---|---|---|
| `persona-autogen` | 0700 디렉터리 · `persona30-creative-20261006.json` 1개(5.6KB · 0600) — `persona-autogen --creative-out=` 결과, Persona 6명의 creative | `state`로 이관 · 내용은 creative JSON만 허용 |
| `queue-locks` | 0755 빈 디렉터리 — **매거진** 큐 writer 잠금(`scripts/lib/magazine-queue-lock.mjs`의 `QUEUE_LOCK_DIR`) | `exclude` · 내용은 `<scope>.queue.lock` · `.reclaim`만 허용 |

- `queue-locks`는 D100 코드가 쓰지 않는다. 매거진이 원 호스트에 남으므로 대상에는 생기지 않는 것이 정상이다
  (2026-10-07 plan 문서의 "대상에서 새로 생성"은 실제 코드 확인 뒤 이렇게 고쳤다).

- 대상에서 `gh auth login`, `gcloud auth application-default login`을 새로 한다.
- Naver storage state는 secret으로 옮긴 뒤 대상에서 로그인 유지 여부를 확인한다.
- 82cook job은 첫 cutover allowlist 밖이며 계속 OFF다. D100 기본 운영이 안정된 뒤 별도 canary와 등록을 한다.
- 낮에는 분류 보정·검사·rehearsal·대상 install dry-run까지만 한다. 실제 quiesce는 창업자가 퇴근 직전
  "나 퇴근한다. 원본 Mac quiesce하고 최종 이관 bundle 만들자"라고 알린 뒤 시작한다.
- 집에서는 "집 도착했다. 집 Mac에 설치하고 운영권 넘기자"라고 알린 뒤 verify·install·운영 확인을 이어간다.

### 6.4 분류 보정 뒤 rehearsal (2026-10-07 10:07 KST · 회사 Mac · 브랜치 `fix/d100-host-cutover-prep`)

- `plan` — 운영 디렉터리 45항목 = state 17 · secret 2 · exclude 26 · **미분류 0**. D100 9개 loaded · 매거진 4개 범위 밖.
- `export --out=/private/tmp/…` (**rehearsal**, `--cutover` 없음) — **2,474 파일 · 86.0MB**
  (state 2,444 · 76.2MB / 비밀 3 · 11KB / plist 템플릿 9 · 41KB / D100 로그 18 · 9.7MB). 내장 verify 통과.
- 별도 `verify` 통과 — 해시 · 권한(비밀 3개 0600) · 누출 0 · 템플릿.
- 묶음 내용: plist 9개 = D100 allowlist 9개 · `laneMissing` 0 · pin `38efdd3` · `persona-autogen` creative 1개 실림 ·
  `queue-locks` 0개(제외 목록에 사유) · 매거진 상태·plist·로그 0 · 82cook job·로그 0(과거 수집 원본만 `microseed-data` state) ·
  `.lock` 은 heartbeat 지난 틱 표식 10개뿐.
- `install --target-home=/private/tmp/…` dry-run + `--render-to` — 다시 찍은 plist 9개 전부 🟢 · `plutil -lint` 통과 ·
  원 Mac 절대경로(`/Users/yanadoo`) 0 · 치환 안 된 placeholder 0. `--apply` 는 rehearsal 묶음 · 다른 홈 셸 · 사전 점검 미충족으로 거부 표시
  (네트워크 점검은 `--skip-network` 로 생략 — 외부 연결 0). 가짜 대상 홈은 만들어지지 않았다.
- 묶음·render 결과는 검사 뒤 삭제했다. 전후 비교: launchctl loaded 13개(D100 9 · 매거진 4) · LaunchAgents plist mtime/크기 ·
  runtime HEAD=pin `38efdd3` · env.local/slack.env mtime·크기·권한 · runtime `.env.local` 링크 · handoff/owner 표식 없음 — **전부 같다**.
- **하지 않은 것**: `quiesce --apply` · `export --cutover` · `install --apply` · rollback/unquiesce 적용. 실제 owner는 아직 회사 Mac이다.

## 7. 확정 결정과 남은 사람 작업

**owner 선택은 끝났다. 집 Mac을 "AC 상시 연결 + 로그인 세션 유지" 상태로 두고 오늘 밤 cutover한다.**

- 기종은 묻지 않는다. 조건은 install 사전 점검이 잰다.
- **MacBook 이면**: 어댑터를 늘 꽂아 둔다(배터리로 돌기 시작하면 사전 점검이 실패로 본다 — 운영 중에는 `ops:status` 로 본다).
  [추정] 덮개를 닫으면 외부 모니터 없이 잠든다 — 덮개를 열어 두거나, 외부 모니터·전원을 연결한 clamshell 로 둔다.
  배터리가 짧은 정전을 버티므로 `autorestart` 는 요구하지 않는다.
- **배터리 없는 Mac 이면**: `sudo pmset -a autorestart 1` 이 필요하다(정전 뒤 자동으로 켜짐). 선택: 소형 UPS.
- 공통 설정(설치 전 사람이 한다): `sudo pmset -a sleep 0 womp 1` · 가능하면 유선 LAN ·
  시스템 설정에서 자동 로그인 = 운영 사용자(→ FileVault 끔이 조건) · nvm node `v24.14.0` · gh/gcloud 로그인.
- FileVault를 유지하면 재부팅 뒤 사람이 비밀번호를 칠 때까지 job 0개라는 제한을 받아들여야 한다.
- 대상에서 `verify`·`install`을 돌릴 코드: `~/Documents/soransoran`에 저장소를 clone하고 `npm ci`를 먼저 한다
  (`install`은 그 `.git`이 있으면 clone을 건너뛰고 pin SHA로 runtime만 만든다). 대상 쪽 코드는 main의 것으로 충분하다 —
  이번 분류 보정은 원 Mac의 export에만 필요하다.
- 창업자가 직접 해야 하는 것은 대상 Mac의 로그인·전원/수면 설정·gh/gcloud/Naver 인증뿐이다. 코드 분류,
  bundle, quiesce, install 검증과 rollback 판단은 운영 마스터가 지휘한다.
