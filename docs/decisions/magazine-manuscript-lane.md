# 매거진 원고 자동 회수 — 1차에서 `--write --pr` 을 켜지 않는 이유

작성: 2026-09-02 · 대상: 매거진 자동 재고 보충 1차

> 🔴 **2026-09-15 갱신 — 아래 §"왜 지금 `--write --pr` 을 켜지 않나" 와 §"다음 단계에서
> 무엇을 보고 켜나" 는 폐기됐다.**
>
> 경영 결정으로 **자동 PR 을 연다.** "연속 5회 회수 + 창업자 판정 + 오탐 0" 조건은
> 없어졌고, 활성화 게이트는 **supervised 1회 end-to-end 성공**(PR 이 실제로 열림) 하나다.
> 원고 품질 통제는 회수 시점이 아니라 **PR merge 전의 CI 와 사람 검수**가 맡는다.
> **자동 merge 와 자동 공개는 여전히 하지 않는다** — 그 경계는 그대로다.
>
> 그리고 이 문서의 **"켤 때 고치는 것은 plist 한 줄" 은 사실이 아니었다.**
> 실제로는 넷이 더 필요했다 —
> ① plist 가 symlink 면 TCC 때문에 등록조차 되지 않았고(2026-09-03 이후 12일 정지),
> ② `gh` 가 launchd PATH 에 없어 **push 뒤에** PR 실패를 알게 되는 순서였고,
> ③ main 복귀 코드가 없어 첫 성공 회차 뒤 매일 `NOT_ON_MAIN` 으로 멈췄고,
> ④ write 실패가 `exit 0` 으로 숨겨졌다.
>
> 절차 정본은 [`docs/operations/magazine-automation-runbook.md`](../operations/magazine-automation-runbook.md) 하나다.
> 아래 §"관문이 막는 것" 과 §"일부러 넣지 않은 규칙" 은 지금도 유효하다.

## 무엇이 달라졌나

원고 회수(`brief.md` → ChatGPT → `draft.md`)에 **관문**이 생겼다.
회수 자체는 그 전에도 동작했다 — 이번에 더한 것은 "받은 것을 저장해도 되는가" 를 묻는 자리다.

- `scripts/lib/magazine-manuscript-guard.mjs` — 판정만 한다. 원고를 고치지 않는다
- `fetchManuscript` 가 **쓰기 직전** 에 이 관문을 부른다. 막히면 파일이 생기지 않는다
- `--force` — 이미 있는 `draft.md` 를 덮어쓰는 손잡이. 사람이 한 건씩만 켠다
- `--status` — 큐 전체가 어느 단계까지 왔는지. 전송 0건

## 왜 관문이 필요했나 — 이미 새어 나갔다

`after-holiday-body-ache` 본문에 ChatGPT 인용 마커가 그대로 들어가
**production 에 공개됐다.**

```
… 며칠 동안 해 왔던 겁니다. :contentReference[oaicite:0]{index=0}
```

`md-to-draft` 의 `FORBIDDEN` 8종(표·코드블록·h1·h4·이미지·링크·HTML·번호목록)은
이 형태를 걸러 내지 못한다. `describeDraft()` 가 화면에 상태를 보여주긴 했지만
**저장을 막지는 않았다** — 사람이 그 줄을 읽지 않으면 그대로 흘러간다.

판정을 쓰기 앞으로 옮긴 이유가 이것이다. "저장 금지" 는 쓰기 전에만 성립한다.

## 관문이 막는 것

| 코드 | 무엇 |
|---|---|
| `EMPTY` | 빈 원고 |
| `NO_FRONTMATTER` · `FRONTMATTER_UNCLOSED` | `---` 로 시작하지 않거나 닫히지 않음 |
| `META_MISSING` | `title` · `description` · `cluster` 누락 |
| `TOO_SHORT` | 본문 1,200자 미만 (실제 원고는 1,669~2,200자) |
| `NOT_KOREAN` | 한글 비율 30% 미만 (실제 원고는 96~99%) |
| `CONTAMINATED` | `:contentReference` · `oaicite` · `【…†…】` · `turn0search1` · zero-width |
| `NO_SECTION` | `##` 소제목이 하나도 없음 |

### 일부러 넣지 않은 규칙

**대화체 인사**("물론입니다 / 아래 원고입니다")를 본문 단어로 잡지 않는다.
인사가 붙으면 원고가 `---` 로 시작하지 않아 `NO_FRONTMATTER` 가 이미 잡는다.
단어로 잡으려 하면 오탐이 난다 — 실제 원고에 `"여기서 중요한 것은…"` 이 있다.

🔴 **관문의 오탐은 막지 못하는 것보다 나쁘다.** 재고가 통째로 멈춘다.

## 왜 지금 `--write --pr` 을 켜지 않나

켜면 무인으로 `articles.ts` 가 바뀌고 PR 이 열린다. 코드는 이미 다 있다
(`auto-register-ready.mjs` 의 `finishPr()`). 켜지 않는 이유는 셋이다.

### ① 관문을 실제 원고로 며칠 봐야 한다

지금 통과 판정은 **이미 사람 손을 거친 원고 31건** 으로 확인한 것이다
(30건 통과 · 오염된 1건만 차단 · 오탐 0). 하지만 앞으로 들어올 원고는
그날 ChatGPT 가 새로 쓴 것이다. 문체·길이·오염 양상이 다를 수 있다.

며칠은 **회수까지만** 돌리고 사람이 `draft.md` 를 읽어야,
"관문이 통과시킨 것이 실제로 쓸 만한가" 를 알 수 있다.

### ② 원고 품질과 등록 안전은 다른 문제다

관문은 "형식이 맞는가" 를 본다. "내용이 좋은가" 는 보지 않는다.
`batch-qa` 와 `magazine-qa` 가 그 자리인데, 자동 등록을 켜면
그 판정 결과를 아무도 읽지 않은 채 PR 이 열린다.

### ③ 지금 켤 이유가 없다

재고가 **9/17까지** 있다. 급하지 않다.
급하지 않을 때 켜는 것과 급할 때 켜는 것은 다른 결정이다.

## 다음 단계에서 무엇을 보고 켜나

이 세 가지가 모이면 `--write --pr` 을 연다.

1. **회수 성공률** — 연속 5회 이상 `draft.md` 가 관문을 통과해 저장됐다
2. **사람 판정** — 그렇게 받은 원고를 창업자가 읽고 "이대로 나가도 된다" 고 했다
3. **관문 오탐 0** — 쓸 만한 원고가 막힌 적이 없다

🔴 **아래 문단은 2026-09-15 에 폐기됐다. 남겨 두는 이유는 무엇을 잘못 알았는지 보이기 위해서다.**

> ~~켤 때 고치는 것은 plist 한 줄이다.~~
>
> ```xml
> <key>ProgramArguments</key>
> <array>
>   <string>…/node</string>
>   <string>…/scripts/magazine-auto-register-run.mjs</string>
>   <string>--write</string>   <!-- 이 두 줄 -->
>   <string>--pr</string>
> </array>
> ```
>
> ~~`magazine-auto-register-check.mjs` 가 이 두 줄이 **없는 것** 을 PASS 로 검사한다.~~

**틀린 이유**: 그 두 줄을 넣어도 job 이 돌지 않았다. plist 가 symlink 라 TCC 가
읽기를 거부했고(등록 자체가 안 됨), `gh` 가 PATH 에 없었고, main 복귀가 없었고,
실패가 exit 0 으로 숨겨졌다. **"한 줄" 이라는 말이 점검을 건너뛰게 만들었다.**

지금 절차는 [`docs/operations/magazine-automation-runbook.md`](../operations/magazine-automation-runbook.md) 에 있다.
회귀 테스트도 뒤집혔다 — 이제 템플릿에 `--write --pr` 이 **있는 것**을 PASS 로 보고,
대신 **자동 merge 인자가 없는 것**과 **supervised 영수증 없이는 설치되지 않는 것**을 검사한다.

## 비용

**늘지 않는다.**

- 원고: ChatGPT **웹 UI** 를 Playwright CDP 로 조종한다. 종량 API 키를 쓰지 않는다
- brief: `claude` **CLI** 를 자식 프로세스로 부른다. 역시 구독이다
- 이미지: 같은 ChatGPT 창에서 만들고 Chrome canvas 로 webp 인코딩한다

새 유료 API 도 새 외부 서비스도 붙이지 않았다.

## 남은 것 — 별건

**`after-holiday-body-ache` 의 오염은 아직 production 에 남아 있다.**
이번 PR 은 재발을 막을 뿐 이미 나간 것을 고치지 않는다 —
`articles.ts` 본문 수정은 이 작업의 범위가 아니다.

지울지, 문장을 다듬을지는 창업자가 정한다.
