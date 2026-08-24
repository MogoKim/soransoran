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

## 4. 자동 승인 조건 — 6개 AND

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

## 7. 예약 등록 (10단계) — 수동을 유지한다

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

## 10. 한 줄 요약

**producer 는 무엇을 만들지 정하고, batch-qa 는 내보내도 되는지 정한다.
그 사이의 원고는 ChatGPT 가 쓰고, 세션은 나르고 검증할 뿐이다.**

매거진이 늘어도 North Star(회원이 남긴 글·댓글)가 오르지 않으면 글을 더 쓰지 않는다.
재고가 14일 이상이면 producer 가 스스로 멈춘다.
