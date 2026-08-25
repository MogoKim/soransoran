# 매거진 continuation 런북 — producer 결과를 제작으로 잇는 절차

> 작성 2026-08-25 · 대상 Claude Code 세션
> 상위 문서: `2026-08-23-soransoran-magazine-seo-production-strategy.md`

---

## 0. 이 문서의 한 줄

**continuation 은 무인 스크립트가 아니다. Claude Code 세션이 따르는 워크플로우다.**

전략 §13.2 의 11단계 중 **4개(ChatGPT 투입·응답 대기·원고 회수·hero 생성)가 MCP Playwright 를 쓴다.**
MCP 서버는 Claude Code 세션에 붙어 있어서, `launchd` 가 실행하는 쉘은 접근할 수 없다.
`continuation-runner.mjs` 같은 것을 만들면 **매일 실패하는 장치**가 된다.

우회하려면 `npm playwright` + `storageState` 파일이 필요한데, 6-H-2-1 에서 명시적으로 금지했다
— 계정 쿠키가 디스크에 남고 `package.json` 에 들어가면 CI 도 설치할 수 있게 된다.

그래서 자동화의 경계는 이렇다.

```
무인 (01:00 launchd)   producer — 무엇을 만들지 정하고 작업 패키지를 놓는다
세션 (창업자 한 마디)    continuation — 원고를 받아 예약까지
```

**창업자 복붙은 0 이다.** 창업자가 하는 일은 세션에서 한 마디 하는 것뿐이다.

---

## 1. 전체 흐름

| # | 단계 | 주체 | 산출물 |
|---|---|---|---|
| 1 | producer 실행 (01:00) | `magazine-producer-plan.mjs` | `_runs/{date}/selected/{slug}/*.todo.md` |
| 2 | TODO 를 채워 정본 생성 | **세션** | `drafts/magazine/{slug}/brief.md` · `review.ts` |
| 3 | brief 를 ChatGPT 에 **파일 첨부** | MCP Playwright | — |
| 4 | 응답 완료 대기 (내용 기준 판정) | MCP Playwright | — |
| 5 | 원고를 **blob download** 로 회수 | MCP Playwright | `drafts/magazine/{slug}/draft.md` |
| 6 | 마크다운 → draft | `magazine-md-to-draft.mjs` | `article-draft.ts` |
| 7 | hero 생성 (REQUIRED 만) | MCP Playwright | `public/magazine/{slug}/hero.webp` |
| 8 | **자동 승인 판정** | `magazine-batch-qa.mjs` | READY / BLOCKED |
| 9 | 검수 패킷 (BLOCKED·HIGH 만) | `magazine-packet.mjs` | `packet.md` |
| 10 | 예약 등록 | **세션(수동)** | `articles.ts` + 큐에서 제거 |
| 11 | 10:30 자동 공개 | 공개 엔진 | — |

**5번이 설계의 핵심이다.** 원고가 파일로 직행하므로 Claude Code 가 원고를 읽고 다시 타이핑하는 경로가 없다.
완료 판정도 텍스트가 아니라 **불리언 플래그**(길이·`[CTA]` 개수·지정 문장 포함 여부)로 한다.

---

## 2. 시작 명령

```
오늘 producer 계획대로 진행
```

세션은 이렇게 시작한다.

```bash
cat drafts/magazine/_runs/$(TZ=Asia/Seoul date +%F)/report.md
```

---

## 3. TODO 를 채우는 책임 경계 (§13.1)

```
"원고를 쓰지 않는 Claude 세션"  →  주제 해석 · 검색 의도 · 구조 · 위험 문장 후보 · 지시서
ChatGPT                       →  최종 원고
Claude Code                   →  파일화 · QA · 검증 (원고를 쓰지 않는다)
```

`brief.todo.md` 의 TODO 6개는 **전부 "지시서" 영역**이다. 검색 의도·독자 장면·도입 지침·h2 구조·
위험 문장 후보·주제별 금지 — 어느 것도 원고 문장이 아니다. 세션이 채워도 원칙에 어긋나지 않는다.

### 예외 하나 — riskSentences 는 Claude Code 가 쓴다

`riskSentences 5개` 는 **원고에 토씨 그대로 들어갈 문장**이라 형식상 경계에 걸린다. 그래도 세션이 쓴다.

**이유**: 이 문장들은 "원고" 가 아니라 **안전 문장**이다.
"기간은 사람마다 다릅니다" · "병원에서 확인해 보시는 편이 좋습니다" 같은 **단정 회피·진료 권고** 문장이고,
창업자가 검수할 때 대조하는 기준점이다.

이걸 ChatGPT 에 맡기면 **위험하다고 판단한 문장은 애초에 안 썼을 것**이므로
검수 자료가 자기 검열의 결과물이 된다. §13.1 이 ②(분석)와 ③(원고)을 다른 도구에 둔 이유가 정확히 이것이다.

대조 구조는 이렇게 유지된다.

```
brief 의 5문장  =  review.ts 의 riskSentences  =  원고 본문
                   ↑ batch-qa / packet 이 문자열 대조 (불일치 = BLOCKED)
```

### 함께 채우는 것 — forbiddenPatterns

brief 의 "주제별 금지" TODO 를 채울 때, **같은 내용을 `review.ts` 의 `forbiddenPatterns` 배열에 한 번 더 적는다.**

```ts
forbiddenPatterns: ['손목터널', '건초염', '관절염', '파스', '보조기', '갱년기 때문'],
```

이유는 §4 에 있다. 이것이 자동 승인을 성립시키는 다리다.

---

## 4. 자동 승인 조건 — 6개 AND (+ 자동화 모드 4개)

> `--strict-auto` 또는 `--run` 일 때 ⑦~⑩ 이 더 붙는다.
> 사람이 원고를 훑어보던 단계가 사라질 때 생기는 구멍이다.
>
> | | 조건 | 기준 근거 |
> |---|---|---|
> | ⑦ | 본문 800~3000자 | 기존 13건 실측 1294~2028자. 800 은 "명백히 잘렸다"만 잡는 자리 |
> | ⑧ | 거절문 0건 | "죄송하지만" · "as an AI" 등이 그대로 원고가 된 경우 |
> | ⑨ | 한국어 비율 ≥ 60% | 실측 89.2~95.0%. 영어 답변은 5% 안팎이라 확실히 갈린다 |
> | ⑩ | forbiddenPatterns 필수 | 없으면 주제별 위험 검사가 통째로 빠진다 |
>
> 기존 글 회귀 검사(일반 모드)에서는 ⑦~⑩ 을 켜지 않는다.
> 그 글들은 사람이 보는 단계를 이미 거쳤다.



```
① riskLevel ∈ {LOW, MEDIUM}
② autoEligible = true
③ magazine-qa FAIL 0
④ forbiddenPatterns 위반 0
⑤ riskSentences 5/5 원고 대조 통과   (MEDIUM/HIGH 필수)
⑥ imageMode ≠ REQUIRED 또는 hero 존재
```

```bash
node scripts/magazine-batch-qa.mjs --run 2026-08-25
node scripts/magazine-batch-qa.mjs <slug> [...] --json
```

### ④ 가 왜 따로 필요한가

`magazine-qa.mjs` 는 34개 항목을 검사하지만 **모든 글에 공통인 것만** 잡는다.

| qa 가 잡는다 | qa 가 못 잡는다 |
|---|---|
| 금지 호칭 (시니어·어르신·노인·실버) | 주제별 진단명 ("손목터널증후군" "관절염") |
| 의료 단정 (반드시·치료됩니다·완치…) | 톤 ("명절은 없어져야") |
| 약·치료 인접어 (WARN) | 관계 구도 (시어머니/며느리 대립) |
| 형식 (description·h2·CTA·hero 규격) | 관계 단절 조언 |
| 중복 (제목·description·slug·seriesOrder) | 사실 오류 |

추석 3건에서는 이 층을 **주제별 정규식을 그때그때 짜서** 검사했다. 재현성이 없다.
`forbiddenPatterns` 는 그 검사를 데이터로 옮겨 매번 같은 방식으로 돌게 만든다.

`forbiddenPatterns` 가 없으면 그 검사를 **건너뛴다(하위 호환).** 판정은 READY 가 나올 수 있지만,
`notes` 에 "주제별 검사를 건너뛴다" 가 찍힌다. **그 상태를 정상으로 여기지 않는다.**

---

## 5. BLOCKED 사유별 대응

| 사유 | 대응 |
|---|---|
| `riskLevel=HIGH` | 자동 승인 대상이 아니다. `magazine-packet.mjs` 로 패킷을 만들어 창업자 검수 |
| `autoEligible=false` | 위와 같다. 큐가 민감 주제로 표시한 것이다 |
| QA FAIL ≥ 1 | 사유를 보고 판단. **형식 문제면 원고를 다시 받는다.** 원고를 손으로 고치지 않는다 |
| `forbiddenPatterns` 위반 | **원고를 다시 받는다.** brief 의 금지 항목을 더 명시적으로 적어 재요청 |
| `riskSentences` 불일치 | 원고가 문장을 바꿨다. 재요청하거나, 원고가 맞다면 `review.ts` 를 실제 문장으로 갱신 |
| `imageMode=REQUIRED` + hero 없음 | hero 를 만든다(§6). 못 만들면 그날은 예약하지 않는다 |
| 약·치료 인접어 WARN | **BLOCKED 는 아니다.** 별도 `⚠️` 로 분리 보고된다. 문맥을 보고 사람이 판단 |

**어느 경우든 그날 발행하지 않아도 된다.** 전략 §13.4 — "어느 단계든 실패하면 다음 단계로 진행하지 않는다."

---

## 6. hero 정책

```
imageMode REQUIRED  → hero 없으면 BLOCKED
imageMode OPTIONAL  → hero 없이 예약 가능
                      og:image 키 생략 · twitter:card=summary 로 분기 (6-E-3)
                      pension-early-vs-normal 이 이 상태로 공개 중
```

hero 생성은 MCP + **사람 눈**이 필요하다. 6-H-1 에서 나이 인상이 어긋나 3회 재생성한 이력이 있다.
`40대 후반` `not elderly` 만으로는 부족하고, 나이를 숫자로 못 박고 신체 묘사를 구체적으로 써야 한다.
**자동화 대상이 아니다.**

---

## 7. 예약 등록 — `magazine-register.mjs` 가 한다 (7-D-11)

> 이 단계는 손으로 하지 않는다. articles.ts 와 topic-queue.ts 를 사람이 직접 고치는 것이
> 가장 손이 많이 가고 가장 틀리기 쉬운 자리였다.

```bash
# 먼저 dry-run — 파일을 고치지 않고 무엇이 바뀔지만 본다
node scripts/magazine-register.mjs --slug <slug> --publish-at 2026-09-02

# 확인했으면 --write
node scripts/magazine-register.mjs --slug <slug> --publish-at 2026-09-02 --write
```

스크립트가 막는 것:
- 이미 articles.ts 에 있는 slug (공개·예약·차단 전부)
- 같은 KST 날짜에 이미 글이 있으면 — **하루 1건**
- 10:30 KST 가 아닌 시각
- `riskLevel=HIGH` · `autoEligible=false`
- `imageMode=REQUIRED` 인데 hero 없음
- topic-queue 에서 제거 대상이 1개가 아닐 때
- articles.ts 에서 삽입 위치를 못 찾을 때 (구조가 바뀐 것이다)

**부분 수정을 하지 않는다.** 두 파일을 메모리에서 다 만든 뒤 한꺼번에 쓴다.
중간에 실패하면 아무것도 쓰지 않는다 — 한쪽만 바뀐 상태가 가장 고치기 어렵다.

### 아래는 스크립트가 없던 시절의 수동 절차 (참고용)


`articles.ts` 는 979행 · 52KB 단일 파일이다. 멀티 세션 환경에서 스크립트가 자동 수정하면 충돌한다.
TS 객체 리터럴에 코드를 생성해 삽입하는 일이라 가장 깨지기 쉽기도 하다.

**등록 시점엔 이미 세션 안이다. 무인으로 할 이유가 없다.**

```ts
'{slug}': {
  ...article-draft.ts 의 객체 리터럴 그대로...
  publishedAt: 'YYYY-MM-DD',
  status: 'SCHEDULED',
  publishAt: 'YYYY-MM-DDT10:30:00+09:00',
}
```

- **하루 1건.** 기존 예약과 날짜가 겹치지 않게 다음 빈 슬롯부터
- `publishWindow` 가 있으면 **예약일이 창 안**이어야 한다
- 등록 후 `topic-queue.ts` 에서 그 항목을 지운다. **day 번호는 재번호하지 않는다**
- 문장은 한 글자도 손대지 않는다. `publishedAt` 확정과 `status`·`publishAt` 주입만

등록 뒤 확인:

```bash
node scripts/magazine-qa.mjs           # FAIL 0
node scripts/magazine-inventory.mjs    # 예약 건수·다음 공개 시각
npx tsc --noEmit && npm run build
```

---

## 8. PASS 기준

```
G1  창업자 복붙                      0회
G2  LOW/MEDIUM 창업자 검수            0회 (자동 승인 6조건 통과분)
G3  QA FAIL ≥1                      예약 0건
G4  forbiddenPatterns 위반           예약 0건
G5  riskSentences 대조               5/5 통과분만 예약
G6  HIGH / autoEligible=false        예약 0건
G7  REQUIRED + hero 없음             예약 0건
G8  예약 공개                        하루 1건 · 날짜 충돌 0
G9  publishWindow                    예약일이 창 안
G10 Search Console / Naver           접촉 0
G11 src/ · sitemap.ts · robots.ts · prisma/  변경 0
G12 tsc · build                      통과
G13 예약 전 5표면 숨김                목록 0 · 상세 404 · sitemap 0
G14 자동 commit / push                0
```

---

## 9. 금지 (재확인)

```
🚫 Claude Code 가 최종 원고 작성          — 원고는 ChatGPT
🚫 ChatGPT 응답을 고쳐 쓰기               — 형식 변환만 (md-to-draft 가 규칙 밖이면 FAIL)
🚫 자동 공개 (HIGH · QA FAIL · BLOCKED)   — 공개 관문이 status 로 막는다
🚫 자동 commit · push                     — 사람이 diff 를 본 뒤에만
🚫 자동 Search Console / Naver 제출        — 게이트 미달 (§9)
🚫 npm playwright 설치                    — MCP 방식 유지
🚫 AI API 도입                            — 스크립트는 순수 정적 검사만
```

---

## 9-A. producer 자동 실행 (launchd)

plist 원본: `launchd/com.soransoran.magazine-producer.plist`

```
매일 01:00 KST → magazine-producer-plan.mjs → _runs/{date}/ 작업 패키지
```

### 설치 (아직 하지 않았다)

```bash
mkdir -p ~/Library/Logs/soransoran
ln -s /Users/yanadoo/Documents/soransoran/launchd/com.soransoran.magazine-producer.plist \
      ~/Library/LaunchAgents/com.soransoran.magazine-producer.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.soransoran.magazine-producer.plist
launchctl kickstart -k gui/$(id -u)/com.soransoran.magazine-producer   # 01:00 을 기다리지 않고 검증
```

### 🔴 nvm 으로 node 를 올리면 plist 가 죽는다

시스템 경로(`/usr/local/bin` · `/opt/homebrew/bin` · `/usr/bin`)에 node 가 **없다.**
plist 는 nvm 버전 경로를 직접 가리킨다 — 현재 기준 `v24.14.0`.

```bash
node -v                     # plist 의 버전과 다르면 갱신이 필요하다
grep -n 'versions/node' launchd/com.soransoran.magazine-producer.plist
```

갱신할 곳은 **2군데**다.

| 위치 | 값 |
|---|---|
| `ProgramArguments[0]` | `/Users/yanadoo/.nvm/versions/node/<버전>/bin/node` |
| `EnvironmentVariables.PATH` | 같은 `bin` 경로가 맨 앞 |

고친 뒤 재적재한다.

```bash
plutil -lint launchd/com.soransoran.magazine-producer.plist
launchctl bootout gui/$(id -u)/com.soransoran.magazine-producer
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.soransoran.magazine-producer.plist
```

**증상은 조용하다** — producer 가 그냥 안 돈다. 재고가 줄어드는 것으로만 드러난다.
`~/Library/Logs/soransoran/magazine-producer.log` 를 주기적으로 본다.

### 왜 셸 래퍼를 쓰지 않는가

launchd 의 셸은 `kTCCServiceSystemPolicyDocumentsFolder` 미승인이라 `~/Documents/` 에 접근하지 못한다
(`Operation not permitted`, exit 126). node 는 TCC 승인돼 있어 직접 실행한다.
producer 는 순수 node ESM 이라 `npx`·`tsx` 도 필요 없다.

### 왜 KeepAlive 를 넣지 않는가

실패 시 launchd 가 재시도하면 폭주한다. producer 자체도 재시도하지 않는다 —
죽은 lock 은 `ABORTED` 로 기록만 하고 다음 날을 기다린다. 재고가 하루치 더 줄어 자연히 만회된다.

### worktree 오독 방어

같은 repo 의 worktree 가 둘이다.

```
/Users/yanadoo/Documents/soransoran      main
/Users/yanadoo/Documents/soransoran-m0   feat/micro-seed-m0-gates
```

`WorkingDirectory` 를 한 줄 잘못 적으면 m0 의 `articles.ts` 로 재고를 계산한다.
그래서 스크립트가 **자기 파일 위치**로 repo 를 잡는다(`import.meta.url`) — 어느 디렉터리에서 실행하든 자기 repo 를 본다.
`WorkingDirectory` 는 로그·상대경로용으로만 남는다.

확인법:

```bash
cd /tmp && /Users/yanadoo/.nvm/versions/node/v24.14.0/bin/node \
  /Users/yanadoo/Documents/soransoran/scripts/magazine-producer-plan.mjs --dry-run
# 재고·공개·예약 숫자가 repo 안에서 실행한 것과 같아야 한다
```

---

## 9-B. 날짜를 옮기는 테스트는 `--dry-run` 으로만 한다 🔴

`--now` 로 미래·과거 날짜를 지정하고 **실제로 쓰면**, 그날의 `_runs/{date}/run.json` 이 남는다.
producer 는 "오늘 run.json 이 있으면 이미 돌았다"고 보고 종료하므로,
**테스트가 만든 run.json 이 실전 01:00 실행을 막는다.**

실제로 그렇게 됐다 — `_runs/2026-08-25/run.json` 이 테스트 산출물이라
launchd 01:00 실행이 "이미 COMPLETED" 로 차단됐고, 재고가 줄어드는데도 조용했다.

```bash
# ✅ 이렇게
node scripts/magazine-producer-plan.mjs --now 2026-09-16 --dry-run

# 🔴 이러지 마라 — 그 날짜의 실전 실행을 선점한다
node scripts/magazine-producer-plan.mjs --now 2026-09-16
```

dry-run 은 아무것도 쓰지 않으므로 몇 번을 돌려도 안전하다.

---

## 9-C. 자동화 목표 구조와 지금 위치

```
producer ──▶ webui runner ──▶ md-to-draft ──▶ batch-qa ──▶ register ──▶ PR
  ✅ 7-D-3      🔴 7-D-12         ✅            ✅ 강화      ✅ 7-D-11   ✅ 7-D-11
```

**7-D-11 은 `package.json` 없이 닫을 수 있는 구간만 닫는 단계다.**
register · PR · batch-qa 강화가 여기 들어간다.

남은 한 칸은 **webui runner** 다. ChatGPT 웹 UI 를 무인으로 왕복시키려면
Playwright 가 devDependency 로 들어가야 한다. MCP Playwright 는 Claude Code 세션에만
붙어 있어 launchd 셸에서 쓸 수 없다.

🔴 **7-D-12 에서 `package.json` / `package-lock.json` 을 건드리기 전에 반드시 Codex[3] 과 재조율한다.**
같은 파일을 Codex[3] 이 여러 번 변경해 왔다. 조율 없이 만지면 충돌한다.

### merge 는 자동화하지 않는다

PR 생성까지가 자동화의 종점이다. **merge 는 사람이 한다.**
하루 한 번 PR 하나를 훑는 비용은 작고, 그 자리가 마지막 안전망이다.
자동화가 사람 눈 없이 넘어갔다면 사고가 났을 상황이 실제로 두 번 있었다 —
타 세션 파일이 커밋에 섞인 일, 낡은 run.json 이 틀린 알림을 낸 일.

### Slack 알림 원칙

**정상 실행은 조용하다.** 매일 성공 알림을 보내면 사람이 알림을 안 보게 된다.

| 알린다 | 알리지 않는다 |
|---|---|
| git dirty (타 세션 작업 중) | 정상 완료 |
| ChatGPT 로그인 만료 | 재고 충분해서 0건 제작 |
| 봇 감지 challenge | 예상된 skip |
| batch-qa BLOCKED | |
| register 슬롯 충돌 | |
| PR 생성 실패 | |

Slack 발송이 실패해도 producer 자체는 실패시키지 않는다 — 알림은 곁가지다.

---

## 9-D. ChatGPT web UI runner (7-D-12 · 7-D-13-A)

`scripts/magazine-webui-runner.mjs` · `scripts/lib/chatgpt-session.mjs`

```bash
node scripts/magazine-webui-runner.mjs --login             전용 Chrome 을 띄운다 (닫지 말 것)
node scripts/magazine-webui-runner.mjs --dry-run           대상만 본다
node scripts/magazine-webui-runner.mjs --dry-run --probe   ChatGPT 접근 상태
```

### 운영 경로 — 사람이 띄운 Chrome 에 붙는다

```
--login  →  일반 Chrome + --remote-debugging-port=9333   (사람이 로그인, 창을 열어 둔다)
probe    →  connectOverCDP 로 그 Chrome 에 붙기만 한다
```

**Playwright 는 브라우저를 띄우지도 닫지도 않는다.** 프로필의 주인은 끝까지 그 Chrome 이다.

### 🔴 금지된 경로 — Playwright 가 프로필을 직접 여는 것

`launchPersistentContext` 로 전용 프로필을 열면 **ChatGPT 세션 쿠키가 지워진다.**
Chrome 이 키체인(Chrome Safe Storage)에 접근하지 못해, 읽을 수 없는 암호화 쿠키를
무효로 보고 정리하기 때문이다.

```
실측  로그인 직후 chatgpt/openai 쿠키 42개  →  probe 1회 후 8개 (34개 소실)
      CDP 전환 후                      8개  →  probe 1회 후 8개 (감소 0)
```

다시 시도하지 마라. 몇 번을 로그인해도 같다.

시도했다가 접은 것들(같은 벽에 부딪힌다): `chromiumSandbox: true` · `ignoreDefaultArgs` ·
번들 chromium · headless. **stealth · UA 위조 · 쿠키 추출/복사는 애초에 하지 않는다.**

### 창업자 1회 준비

```bash
node scripts/magazine-webui-runner.mjs --login
```

1. 일반 Chrome 창이 열린다 (자동화 표식 없음 · CDP 포트 9333)
2. ChatGPT 에 로그인한다
3. ⚠️ **"나만의 Chrome 만들기" 팝업이 뜨면 "계정 없이 Chrome 사용"** 을 누른다 —
   안 그러면 Chrome 이 프로필을 미확정으로 두고 종료 시 세션 쿠키를 버린다
4. 🔴 **창을 닫지 않는다** — probe 가 이 창에 붙는다

프로필: `~/Library/Application Support/soransoran-chatgpt` (chmod 700 · repo 밖)
평소 Chrome 프로필과 완전히 분리돼 있고, 복사하지도 직접 쓰지도 않는다.

### 01:00 무인 실행 — Chrome 을 wrapper 가 띄운다 (7-D-13-B1)

사람이 새벽에 창을 띄워 둘 수 없다. `magazine-producer-run.mjs` 가 먼저 접근을 확인한다.

```
01:00 launchd → magazine-producer-run.mjs
                  ├ magazine-webui-runner.mjs --dry-run --probe --auto-start
                  │    CDP 있으면 재사용 · 없으면 일반 Chrome 을 띄우고 최대 30초 대기
                  ├ magazine-producer-plan.mjs
                  └ magazine-producer-notify.mjs
```

**세션은 재기동해도 유지된다.** 3회 연속 종료 → 자동 기동 → probe 를 돌려 확인했다.

```
쿠키 추이  41 → 39 → 39 → 39 → 39   (첫 2개는 만료분 정리, 이후 안정)
status     3회 모두 ok
```

🔴 **이미 떠 있으면 두 번 띄우지 않는다.** 같은 프로필로 또 띄우면 프로필이 잠긴다.
🔴 **CDP 없이 프로필이 점유돼 있으면 죽이지 않는다.** 사람이 그 창을 쓰고 있을 수 있다 —
   `chrome_not_running` 으로 알리고 판단은 사람에게 맡긴다.
🔴 **ChatGPT 접근이 실패해도 producer 는 돈다.** 재고 계산과 선정은 ChatGPT 와 무관하고,
   알림이 나가야 창업자가 로그인 만료를 안다.

### 🔴 headless 를 쓸 수 없다

| 조합 | HTTP | |
|---|---|---|
| headless (프로필 유무 무관) | **403** | Cloudflare |
| **headed** | **200** | ✅ 통과 |

01:00 무인 실행에도 GUI 세션이 필요하다. **맥이 잠들면 실패한다.**

### 접근 상태와 Slack 조건

| 상태 | 뜻 | Slack | 재시도 |
|---|---|---|---|
| `ok` | 정상 | **보내지 않는다** | – |
| `chrome_not_running` | 전용 Chrome 이 안 떠 있음 | BLOCKED | ❌ `--login` 으로 띄운다 |
| `login_required` | 로그인 만료 | BLOCKED | ❌ 사람이 해야 한다 |
| `cloudflare_blocked` | 봇 감지 | BLOCKED | ❌ 재시도하면 악화된다 |
| `browser_missing` · `permission_blocked` · `unknown` | – | ERROR | ❌ |

**정상 실행은 조용하다.** 매일 오는 알림은 아무도 보지 않는다.

### probe 판정은 신호를 조합한다

`#prompt-textarea` **하나만 보면 오진한다.** SPA 라 composer 가 늦게 뜨고,
selector 가 바뀌면 로그인 상태인데도 `login_required` 로 떨어진다.

```
로그인됨   promptTextarea · editableBox · plusButton · historyItem · accountButton
로그아웃   loginBtn · signupBtn · welcomeText · landingTitle
```

`landingTitle` 은 로그아웃 랜딩의 title 에 마케팅 문구가 붙는 것을 본다.
로그인 상태의 title 은 그냥 `ChatGPT` 다.

composer 는 최대 20초 기다린다. 어느 쪽 신호도 없으면 `login_required` 가 아니라 **`unknown`** 이다 —
못 읽은 것과 로그아웃된 것은 다르고, 대응도 다르다.

### 🔴 아무것도 저장하지 않는다

스크린샷 · DOM 덤프 · HTML 본문 · URL · 쿠키 · 토큰 — 전부.
Cloudflare challenge URL 의 토큰은 계정과 연결되고, 로그인 화면에는 계정명이 찍힌다.
**불리언 플래그와 상태 코드만** 남긴다.

디버깅하려고 스크린샷을 저장하고 싶어지는 자리가 바로 여기다. 하지 않는다.

### 이 단계에서 하지 않는 것

brief 첨부 · 메시지 전송 · 응답 대기 · 원고 다운로드 · 파일 쓰기 · Slack 발송.
**"비활성 플래그"로 막아 둔 것이 아니라 코드가 아예 없다.**

---

## 10. 한 줄 요약

**producer 는 무엇을 만들지 정하고, batch-qa 는 내보내도 되는지 정한다.
그 사이의 원고는 ChatGPT 가 쓰고, 세션은 나르고 검증할 뿐이다.**

매거진이 늘어도 North Star(회원이 남긴 글·댓글)가 오르지 않으면 글을 더 쓰지 않는다.
재고가 14일 이상이면 producer 가 스스로 멈춘다.
