# 매거진 자동화 운영 runbook

작성 2026-09-15 · 갱신 2026-11-09 · 대상: `com.soransoran.magazine-producer` · `com.soransoran.magazine-auto-register` · `com.soransoran.magazine-watch` · `com.soransoran.magazine-auto-merge-recovery`(2026-10-09) · `com.soransoran.magazine-graph-watch`

이 문서가 **설치·가동·롤백의 정본**이다. 다른 곳에 절차를 다시 적지 않는다.

---

## 0. 경계 — 무엇을 자동으로 하고 무엇을 안 하나

| | 자동 | 사람·CI |
|---|---|---|
| graph readiness·ContentPlan | vNext: ✅ compiler 가 ContentPlanInputBundle 에서 결정적으로 컴파일(§0.0B.1) · 공급 loop 는 병렬(charter §18-B.5) | DIRECT 현행 코드: G8 편입 · ArticlePlan prepare/approve/materialize 가 queue 앞에서 완료(§0.0A) |
| 다음 계획 선택 | ✅ producer — DIRECT 현행: `SPEC_READY` 참조 · vNext: 출판 최소를 충족한 ContentPlan(charter §18-B.2) | 계획 내용을 재해석하지 않음 |
| 원고 생성 + 관문 | ✅ producer — legacy: ChatGPT 웹 UI · vNext: ManuscriptProvider API(§0.0B.2) | |
| 변환 · QA · hero · batch-qa | ✅ auto-register | |
| `articles.ts` 등록 (**PR 브랜치 위에서**) | ✅ auto-register | |
| **PR 생성** (`[merge 금지]`) | ✅ auto-register | |
| **PR merge** | ✅ auto-merge (검증 통과 시) | |
| **production 공개** | 🔴 **절대 안 함** | `publishAt`(10:30 KST) 도달 시 자동 |

🔴 **2026-09-16 경영 결정 — 목표는 완전 무인 운영이다.** merge 도 자동이 됐다.

🔴 **그러나 자동 "공개" 는 아니다.** merge 해도 글은 `publishAt` 전까지 어디에도 안 나온다.
사람이 사라진 자리는 "PR 을 읽는 눈" 이고, 그 자리를 `lib/magazine-merge-gate.mjs` 가 대신한다.
**모르면 막는다** — 확인하지 못한 항목이 하나라도 있으면 merge 하지 않는다.

### 0.0A 현행 legacy·DIRECT 실행 설명 (vNext 구현 전까지)

정책은 charter §18-B, vNext 실행 계약은 §0.0B 다. 이 절은 **지금 main 코드가 실제로 하는 일**과 운영자가 따라야 할 절차만 적는다.

- 🔴 **legacy 는 2026-11-09 부터 기능 동결이다**(창업자 결정 · §0.0B.7). 안전 긴급 수정 외에는 기능·정책을 보정하지 않는다.
  동결은 코드 변경 금지이지 운영 정지가 아니다 — vNext 가 실제 쓰기를 시작할 때 rollout switch 가 legacy writer 를 배타 정지한다.
- 자연 회차의 운영 경로는 `LEGACY_BRIEF_V1` 이다. `DIRECT_SPEC_V1` 코드 경로도 main 에 있다.

```text
LEGACY_BRIEF_V1  frozen legacy queue -> Claude brief -> ChatGPT manuscript -> draft.md -> QA...
DIRECT_SPEC_V1   GRAPH_READY -> G8 -> ArticlePlan -> ArticleSpec -> manuscript -> draft.md -> QA...
```

- 한 run 에서 두 mode 를 섞지 않는다. DIRECT 실패 행을 legacy 로 자동 강등하지 않고, HOLD 를 남겨 같은 신원으로 재개한다.
- `draft.md` · QA · 재생성 예산 · HOLD · dirty-tree · 원자 교체 · exact-head · 배포·watch 관문은 두 경로에 공통이다.
- **DIRECT 경로의 ArticlePlan 명령 (현행 코드)** — G8 은 연구 admission(receipt · slug manifest · ledger)만 기록하고 큐를 쓰지 않는다.
  - `magazine-direct-spec-source-authoring.mjs prepare` — 읽기 전용. 큐 행 없이 admission 과 현재 제품 graph 를 대조해
    DRAFT 후보를 낸다. 관계는 receipt edge 로 고정한다.
  - `approve` — 현행 코드는 기계가 아닌 `--approver` 를 요구한다(`MACHINE_APPROVER`). 승인 직전에 admission·graph 를 다시 대조하고,
    plan 을 topic-queue union 으로 검증한 뒤 `drafts/magazine/article-spec-source/<graphVersion>.json` 에 entry 하나를 더한다.
  - `materialize` — entry 하나로 큐 writer lock 안에서 `max(day)+1` 행을 넣고, 같은 parser 로 다시 읽어 대조한다.
  - 소비 쪽 fail-closed: G8 해시(`g8ManifestHash` · `articlePlanHash`) 중 하나라도 있는 행은 둘 다 있고 `DIRECT_SPEC_V1` 이어야 한다
    (`G8_ROW_NOT_DIRECT`). plan 복제 필드를 손으로 고치면 `SOURCE_QUEUE_DRIFT` 다.
  - 승인 잠금(`article-spec-source/<graphVersion>.json.lock`)이 있어 `LOCK_BUSY` 이면 자동으로 지우거나 재시도하지 않는다.
    잠금의 pid 와 실행 중 프로세스를 확인한 뒤 사람만 stale 잠금을 정리한다.
  - `.release-*` 파일이 보이면 자동으로 지우지 않는다 — 해제 경쟁의 사고 잔존물로 보고 주인을 확인한다.
  - materialize 가 `QUEUE_WRITE_CONFLICT` 이면 큐에서 해당 slug·intent 행과 source 관문 결과를 확인하기 전에는
    producer 를 실행하지 않는다. `concurrentWrite: true` 성공은 다른 writer 의 변경을 보존한 채 내 행이 그대로라는 뜻이다.

### 0.0B 🔴 Magazine vNext 실행 계약 (2026-11-03 설계 동결 · 2026-11-09 S0 재동결 · 구현 전)

권위 객체·관계·ContentPlan·공급 정책은 charter §18-B, 현재 상태와 단계 순서는 milestone 이 정본이다. 이 절은 **실행**만 정한다.
🔴 아직 구현 전이다. 아래는 구현이 지켜야 할 계약이며, 지금 운영은 동결된 legacy 경로다(§0.0A).

#### 0.0B.1 입력 · ProviderPlan · Job

**입력 흐름**

```text
연구 current + exact snapshot ─export(엄격 투영 · content-addressed)→ ContentPlanInputBundle
      제품 저장소 추적 대상 · bundleHash(내용 신원) + recordHash(출처 봉인: graph 판·current 해시 · export 시점 control 전체 해시 포함)
Bundle + 정책 판 ─compiler(정적 · 결정적)→ ContentPlan(planHash · 날짜·slug 없음 · `<graphVersion>:<intentId>`)
ContentPlan + 현재 control·articles·legacy queue 신원·시각·진행 중 신원 ─admission(동적)→ 후보 | HOLD(사유 코드) · planHash 불변
admitted ContentPlan ─허용 필드 투영 + PII scan→ ProviderPlan(additionalProperties:false) → ManuscriptProvider
```

- 🔴 **runtime 은 mutable 비-git 연구 폴더를 직접 읽지 않는다.** 이유: 그 폴더는 바뀌고 이력이 없어, 같은 planHash 를 나중에 다시 만들 수 없다.
- Bundle 은 graph 판과 같은 승격 변경으로만 들어온다. 현재 배포판 `g-20261102-427d4d` 의 최초 Bundle 만 S2 bootstrap 변경으로 1회 추가할 수 있고,
  그 조건(Bundle 미존재 · 제품 graph/control/tree hash 와 연구 current 후보 신원 정확 일치 · graph 바이트 변경 0 · 어긋나면 쓰기 0)의 정본은 charter §18-B.5 다.
  Bundle 판독 불가·두 해시(`BUNDLE_HASH_MISMATCH` · `RECORD_HASH_MISMATCH`) 불일치이면 compiler 는 그 graphVersion 의 plan 을 하나도 만들지 않는다.
  bootstrap 실행 API 에는 판을 바꾸는 손잡이가 없고(허용 판은 상수 하나), 출력 경로 구성 요소가 symlink 면 쓰지 않는다(제품 루트 밖 쓰기 0).
  쓰기는 crash-safe no-clobber 다 — 최종 파일은 없거나 바이트가 같고 fsync 된 완전한 파일이다(짧은 쓰기 반복 · 되읽기 대조 · link 의 EEXIST 만
  `BUNDLE_ALREADY_EXISTS` · 그 밖의 link 오류는 `BUNDLE_WRITE_FAILED` · 새 폴더 부모와 대상 폴더 fsync · link 뒤 경로 바꿔치기는 `OUTPUT_PATH_RACE`).
  앞 실행이 남긴 임시 파일이 있으면 지우지 않고 `STALE_TEMP_PRESENT` 로 멈춘다.
  🔴 경로는 **검증된 폴더 inode 에 고정**한 뒤 쓴다(2026-11-11 S2 P1-7) — Node 에 openat · linkat 이 없어 제품 루트부터 구성 요소마다
  lstat → chdir → dev·ino 대조로 cwd 를 고정하고, tmp open · link · 정리를 상대 이름으로만 한다. 경로가 중간에 symlink 로 바뀌어도
  제품 루트 밖 바이트 · 이름은 생기지 않는다(`OUTPUT_PATH_RACE`). 한계: 고정한 폴더 자체를 옮기면(rename) 그 폴더를 따라간다 — openat 과 같고, 사후 확인이 지운다.
  🔴 **입력 CAS** — 컴파일에 쓴 권위 입력(제품 current · control · graph 판 · 연구 current 링크 대상 · 트리 · manifest · control.json · snapshot · 증거)을
  link 바로 앞에서 같은 함수로 다시 읽어 키 단위로 대조한다. 바뀌었으면 `INPUT_DRIFT` · 출력 0. Bundle 바이트에 들어가지 않는 articles · queue 는 보지 않는다.
  🔴 증거 파일은 ENOENT 만 "없음"이다. 그 밖의 읽기 오류(EACCES · EIO …)는 `EVIDENCE_READ_FAILED` 로 전체를 멈춘다. 모든 파일 시스템 오류는
  `{ ok:false, code, why, errno }` JSON · exit 1 이다(`FILESYSTEM_ERROR` 포함 · stack trace 0).
- 🔴 **두 해시 (2026-11-10 S2 P1).** ContentPlan · planHash 는 `bundleHash`(schemaVersion · graphVersion · intents · relations · mappings)만 싣는다.
  export 시점 control 토글 · current 주석 · manifest `generatedAt` 같은 출처 변화는 `recordHash` 만 바꾸고 planHash 를 바꾸지 않는다.
- 🔴 **control 은 컴파일 입력이 아니다 (2026-11-10).** Bundle 의 control 전체 해시는 export 시점 출처 기록이다. 현재 control 은 admission 이 엄격
  판독(`parseGraphControl` · 토큰 단위 실제 선언 · **데이터 전용** — JS 실행 0 · getter · 호출 · spread · 중복 key 는 판독 불가)해 graphVersion 불일치(`GRAPH_VERSION_MISMATCH`) · kill switch · graph 꺼짐 · 꺼진 cluster · 근거 있는 direct 관계의
  켜진 표면 없음이면 fail-closed 로 HOLD 한다. 정당한 control 토글은 Bundle 을 무효로 만들지 않고 planHash 를 바꾸지 않는다.
- 🔴 **정적 / 동적 분리.** ContentPlan · planHash 의 입력은 엄격 판독한 Bundle 과 버전이 붙은 정책 판뿐이다(정책 판 · 원문 경계 규칙의 내용은
  id 별 기대 해시로 고정한다 — 내용을 바꾸면 legacy 공유 상수 변경이어도 id 를 올린다). 현재 control · articles · legacy queue ·
  판정 시각 · 진행 중 신원 · same-release(이미 공개된 대상에서 출발하는 층 · 순환/고립 HOLD · 후보 탈락 뒤 고정점 재판정)는 admission 이다.
  same-release 후보끼리도 정확 신원(intentId · canonical mapping slug · 정규화 제목)을 공유하면 그 묶음에서 planId 가 가장 작은 후보 하나만 남고
  나머지는 `DUPLICATE_SAME_RELEASE` 다(입력 순서와 무관). articles 의 공개 시각은 오프셋이 있는 엄격 시각만 받는다 — 달력에 없는 날(2/30 · 평년 2/29) ·
  24:00 · 범위 밖 오프셋은 `ARTICLES_UNREADABLE`(앞판 `Date.parse` 는 2/30 을 3/2 로 넘겼다). Bundle · 입력의 희소 배열(빈 칸)은 해시 전에 거부한다.
  S3 release 는 release·merge 직전에 같은 admission 을 다시 돈다.
- 🔴 **legacy queue 임시 신원 adapter.** vNext 는 queue 를 plan·콘텐츠 입력으로 쓰지 않고 **절대 쓰지 않는다.** legacy 가 남아 있는 동안 admission 이
  `drafts/magazine/topic-queue.ts` 에서 신원 투영(intentId · slug · 정규화 제목 · cluster)만 읽어 중복을 본다. 파일·앵커를 못 읽으면 fail-closed
  (`QUEUE_IDENTITY_UNREADABLE`) — 같은 slug 두 행 · 한 행의 같은 필드 두 번 · articles 의 같은 slug 두 번 · 공개/예약 행의 해석 불가·오프셋 없는
  공개 시각도 같다(원시 중복을 마지막 값으로 덮지 않는다). 같은 cluster 라는 이유만으로 막지 않는다. 초안·HOLD·격리 바이트는 읽지도 승계하지도 않는다(§0.0B.7).
- 🔴 **slug 는 S3 에서 묶는다.** S2 는 slug 를 만들지 않고 legacy queue · source materialization 을 쓰지 않는다. admission 은
  `SLUG_BINDING_REQUIRED` 를 드러내고, S3 의 vNext release 신원 경계가 stable slug 를 묶는다. S2 는 현재 queue 기반 G8 workflow 를 부르지 않는다.
- 초기 commissioning 은 **STANDARD 만** 컴파일한다. CONTROLLED(MEDICAL · FINANCIAL · SENSITIVE)는 validator 전까지 `CONTROLLED_VALIDATOR_ABSENT` 로 HOLD.
  3+1 은 plan 의 품질·표시 metadata 일 뿐 하드 게이트가 아니다. 하드 관계 최소는 근거 있는 direct 관계 1개다.

**ProviderPlan — provider 에 보내는 유일한 입력**

| 허용 (이 목록뿐) | 금지 |
|---|---|
| `primaryQuery` · `audienceSituation` · `answerScope` · inclusions · exclusions · `validationProfile` · forbidden claims · CTA·community destination · **이미 공개된** 관련 글의 title·slug · 승인된 공식 출처 URL | 회원 데이터 · 커뮤니티 원문·제목 · raw evidence·SERP snippet · 로컬 경로 · token·tracking 파라미터가 붙은 URL · 목록에 없는 모든 필드 |

- schema 는 `additionalProperties: false` 다. 허용 목록으로 새 객체를 만들고(1차 방어) exact-key 를 확인한다.
- 🔴 **호출자 값을 믿지 않는다 (2026-11-11 S2 P1).** ProviderPlan 은 호출자가 준 plan · admission 결과(관련 글 title · slug)를 받지 않는다.
  같은 admission 입력으로 봉인된 Bundle 에서 다시 컴파일 · admission 해 도출하고, job 이 묶인 planHash 와 다르면(내용 · 정책 판이 바뀐 낡은 plan)
  `PLAN_STALE` 로 돌려주고 ProviderPlan 은 만들지 않는다(산출 0). 정책 판 · 원문 경계 규칙은 id 별 기대 해시 신원표가 runtime 에서 강제한다(`POLICY_IDENTITY_DRIFT`).
- 🔴 내부 주석 표식(`🔴` 등)·원문 근거 경로·로컬 경로·token·query/fragment 가 붙은 URL 이 하나라도 있으면 **조용히 지우지 않고** ProviderPlan 을 만들지 않는다.
  Bundle · ContentPlan 의 원문 문자열은 그대로 보존한다 — 고칠 곳은 연구 정본이다.
- 🔴 **커뮤니티 원문·제목은 구조로 막는다 (2026-11-10 S2 P1).** Bundle 조립 때 intent 의 provider 행 문장을 연구가 관측한 제3자 글
  (canonical 증거의 검색 결과 제목 · snippet · `communityTitle` — 우리 사이트 결과 제외)과 결정적으로 대조해 intent 마다 `textProvenance`
  (`CLEAR` · `THIRD_PARTY_TEXT` · `UNVERIFIED`)만 싣는다. `CLEAR` 가 아니면 ProviderPlan 0 이다. 문구 목록이 아니고, 원문은 Bundle 에 싣지 않는다.
  한계: 연구 증거 corpus 밖에서 손으로 옮긴 원문은 이 판정이 보지 못한다 — 2차 스캔과 연구 정본 수정이 맡는다.
- 전송 직전 PII scan(전화 — 괄호 지역번호 · 국가번호 포함 · 이메일 · 주민등록번호 · 계좌 — 공백 · NBSP · 대시 구분과 이어 쓴 10~14자리 포함 · 저장소 상대 경로 · 일반 credential 꼴 등)을 **반드시** 돈다.
  걸리면 그 Job 만 HOLD 한다(2차 방어).
- 이유: provider 쪽 보존(§0.0B.2 `store:true`)을 허용하는 근거가 "회원 데이터가 없다" 하나뿐이므로, 그 전제를 구조로 강제한다.

**Job — 글 하나의 실행 기록**

- 위치: runtime 밖 `~/Library/Application Support/soransoran/magazine-jobs/<planHash>/job.json` (Git 밖). 글 하나당 하나.
- 담는 것(파생할 수 없는 사실만): `planHash` · `providerPlanHash` · `contractHash` · 요청 키 · response ID · `nextPollAt` · 원고·이미지·응답 해시 ·
  usage·실제 또는 계산 가능한 비용 · 검증 결과 · 부분 수리·전체 재생성 횟수 · DELETE 확인(시각·결과) · release PR 번호 · 실패 원인 · 상한 있는 `attempts[]`.
- 담지 않는 것: READY · EXPIRED · RELEASE_READY 같은 파생 상태. 매번 계산한다.
- 쓰기: temp + rename 원자 덮어쓰기. replay·compaction 장부를 만들지 않는다.
- 상태는 기록한 사실에서 계산한다.

```text
PLANNED → SUBMITTED(responseId) → GENERATED(로컬 저장·해시 검증) → REMOTE_DELETED(확인 기록)
        → VALID | NEEDS_REPAIR → VALID → HERO_READY → IN_RELEASE(pr) → RELEASED
전송 여부·ID 수신이 불명 → SUBMISSION_UNKNOWN → 확인 → SUBMITTED | 회수 불능 확정
어디서든 → HOLD(reason)   ※ 그 Job 만
```

- 🔴 불변조건: **planHash 당 진행 중 요청 ≤1 · 최종 채택 원고 1개 · 비용 상한 안.** 이유: vNext 에서 실제 위험은 공개 중복과 비용 폭주다.
  legacy 의 "같은 메시지 지문 재전송 0" 은 브라우저 한 대화에 요청이 쌓이는 것을 막던 규칙이라 그대로 옮기지 않는다.
  legacy 격리 장부(`scripts/lib/magazine-quarantine.mjs`)는 legacy 삭제 단계까지 그대로 둔다.

#### 0.0B.2 Provider 계약

- **ManuscriptProvider · ImageProvider · EvidenceProvider 를 코드 계약으로 분리한다.** 같은 OpenAI API 를 쓸 수 있지만 실패·비용·재시도는 독립이다.
- provider 는 graph · queue · `publishAt` · PR · Git · 다른 후보를 모른다. ProviderPlan(§0.0B.1)만 받는다.
- 🔴 **브라우저 ChatGPT 는 자동 fallback 이 아니라 수동 비상수단이다.** 어떤 실패도 브라우저로 자동 강등하지 않는다.
- ManuscriptProvider 는 구조화 원고와 `heroScene` 을 낸다. ImageProvider 는 **원고가 검증을 통과한 뒤** 그 `heroScene` 으로 hero **한 장**을 만든다.
  이유: 이미지를 원고 뒤에 한 번만 만들어야 원고 수리·재생성이 이미지를 다시 부르지 않고, 이미지 실패가 원고를 다시 부르지 않는다.

**ManuscriptProvider — Responses API · background · `store: true` (2026-11-09 창업자 결정)**

`store: true` 는 회원 데이터가 없는 ProviderPlan(§0.0B.1)에만 쓴다. 이유: OpenAI 공식 문서상 background 응답은 `store` 없이
약 10분 뒤 삭제되므로, 프로세스가 재시작되거나 Mac 이 잠든 뒤에도 같은 response ID 로 이어 보려면 보존이 필요하다.

1. 생성 요청 직전에 요청 키를 배타 생성한다(`openSync wx`) — 같은 planHash 의 두 번째 요청을 막는다.
2. 응답으로 받은 **response ID 를 즉시 Job 에 원자적으로 기록**한다.
3. **bounded polling** — worker 는 정해진 점유 시간 안에서만 조회하고, 끝나지 않았으면 `nextPollAt` 을 Job 에 쓰고 종료한다.
   다음 회차나 재시작이 같은 response ID 로 이어 본다. 점유 상한은 실행 자원 보호용이며 생성 실패 판정이 아니다.
4. terminal 응답 → 원고·usage·응답을 **로컬에 원자 저장 → 해시 검증 → `DELETE /responses/{id}` → 삭제 확인(시각·결과)을 Job 에 기록**.
5. DELETE 실패는 진행을 막지 않는다. sweeper 가 다음 회차에 같은 ID 로 다시 시도하고, 404 는 삭제 완료로 본다.
6. 🔴 DELETE 는 우리 쪽 보존을 끝내는 요청이다. **provider 서버 기록이 즉시 완전히 사라진다고 약속하지 않는다**(provider 의 별도 보존 정책이 있다).
7. 🔴 **`SUBMISSION_UNKNOWN`** — 요청이 전송됐는지 · response ID 를 받았는지가 불명확하면 **즉시 재전송하지 않는다**.
   요청 키·응답 기록으로 상한 있는 확인(reconciliation)을 한 뒤, 회수할 수 없다고 확정될 때만 8번으로 간다.
   ID 를 받지 못한 원격 응답이 남았을 수 있다는 사실은 Job 에 기록한다(그 ID 는 몰라서 지울 수 없다).
8. 회수 불능이 확정되면(조회 404 · 만료 · 확인 실패) **비용 상한 안에서 재생성 최대 1회**. 최종 채택 결과는 하나다. 그 뒤에도 실패하면 그 Job HOLD.
9. 🔴 부분 수리에 `previous_response_id` 를 쓰지 않는다. 필요한 맥락은 매번 명시적으로 보낸다 — 원격 응답을 지운 뒤에도 수리가 되어야 한다.
10. AUTH·계통 장애가 아니면 다른 Job 은 계속 처리한다.
11. background + strict structured output(Structured Outputs) 조합은 **S5 canary 에서 실제로 검증**한다. 실패하면 **`DESIGN_CONTRACT_CONFLICT` 로 중단**하고
    브라우저로 강등하지 않는다.

**ZDR / `store:false` 후퇴 모드** — 응답의 `store` 실효값이 false 이면(ZDR 프로젝트 등) 자동으로 이 모드다.

- 회수창은 약 10분이다. worker 는 terminal 까지 붙어 조회하고, 창을 넘기거나 프로세스가 죽으면 회수 불능으로 확정해 8번을 적용한다.
- DELETE 는 생략할 수 있고, Job 에 모드를 기록한다. 브라우저 자동 강등은 없다.

- Batch 는 pilot 에서 쓰지 않는다.

**모델 — cheapest viable first (2026-11-09 창업자 결정)**

- 원고: `gpt-6-luna` 와 `gpt-6.1-terra` 를 **같은 STANDARD ContentPlan** 으로 블라인드 비교한다(하드 게이트 통과 · 구조화 출력 성공 · 창업자 블라인드 품질 · 비용).
  Luna 가 하드 게이트와 창업자 품질을 통과하면 Luna 를 기본으로 쓴다.
- 🔴 QA 1회 실패만으로 비싼 모델로 올리지 않는다. 이유: 실패 대부분은 수리 대상이고(§0.0B.3), 모델 상향은 편당 상한을 먼저 깬다.
- 이미지 baseline `gpt-image-2.5-flare`(필요 시 `gpt-image-2.5-sunburst` 비교). 모델명·단가는 S5 직전 공식 가격 페이지로 다시 대조한다.
- **API 키**: S5 직전에만 창업자가 **별도 project · 최소 권한**으로 만든다(Responses 생성·조회·삭제 · 이미지 생성). 키는 저장소·로그·Job 에 쓰지 않는다.
  DELETE 권한과 `store` 실효값은 S5 canary 의 확인 항목이다.

**EvidenceProvider (M-GRAPH 공급 loop 의 외부 수집기 — 정책은 charter §18-B.5 · 첫 글 뒤·병렬)**

- 입력 `{ intentId, graphVersion, slot: DIRECT | DISCOVERY, query, locale, engine }` · 출력은 정규화 가능한 검색 hit 목록.
- 멱등 키 = `sha256(engine | query | locale | YYYY-MM)` — 같은 달 같은 질의는 저장된 결과를 쓰고 호출 0.
- 예산: 현재 SerpAPI 구독 범위 안 · 유료 추가 0(증거 예산은 승인된 적 없다) · 기본 상한 하루 20회 · 월 200회.
- 실패 범위는 질의 1개. 429·5xx·네트워크는 같은 키로 백오프 2회 → 그 질의만 다음 회차. 상한 도달은 그날 loop 중단(실패 아님).
- 키는 출력·저장하지 않는다.

**예산 (2026-11-03 창업자 결정 · 2026-11-09 재확인)**

| 항목 | 상한 | 넘으면 |
|---|---|---|
| S5 canary 총액(모델 비교 포함) | **$5** | canary 중단 |
| 편당 provider hard cap | **$1** | 그 후보만 HOLD |
| pilot 월 hard cap | **$30** | 새 provider 호출 0 · 검증된 후보의 release 는 계속 · 알림 1회 · 다음 달 재개 |
| 월 $100 확대 | **미승인** | — |

- A commissioning(S6)은 canary 뒤에 편당 $1 · 월 $30 상한 안에서 집행한다. S5 의 $5 와 합산하는 별도 상한이 아니다.

비용은 Job 에 호출마다 기록하고 합계는 계산한다. 코드 상한이 1차 방어다.

#### 0.0B.3 검증 · 부분 수리 · 전체 재생성

검증은 결정론적 코드다(기존 `magazine-qa.mjs` · `magazine-batch-qa.mjs` · `lib/magazine-forbidden.mjs` · profile QA).

| 위반 | 처리 |
|---|---|
| 고정 문장 누락(진료 안내 · 위기 상담 안내 · CTA) | 정본 문장을 **결정적으로 삽입** → 재검증 |
| description · FAQ · CTA · 단순 표현 | **그 필드·문장만** 수리 → 같은 검증기로 재판정 |
| 금지 패턴 일치 | **일치 문장 하나만** 재작성 → 같은 검증기로 재판정. 동사·문맥 예외 목록을 늘리지 않는다 |
| 의료·법률·세금·금융 사실 오류 · 검색 의도 불일치 · 구조 붕괴 | 문장 수리로 덮지 않는다 → **전체 재생성** |
| 그 뒤에도 실패 | **그 후보만 HOLD** |

- 기본 상한: 부분 수리 최대 2곳 · 전체 재생성 최대 1회 · 이후 그 후보 HOLD. 모든 수리·재생성은 편당 비용 상한 안에서만 한다.
- 🔴 CONTROLLED 후보(charter §18-B.6)는 주장↔출처 validator 가 구현·검증되기 전 **출판 0** 이다. 구현 뒤에는 release 직전에 사실 확인 항목의
  기준일을 다시 대조한다. 초기 commissioning 은 STANDARD 만 쓴다.
- hero: 16:9 원본 비율 유지(잘라 맞추고 늘리지 않는다) · 크기·형식 · 기존 hero 와의 지각 해시 중복을 자동으로 본다.
  실패하면 이미지만 1장 다시 만들고(원고 재생성 0), 그래도 실패하면 그 후보 HOLD.
- **같은 hero 한 장을 상세 hero · 홈/목록 썸네일 · 본문 중간 브랜드 띠배너에 재사용한다**(charter §12). 띠배너용 이미지를 따로 만들지 않는다.

#### 0.0B.4 release writer · merge gate · 날짜 마지막 배정

🔴 **현행 queue · `scripts/magazine-register.mjs` · legacy merge gate 를 vNext 에 억지로 재사용하지 않는다.** 이유: 셋 다 queue 행을 정본으로 요구한다 —
등록은 queue 에 없는 slug 를 거부하고, legacy merge gate 는 queue 에 없는 slug 를 `NOT_IN_QUEUE` 로 막으며 파일 이름을 legacy 산출물로 고정한다.

**release writer**

- **하나다.** `articles.ts` 와 날짜를 쓰는 유일한 주체이며 생성 worker 와 분리한다.
- 쓰기는 queue 에 의존하지 않는 journal + CAS 트랜잭션이다 — 읽은 `articles.ts` 바이트의 해시를 확인하고 쓰며, 다르면 그 release 를 다시 조립한다.
- 입력은 VALID·HERO_READY 이고 아직 release 되지 않은 Candidate 중 `targetCandidates` 개 이하다. 묶기 위해 원고를 더 만들지 않는다.
- 🔴 **출판 최소 고정점 재판정**: Candidate 를 하나 뺄 때마다(검증·조립·CI 실패) 남은 Candidate 의 출판 최소(charter §18-B.2)를 다시 판정하고
  변화가 없을 때까지 반복한다. 빠진 Candidate 는 검증됨(VALID) 상태로 되돌린다.
- same-release: 대상 `publishAt` ≤ 원문 `publishAt` · 관계는 DAG · 위상 순서로 날짜 배정 · 이미 공개된 글에 닿지 않는 고립 순환·묶음은 release 하지 않는다(charter §18-B.4).
- `publishAt` 은 **release 직전에** 배정한다 — main 과 열린 release PR 의 날짜를 읽어 내일부터 빈 날(10:30 KST).
- 날짜를 놓치면 그 PR 을 닫고 다시 조립한다. ContentPlan·원고·해시는 바뀌지 않는다.
- branch 는 `feat/magazine-release-*`, PR 은 하나다. 한 편과 여러 편이 같은 코드다.

**vNext merge gate**

- SHA 고정 · CI · 중복 slug(PR 안 · main) · 예약일 형태와 중복 · 과거 날짜 금지 — legacy 와 같은 위험을 같은 방식으로 막는다.
- 변경 파일 모양은 그 release 의 slug 집합에 대한 `articles.ts` 항목 · hero · 그 글의 ContentPlan 파일만이다(정확한 파일 이름은 S3 에서 고정).
- 🔴 **main 의 ContentPlanInputBundle · 정책 판으로 ContentPlan 을 재컴파일한 planHash 가 PR 의 planHash 와 같아야 하고, 같은 admission 을
  merge 직전에 다시 통과해야 한다.** 이유: PR 이 자기 위험 등급이나 관계를 바꿔 통과하는 것을 queue 없이 막는 방법이다(legacy `QUEUE_GRADE_CHANGED` 가 하던 일).
  control 은 planHash 입력이 아니라 admission 입력이다(§0.0B.1).
- stable slug 는 이 단계(S3)의 vNext release 신원 경계가 묶는다 — admission 의 `SLUG_BINDING_REQUIRED` 를 여기서 해소한다.
- release CI 가 실패하면 그 release 만 닫고 Candidate 를 검증됨으로 되돌린다.
- 🔴 **열린 release PR 은 다음 release 만 기다리게 한다. 생성은 막지 않는다.** (§0.1 의 전역 HOLD 는 legacy 경로의 현행 동작이다.)
- `--admin` 을 쓰지 않는다.

#### 0.0B.5 rollout switch — lifecycle

**위치** (runtime·저장소 밖 — merge 가 곧 활성화가 되지 않게 한다. runtime 은 00:10 에 main 을 ff-only 로 따라붙는다)

```text
~/Library/Application Support/soransoran/magazine-rollout.json
```

**schema**

```json
{
  "schemaVersion": "magazine-rollout/1",
  "path": "legacy | vnext",
  "release": "draft | auto",
  "targetCandidates": 1,
  "changedBy": "...",
  "changedAt": "...",
  "previous": {
    "path": "legacy | vnext",
    "release": "draft | auto",
    "targetCandidates": 1
  }
}
```

**전환 중 계약**

| 항목 | 계약 |
|---|---|
| 없음 · 손상 · schema 불일치 | `legacy` 로 본다. 이때 vNext 쓰기 0 · 상태가 바뀔 때 알림 1회 |
| 쓰기 | 단일 owner CLI 만 원자적으로 쓴다(schema 검증 · temp + rename · `changedBy` · `changedAt` · `previous` 기록) |
| 읽기 | `magazine-producer-run.mjs` 와 `magazine-auto-register-run.mjs` 가 회차 시작 때 **각각 한 번** 읽는다 — 잠금·sync·자식·알림보다 앞이다 |
| 🔴 legacy writer 배타 정지 | `path: vnext` 이면 두 진입점은 legacy 단계를 하나도 시작하지 않는다. vNext 의 실제 쓰기는 이 상태에서만 시작한다 — 한 회차에 두 writer 가 없다 |
| launchd | plist 변경 0 |
| A commissioning | `path: vnext` · `release: draft` · `targetCandidates: 1` |
| 다른 cluster 2~3편 · 자연 무인 회차 | `path: vnext` · `release: auto` |
| 이 문서 작업 | 실제 운영 rollout 파일 생성·활성화 **0** |

**A · 첫 무인 글 · 다른 cluster 검증 이후**

- vNext 를 고정하고, legacy 삭제와 **같은 변경에서** switch 분기와 `release: draft` 분기를 코드에서 제거한다.
- 제거 이후의 이상 상태는 legacy fallback 이 아니라 **생성 HOLD** 다. release 와 이미 공개된 Article 은 영향 없다.

#### 0.0B.6 A commissioning · 다른 cluster 2~3편 · 자연 무인 회차

🔴 **A 는 수동 경로가 아니라 같은 자동 경로의 commissioning 이다.** 자동화를 줄이지 않고, 전체 자동 경로를 `vnext / draft / 1` 로 돌린 뒤
마지막 병합만 창업자가 정한다.

**A (1회)**

1. compiler 가 출판 최소(charter §18-B.2)를 충족한 **STANDARD** ContentPlan 하나를 고른다. 공급 loop 산출을 기다리지 않는다.
2. 실제 provider 로 원고와 hero 를 만들고, 실제 검증·수리를 돈다.
3. release writer 가 **Draft release PR** 을 만든다 — **auto-merge 0**.
4. 창업자가 로컬 dev 렌더에서 상세·홈·목록·hero·띠배너를 확인한다. 미래 `publishAt` 글을 보려고 **dev 전용 시계 주입**을 쓴다 —
   `NODE_ENV=development` 에서만 읽고 production build 는 무시한다. 제품 route 추가 0. 이유: 공개 판정이 현재 시각 기준이라 예약 글은 그 밖에서 보이지 않는다.
5. 창업자 **예/아니오 1칸**.
6. 예 → **수동 병합**. 아니오 → 병합하지 않고 닫은 뒤 원고가 아니라 **시스템을 고치고** 같은 ContentPlan 으로 재생성.

- 사람이 원고나 이미지를 직접 고치면 A 는 FAIL 이다.
- A 전용 승인 필드 · 승인자 필드 · 영구 대기 상태를 만들지 않는다. 판정은 PR 병합 여부 그 자체다.
- 🔴 **A 는 M-AUTO `OPERATING_PASS` 가 아니다.**

**다른 cluster 2~3편 · 자연 무인 회차 B**

- A 다음은 `vnext / auto` 로 A 와 **다른 cluster** 를 포함한 STANDARD 2~3편을 사람 입력 없이 release·배포·공개한다(production-shaped 검증).
- 그 뒤 launchd 자연 회차의 신규 글 B 가 release·배포·공개를 끝내야 M-AUTO 판정 근거가 된다.
- release 선택은 직전과 다른 cluster 를 우선한다.
- 완성 원고 여러 편을 미리 만드는 정책은 없다. 구조는 N 개 후보를 처리하되 `targetCandidates` 는 근거로 올린다
  (직전 release 들의 검증 첫 통과 · 전체 재생성 0 · 이미지 재시도 · 중복 0 · 잔존물 0 · watch 실패 0 · 비용 상한).
  올리는 것은 사람의 설정 변경이고, 기준이 하나라도 깨지면 기계가 1로 내린다.

#### 0.0B.7 legacy 동결 · 삭제 · rollback

**동결 (2026-11-09 창업자 결정)**

- legacy(`LEGACY_BRIEF_V1` · `DIRECT_SPEC_V1` · queue · register · 웹 UI 회수 · 격리 장부)는 **안전 긴급 수정 외에 기능·정책을 보정하지 않는다.**
  이유: 삭제할 코드를 다듬는 시간이 vNext 를 늦춘다.
- 🔴 기존 HOLD · 격리 · 초안 **바이트를 vNext 로 직접 승계하지 않는다.** 같은 intent 가 필요하면 현행 Bundle·정책으로 새 ContentPlan 을 컴파일해 새로 생성한다.
- vNext admission 의 중복 검사는 `articles.ts`(공개·예약 · canonical mapping · 정규화 제목)와 **legacy queue 신원 투영**(intentId · slug ·
  정규화 제목 · cluster)까지 본다. 이유: 동결 기간에도 legacy 는 돌며 같은 주제를 낼 수 있다. queue 는 읽기 전용 중복 오라클일 뿐이다 —
  콘텐츠 바이트 승계 0 · 쓰기 0 · 파일/앵커를 못 읽으면 fail-closed. 삭제 단계에서 adapter 도 함께 끈다(§0.0B.1).
- vNext 가 실제 쓰기를 시작할 때 legacy writer 는 rollout switch 로 배타 정지된다(§0.0B.5). 그 전까지 legacy 는 지금처럼 돈다.

**삭제** — 다음 **네 조건이 모두** 충족되면 **단일 삭제 단계**에서 legacy 활성 경로 · switch 분기 · `release: draft` 분기 · 전용 검사를 함께 지운다.
날짜 시한은 두지 않는다.

1. 운영 진입점에서 옛 모듈 도달 0 (import 그래프로 기계 확인)
2. vNext 신규 글의 무인 release·배포·공개 완료(자연 회차 B)
3. 다른 cluster 의 production-shaped 검증 완료
4. fixture · mutation · rollback 참조 0

- 옛 graph 판 파일은 위 네 조건과 함께 연구·제품 각 계층의 current·previous·rollback 소비처를 확인한 뒤에만 지운다.
- legacy queue 행과 초안은 승계하지 않으므로 삭제 단계에서 queue 파일과 함께 정리한다.
- rollback 단위: rollout switch `legacy`(분기 제거 전) → release PR revert → 글 1편 `status: 'BLOCKED'` → graph kill(graph watch) →
  계층별 previous(charter §18-B.3 — 신규 공급은 current 가 다시 맞을 때까지 HOLD). 분기 제거 뒤에는 Git revert.

#### 0.0B.8 구현 · 검사 게이트

- 단계 순서와 진행 위치는 milestone 이 정본이다.
- **완성 exact head 의 공통 PASS**: rollout switch 가 없거나 손상됐거나 `legacy` 일 때 legacy 회차 산출(run.json · handoff · PR 모양) 바이트 불변 ·
  `legacy` 에서 vNext 진입점 쓰기 0 · ContentPlan 해시에 날짜·provider·경로 0 · `typecheck` · `typecheck:ops` · `lint` · `build` · `check:tokens` ·
  `magazine:auto-check` · `check:m3a` · `check:magazine-graph` · `check:research-current` · `magazine:rehearsal`.
- 🔴 **S2 변이 하네스의 소유 (2026-11-12 S2 P1-10).** `check:magazine-plan-input-mutation` · `check:magazine-content-plan-mutation` 은
  `magazine:auto-check`(CI `visibility-guard.yml`) 체인 **끝**에서 돈다(실측 ≈ 76초 · ≈ 22초). 빠른 검사(`check:magazine-plan-input` ·
  `check:magazine-content-plan`)는 변이를 부르지 않는다. 체인에서 빠지면 경계 검사 R9 가 FAIL 한다(변이 VB79 · VB80 이 그 검출을 증명).
  이유: 체인 밖이면 겨냥 문자열이 바뀌어 변이 지점이 0곳이 되어도 아무도 모른다(2026-11-11 실측).
- **production-shaped rehearsal** (fake provider · 격리 저장소 · 녹화 evidence): 서로 다른 cluster 를 포함한 STANDARD 계획 여러 개에 다음을 주입한다 —
  이미지 실패 · 금지 패턴(면책 문장) · 메타 칸 · 의료 안내 누락 · 사실 오류 · 비용 상한 · 급사 후 재개(`nextPollAt`) · `SUBMISSION_UNKNOWN` ·
  회수 불능(404) · DELETE 실패 · ProviderPlan 의 금지 필드·PII · Bundle 해시 불일치 · 같은 slug 동시 실행 · same-release 순환·고립 묶음 ·
  Candidate 탈락 뒤 고정점 · PR 의 planHash 변조 · release CI 실패 · 날짜 놓침 · switch 손상 · Draft release · production build 에서 dev 시계 주입 시도.
- rehearsal PASS: 실패 Job 만 격리 · 나머지는 PR 하나에 서로 다른 날짜 · 이미지 실패 시 원고 재생성 0 · 같은 요청 키 재호출 0 ·
  `SUBMISSION_UNKNOWN` 즉시 재전송 0 · 최종 채택 원고 1개 · DELETE 재시도 후 확인 기록 · 금지 필드·PII 전송 0 · 변조 PR 병합 0 ·
  날짜를 놓쳐도 ContentPlan 해시 불변 · exact-head · 중복 0 · 잔존물 0 · Chrome/CDP 0 · 사람 입력 0 · vNext 진입점의 legacy 모듈 도달 0 ·
  Draft release 의 병합 0 · production 에서 시계 주입 무시.
- 공급 loop(보강·부족·상한)의 rehearsal 은 S9 에서 한다. 첫 글 경로의 gate 가 아니다.

#### 0.0B.9 실패 범위와 알림

| 실패 | 범위 | 동작 | 알림 |
|---|---|---|---|
| 원고·이미지·검증·수리 실패 · 재생성 1회 뒤에도 회수 불능 | 그 Job | HOLD · 다른 Job 계속 | 상태가 바뀔 때 1회 |
| `SUBMISSION_UNKNOWN` | 그 Job | 즉시 재전송 0 · 상한 있는 확인 뒤 회수 불능이면 재생성 1회 | 상태가 바뀔 때 1회 |
| ProviderPlan 금지 필드 · PII 탐지 | 그 Job | HOLD · 전송 0 | 1회 |
| DELETE 실패 | 그 Job | 진행 계속 · sweeper 재시도 · 404 는 완료 | 반복 실패일 때만 1회 |
| Bundle 판독 불가 · 해시 불일치 | 그 graphVersion | 그 판의 컴파일 0 | 1회 |
| 현재 control 판 불일치 · kill switch · graph 꺼짐 · queue 신원 판독 불가 | 그 graphVersion | admission 전체 HOLD · 컴파일·planHash 불변 | 상태가 바뀔 때 1회 |
| 출판 최소 미충족 | 그 intent | 컴파일하지 않음 · 공급 loop 보강 대상 | 없음(정상 상태) |
| EvidenceProvider 상한 · 429 | 그날 공급 loop | 중단 · 다음 회차 | 1회 |
| AUTH · 월 비용 상한 | 생성 전체 | 새 호출 0 · 검증된 후보 release 계속 | 1회 |
| release CI 실패 | 그 release | 후보를 검증됨으로 되돌림 | 1회 |
| 정상 대기(열린 release PR · 목표 도달) | — | 아무것도 안 함 | 없음 |

### 0.0 자동 병합이 확인하는 것

> 이 절과 §0.1 은 **legacy 자동 등록 PR** 의 현행 계약이다(동결). vNext release PR 의 merge gate 는 §0.0B.4 다.

| 확인 | 막는 것 |
|---|---|
| 브랜치 접두 | 사람 PR 을 자동 merge 하지 않는다 |
| **SHA 고정** | 검증 뒤 커밋이 붙으면 `SHA_DRIFTED` |
| 변경 파일 **모양** | `articles.ts` · `topic-queue.ts` · `drafts/{slug}/*` · `hero.webp` 밖이면 막는다 (소스·워크플로 변경 불가) |
| CI · check-runs | 하나라도 실패·진행 중이면 막는다 |
| **큐 등급 변경** | PR 이 큐 행의 `riskLevel`·`autoEligible` 을 바꾸면 `QUEUE_GRADE_CHANGED`. 등급 자체로 병합을 가르지 않는다(M3-A · `lib/magazine-merge-gate.mjs:62,286`) |
| 중복 slug | PR 안 · main 양쪽 |
| 예약일 | 10:30 KST 형태 · `publishedAt` 일치 · 중복 없음 |
| **과거 날짜** | `PUBLISH_AT_PAST` — merge 즉시 공개되는 것을 막는다 |

🔴 `--admin` 을 쓰지 않는다. 보호 규칙과 CI 를 우회하는 손잡이는 이 경로에 없다.

### 0.1 미해결 자동 PR 은 **한 번에 하나** (legacy·현행)

> vNext 는 열린 release PR 이 다음 release 만 기다리게 하고 생성은 막지 않는다(§0.0B.4). 이 절은 지금 운영 중인 경로의 동작이다.

🔴 **이전 PR 이 처리되기 전에는 다음 생산 회차가 HOLD 한다.**
무인 운영에서는 **같은 회차의 자동 병합이 그것을 푼다** — 01:00 등록 직후 merge 까지 간다.
자동 병합이 막힌 회차만 다음 날 HOLD 로 남고, 그때는 Slack 이 사유를 말한다.

왜 그런가 — 자동 PR 을 만든 뒤 runtime 은 main 으로 돌아온다. 그 main 의
`articles.ts` 에는 **그 등록이 아직 없다**(PR 안에만 있다). 그대로 다음 날 회차가 돌면

```
Day 1  autumn-low-mood 선정 → PR #A (OPEN) → main 복귀
Day 2  main 의 articles.ts 를 읽는다 → autumn-low-mood 가 없다
       → 같은 slug 를 또 선정하고, 빈 슬롯도 같은 날짜를 고른다 → PR #B
```

`register.mjs` 의 중복 가드는 **main 만** 보므로 이것을 막지 못한다.
그래서 producer 와 auto-register가 **시작 전에 같은 판정**을 본다
(`scripts/lib/magazine-outstanding.mjs`).

| 상태 | 판정 | 종료 코드 | 사람이 할 일 |
|---|---|---|---|
| OPEN 자동 PR 있음 | `OUTSTANDING_PR` · **HOLD** | 0 (정상) | 보통은 자동 병합이 같은 회차에 푼다. 막혔으면 사유를 본다 |
| CLOSED(미merge) + 브랜치 잔존 | `ABANDONED_PR_BRANCH` · **HOLD** | 0 (정상) | **브랜치를 지운다** = 명시적 폐기 |
| push 됐는데 PR 없음 | `ORPHAN_REMOTE_BRANCH` · 🔴 실패 | 1 | PR 을 열거나 브랜치를 지운다 |
| 로컬에만 남은 자동 브랜치 | `ORPHAN_LOCAL_BRANCH` · 🔴 실패 | 1 | 내용 확인 후 살리거나 지운다 |
| GitHub 을 못 읽음 | `GITHUB_QUERY_FAILED` · 🔴 실패 | 1 | 네트워크·gh 인증 확인 |
| 미해결 0건 | `CLEAR` | — | 없음 (그냥 진행) |

🔴 **merge 판정은 GitHub 의 PR state 가 정본이다.** commit ancestry 로 보지 않는다 —
squash merge 는 PR 커밋을 main 에 남기지 않아 merge 된 PR 이 영원히 "미해결" 로 남는다.

🔴 **모르면 멈춘다(fail closed).** GitHub 을 읽지 못하면 "미해결 없음" 이 아니라
"확정할 수 없음" 이다. 확정하지 못한 채 새 PR 을 만들면 중복을 막을 길이 없다.

---

## 1. 무엇이 고장나 있었나 (2026-09-03 ~ 09-15)

두 job 이 **12일간 한 번도 돌지 않았다.** 로그가 없으니 아무도 몰랐다.

### 근인 — TCC 가 plist 를 읽지 못한다

```
kernel [com.apple.sandbox.reporting:violation]
System Policy: smd(…) deny(1) file-read-data
/Users/…/Documents/soransoran/launchd/com.soransoran.magazine-producer.plist
```

옛 설치는 `~/Library/LaunchAgents` 에 `~/Documents` 를 가리키는 **symlink** 를 두었다.
macOS 의 Documents 접근 보호가 `smd` 의 plist 읽기를 거부한다 —
읽지 못하니 **서비스 등록 자체가 되지 않는다.**

같은 기계의 D100 job 4개는 `~/Library/LaunchAgents` 안의 **실제 파일**이라 정상이었다.

### 그 밖에 켰으면 사고가 났을 것들

| | 증상 |
|---|---|
| `gh` 가 launchd PATH 에 없음 | `add → commit → push → gh pr create` 순서라 **push 뒤에** gh 부재를 안다. PR 없는 브랜치가 origin 에 조용히 올라간다 |
| main 복귀 코드 없음 | 첫 성공 회차 뒤 저장소가 자동 브랜치에 남아 **다음 날부터 매일 `NOT_ON_MAIN`** |
| exit 0 고정 + Slack 발송 0 | 실패가 종료 코드에도 Slack 에도 안 남는다 |
| lock 없음 | 사람 수동 실행과 01:00 회차가 겹칠 수 있다 |
| `imageMode=REQUIRED` | 호출부가 `alt: null` 고정 → **구조적으로 언제나 BLOCKED** |
| 대상 저장소가 개발 작업트리 | 진단 시점 브랜치가 `fix/write-guest-start-flow` |

전부 이 PR 에서 고쳤다.

---

## 2. runtime worktree

```
/Users/yanadoo/Documents/soransoran-magazine-runtime
```

🔴 **개발 작업트리를 쓰지 않는다.** 그날 누가 브랜치를 바꿨는지에 따라 결과가 달라진다.
🔴 **D100 의 `soransoran-runtime` 과도 다르다.** 두 레인이 서로의 배포에 묶이지 않는다.
설치기가 `soransoran` · `soransoran-m0` · `soransoran-runtime` 을 명시적으로 거부한다.

만드는 법 (한 번):

```bash
git -C ~/Documents/soransoran worktree add ~/Documents/soransoran-magazine-runtime main
```

조건: 브랜치 `main` · 추적 변경 0건. 설치기가 확인한다.

---

## 3. 활성화 게이트 — supervised 1회 end-to-end 성공

🔴 **옛 "5일 관찰 후 허용" 조건은 경영 결정(2026-09-15)으로 폐기됐다.**

대신 **사람이 지켜보는 앞에서 `--write --pr` 이 1회 성공**해야 한다.
성공의 정의는 하나다 — **PR 이 실제로 열렸다.**

그 사실을 영수증으로 남긴다:

```
~/Library/Application Support/soransoran/magazine-supervised-run.json
{
  "result": "SUCCESS",
  "prUrl": "https://github.com/MogoKim/soransoran/pull/NNN",
  "ranAt": "2026-09-16T01:00:00+09:00"
}
```

영수증이 없거나 `result !== "SUCCESS"` 거나 PR URL 이 없으면
`magazine:launchd-install --apply` 가 **아무것도 설치하지 않고 멈춘다.**

### supervised 실행 중의 진행 규칙

🔴 **gate 가 통과하면 중간에 창업자에게 "계속할까요" 를 다시 묻지 않는다.**
producer → auto-register 검증까지 **이어서** 끝낸다. 매 단계 확인을 받으면
그 자체가 새로운 병목이 되고, 무엇을 승인한 것인지도 흐려진다.
판단이 필요한 자리는 이미 코드가 막는다 — gate · 관문 · preflight · 미해결 판정.

🔴 **예외는 하나다 — ChatGPT 전용 프로필 로그인이 실제로 필요할 때.**
`LOGIN_REQUIRED` · `CLOUDFLARE_BLOCKED` 처럼 사람이 화면에서 로그인해야만
풀리는 상태면, 그때만 창업자에게 화면을 넘긴다. 그 밖의 실패는 보고하고 멈춘다.

---

## 4. 설치

```bash
npm run magazine:launchd-check          # 판정 함수 회귀 (파일 변경 0)
npm run magazine:launchd-install        # 계획만 (변경 0)
npm run magazine:launchd-install -- --apply   # 🔴 실제 설치
```

설치기가 하는 일:

1. runtime worktree 확인 (존재 · main · 깨끗함 · 개발 트리 아님)
2. supervised 영수증 확인
3. `docs/operations/launchd/*.plist.template` 렌더 — placeholder 가 하나라도 남으면 중단
4. 기존 **symlink 를 보관소로 옮긴다** (지우지 않는다)
   → `~/Library/Application Support/soransoran/launchd-rollback/`
5. 실제 plist 파일을 `~/Library/LaunchAgents` 에 원자적으로 쓴다

🔴 **설치기는 `launchctl` 을 부르지 않는다.** 파일만 놓는다.

### 가동 (사람이 한다)

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.soransoran.magazine-producer.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.soransoran.magazine-auto-register.plist

# 등록됐는지 확인 — "Could not find service" 가 나오면 실패다
launchctl print gui/$(id -u)/com.soransoran.magazine-producer | head -20
launchctl print gui/$(id -u)/com.soransoran.magazine-auto-register | head -20
```

---

## 4.5 무인 운영 — 하루의 흐름

아래는 **지금 배포된 코드의 하루**다. `LEGACY` 는 운영 중인 경로이고, `DIRECT` 는 main 에 있는 현행 코드 경로다(운영 회차 0).
vNext(§0.0B)는 구현 전이며, 구현 뒤에는 rollout switch 가 `vnext` 일 때만 producer 입구가
`ContentPlan → Job → ManuscriptProvider·ImageProvider → 검증·부분 수리` 로, 날짜 배정이 release writer(§0.0B.4)로 바뀐다.
한 회차에서 두 경로를 섞지 않는다.

```
00:10 KST  producer        LEGACY: 동결 queue → brief(claude) → 원고 회수 → 관문 → 알림
                           DIRECT(현행 코드): SPEC_READY 선택 → ArticleSpec 검증 → 원고 회수 → 관문 → 알림
                           끝나면 _runs/{date}/producer-handoff.json 을 남긴다
01:00 KST  auto-register   ① producer 완료 신호·lock 을 최대 40분 기다린다 (재시도 없음)
                           ② 미해결 자동 PR 확인 → ③ 변환·QA·hero·batch-qa·register
                           ④ PR 생성 → ⑤ 자동 병합(--merge) → main
                           ⑥ merge SHA 의 Production 배포 확인 → 예약 글이 **아직 안 나왔는지**(404)
                           필수 CI 는 최대 30분 기다린다 · 명시적 실패는 즉시 중단 (병합 잠금 안에서)
02:00 KST  auto-merge-recovery  01:00 이 CI 시간 초과 등으로 못 끝낸 자동 PR 1건을 **같은 관문**으로
                           다시 본다(`--recover`) · 0건 no-op · 2건 이상 멈춤
                           01:00 병합이 아직 잠금을 쥐고 있으면 최대 90분 기다린다 → 풀리면 진행 ·
                           끝까지 잠겨 있으면 merge 0 · non-zero · Slack (성공·no-op 로 세지 않는다)
                           결과는 시도마다 _runs/{date}/auto-merge-recovery-<시각>-<pid>-<꼬리>.json
                           (01:00 의 auto-merge.json 도, 앞선 복구 결과도 덮지 않는다)
10:30 KST  (해당일)        publishAt 도달 → 예약 글이 공개된다
11:00 KST  magazine-watch  본문·대표 이미지·/magazine 목록 노출 확인 → 실패면 Slack
```

🔴 **02:00 복구는 새 관문이 아니다** (2026-10-09 #675 — 필수 CI 21분 7초 · 옛 상한 20분에서 시간 초과 ·
   CI 는 61초 뒤 성공했으나 PR 이 OPEN 으로 남았다). `runAutoMerge({ apply: true })` 를 그대로 다시 돈다 —
   재전송·재생성·재등록은 없다. 11:00 watch 는 계속 공개 확인 전용이고 merge 하지 않는다.

🔴 **01:00 의 확인과 11:00 의 확인은 서로 다른 것을 본다.**
   01:00 은 "**아직 안 나왔는가**"(404) — 예약이 지켜졌는지.
   11:00 은 "**이제 나왔는가**"(본문·이미지·목록 전부 200/노출) — 공개가 됐는지.
   앞의 것만 있으면, 글이 끝내 안 나온 사실을 제일 먼저 아는 사람이 **독자**가 된다.

🔴 **필수 검사는 `completed` + `success` 하나뿐이다.** `skipped`·`neutral` 은 인정하지 않는다 —
   워크플로에 경로 필터나 조건이 붙으면 검사는 돌지 않고 skipped 로 완료된다.
   그것을 통과로 세면 "필수 검사를 확인했다" 가 **한 번도 돌지 않은 검사**를 가리키게 된다.
   부수 검사의 skipped 는 그대로 둔다 — 막을 이유가 없고, 막으면 매 회차 시끄럽다.

🔴 **check-run 이 다 끝나도 합산 status 가 pending 이면 기다린다.** 두 값은 다른 곳에서 온다 —
   check-run 은 Actions 가, 합산은 Commit Status API 를 쓰는 것들(Vercel 등)이 올린다.
   `pending → success` 진행 · `failure`·`error` 실패 · `unknown`·조회 실패는
   **성공이 아니다**(계속 보다가 시간이 다하면 `CI_OBSERVE_TIMEOUT`).

🔴 **커밋 합산 status 를 배포 확인으로 쓰지 않는다.** 그것은 CI 판정에 쓰는 바로 그 값이라
   검사가 전부 초록이면 success 가 된다 — **운영 도메인이 아직 옛 빌드를 서빙해도 success 다.**
   대신 세 가지를 따로 본다.

   | 보는 것 | 어디서 |
   |---|---|
   | Production 배포가 **그 SHA 로** 있는가 | GitHub Deployments API (`?sha=&environment=Production`) |
   | 그 배포가 **READY 인가** | 그 deployment 의 status = `success` |
   | **운영 도메인이 그 배포를 서빙 중인가** | `soransoran.com` HTML 의 `dpl_<id>` 표식 |

   마지막 줄이 핵심이다. 앞의 둘만 보면 "배포는 됐는데 도메인은 구버전" 을 못 본다.
   Vercel 이 `next/image` URL 에 `dpl=dpl_<id>` 를 심고, 같은 id 가 그 커밋의 Vercel
   status `target_url` 끝에 들어간다 — 두 값을 맞추면 추측 없이 알 수 있다.
   🔴 표식을 못 읽으면 `PRODUCTION_UNVERIFIED` 로 **막는다** — 모르면 통과가 아니다.

   🔴 **GitHub 증거가 비면 Vercel 을 직접 본다** (2026-10-13 #701 — merge SHA 에 대해 GitHub
   Deployments 가 빈 배열·커밋 status 0건이었다. Vercel 에는 그 SHA 의 Production READY 배포가 있었고
   도메인이 서빙 중이었는데 결과는 `MERGED_UNVERIFIED`).
   GitHub 증거가 완전하면(배포 · success · 같은 SHA · `dpl_` id) Vercel 호출은 0 이다.
   없거나 불완전할 때만 `vercel inspect soransoran.com` → `vercel api /v13/deployments/<그 id>` 순서로 보고,
   `gitSource.sha` = merge SHA · `target` = production · `readyState` = READY · 두 id 일치가 **모두** 참일
   때만 인정한다. 최신 배포·HTTP 200 은 증거가 아니다. 결과의 `deploy.evidenceSource` 에
   `github-deployments` / `vercel-direct` 를 남긴다. 판정 기준(위 표)은 그대로다.
   🔴 **GitHub 의 명시적 결론은 덮지 않는다** — deployment state 가 failure·error 이거나 다른 SHA 를
   명시하면 Vercel 을 부르지 않고 그대로 실패·충돌로 끝낸다. fallback 은 배포 없음·조회 실패·
   pending/queued/in_progress/null·success 인데 배포 id 없음일 때만.
   🔴 Vercel 직접 확인은 **이미 로그인된 CLI 자격**(launchd 의 HOME)으로 읽기 두 번만 한다 —
   새 토큰·env·plist 0 · redeploy/promote/alias/rollback 0 · CLI 원문·자격은 결과·로그에 남기지 않는다.
   실행 파일은 `SORAN_MAGAZINE_VERCEL_BIN` → 지금 node 옆(`dirname(process.execPath)/vercel`) → PATH
   순서로 **실행 가능한 것**만 고른다. 없으면 `VERCEL_UNAVAILABLE` (`scripts/lib/magazine-deploy-evidence.mjs`).

🔴 **404 만이 "안 나갔다" 를 확인한 것이다.** 500·인증 리다이렉트·네트워크 실패는
   비공개 확인이 아니라 **확인 실패**다 — 즉 배포가 망가진 날 자동 병합이
   가장 자신 있게 초록을 보고하는 일을 만들지 않는다.

🔴 **magazine-watch 는 고치지 않는다.** 재배포도 재시도도 없다. 알리고 non-zero 로 끝난다.

🔴 **producer 가 실패해도 등록은 진행한다.** 이미 준비된 후보로 돈다 — 공급이 목적이다.
🔴 **막힌 후보는 격리된다.** 2회 연속 QA 에 막히면 7일간 비켜 주고 **다음 후보가 진행**한다.
   원고를 고치면(파일이 바뀌면) 냉각을 기다리지 않고 즉시 다시 후보가 된다.
   legacy runner 는 원고를 고치지 않고 비켜 준다(현행 동작). vNext 의 수리는 §0.0B.3 이다.
🔴 legacy runner 의 생성 경로(현행 동작): brief 는 claude CLI(구독), 원고·이미지는 ChatGPT 웹 UI. vNext 의 생성 경로는 §0.0B.2 이다.
🔴 생성 경로의 제한(로그인 만료·Cloudflare·한도·provider 장애)은 **숨기지 않고 그대로 실패로 낸다.** 우회하지 않는다.

## 5. 감시

### producer 종료 코드의 뜻

🔴 옛 판은 brief·원고 회수 실패를 **삼키고** plan 의 코드만 돌려줬다.
ChatGPT 로그인이 만료돼 원고를 한 건도 못 받아도 `exit 0` 이었다.
지금은 `launchctl` 의 last exit status 만 봐도 구분된다.

| 코드 | 판정 | 뜻 |
|---|---|---|
| 0 | `OK` | 정상 |
| 0 | `CONTENT` | 일부 slug 가 brief 게이트에 막혔다 — **정상이다**. 관문이 일한 것 |
| 0 | `HOLD` | 미해결 자동 PR 을 기다리는 중 — **정상이다** |
| 1 | `SYSTEM` | plan 실패 · claude 부재 · **ChatGPT 접근 실패 · 브라우저 시작 실패** · 회수기 전역 실패 |

🔴 Slack 은 판정을 바꾸지 않는다 — 양방향으로. 알림이 실패해도 원래 실패는 실패이고,
실패 회차에서도 알림은 **반드시 시도한다**.

### 알림 계약 — 종료 경로는 하나다

🔴 non-dry-run producer 의 **모든** 종료 경로가 단일 finalizer 를 지난다
(`scripts/lib/magazine-producer-flow.mjs`). 알림은 거기 한 곳에만 있고 **회차당 정확히 한 번** 돈다.

| 중단 사유 | exit | Slack | write·AI |
|---|---|---|---|
| `TOOL_MISSING` (claude·gh 부재) | 1 | ✅ 1회 | 0 |
| `NOT_ON_MAIN` · `DIRTY_TREE` | 1 | ✅ 1회 | 0 |
| `OUTSTANDING_PR` (HOLD) | 0 | ✅ 1회 — **PR 번호·URL 포함** | 0 |
| `ORPHAN_*` · `GITHUB_QUERY_FAILED` | 1 | ✅ 1회 | 0 |
| plan·brief·fetch 실패 | 1 | ✅ 1회 | 실행된 단계까지 |
| 정상 | 0 | ✅ 1회 | 전부 |

🔴 **알림을 보내려고 파일을 쓰거나 AI 를 부르지 않는다.** 중단 경로에서는
`plan`·`brief`·`fetch` 를 **한 번도 호출하지 않는다** — 회귀가 호출 횟수로 증명한다.

🔴 **HOLD 알림에는 PR 번호와 URL 이 반드시 들어간다.**
로그에만 있고 Slack 에 없으면 창업자는 무엇을 merge 해야 하는지 모른 채
"또 HOLD 네" 만 보게 된다. auto-register 의 HOLD 알림도 같은 PR 을 지목한다.

🔴 **dry-run 은 실제로 보내지 않는다.**

> **2026-09-16 에 배운 것** — 직전 판은 이 계약을 문서와 주석에 적어 두고도
> 두 경로가 `process.exit(1)` 로 빠져나가 실제로는 성립하지 않았다.
> 회귀는 있었지만 **소스에서 `runNotify()` 의 위치만** 봤다. 위치는 도달 여부를 보지 못한다.
> 지금 회귀는 주입한 흐름을 **실제로 돌려** 호출 횟수와 종료 코드를 본다.

| 무엇 | 어디 |
|---|---|
| producer 로그 | `~/Library/Logs/soransoran/magazine-producer.log` |
| auto-register 로그 | `~/Library/Logs/soransoran/magazine-auto-register.log` |
| write 회차 리포트 | `drafts/magazine/_runs/{date}/auto-register.json` (runtime 안) |
| Slack | write 회차는 **성공도 실패도** 보낸다 (`#소란소란-알림`) |
| launchd 종료 코드 | write 회차 실패는 non-zero 로 남는다 |

🔴 로그에 반드시 남는 것: PR URL · 처리 slug · 막힌 단계 이름 · 남은 브랜치.

### 매일 30초 점검

```bash
launchctl print gui/$(id -u)/com.soransoran.magazine-auto-register | grep -E 'last exit|runs'
tail -40 ~/Library/Logs/soransoran/magazine-auto-register.log
```

---

## 6. 상태도 — 성공 · 실패 · 복귀

```
01:00 회차 시작
  │
  ├─ lock 잡기 ────────── 실패(LOCK_HELD/STUCK/CORRUPT) ─→ exit 1 · main 복귀 안 함(남의 회차)
  │                                                        🔴 재시도하지 않는다
  ├─ writePreflight
  │    ├ 도구(git·gh·node·claude) ─ 없음 ─→ TOOL_MISSING ─┐
  │    ├ gh 인증 ──────────────── 실패 ─→ GH_AUTH_FAILED ─┤
  │    ├ git(main·clean·ff-only) ─ 실패 ─→ NOT_ON_MAIN 등 ─┤→ 🔴 파일 변경 0 · main 복귀 · exit 1
  │    └ push 자격(--dry-run) ──── 실패 ─→ PUSH_NOT_READY ─┘
  │
  ├─ PR 브랜치 생성 ───── 실패 ─→ BRANCH_CREATE_FAILED ─→ 파일 변경 0 · main 복귀 · exit 1
  │
  ├─ slug 별 drive()  gate → 회수 → 변환 → QA → hero → batch-qa → register write
  │      (막히면 그 slug 만 BLOCKED. 다른 slug 는 계속 간다)
  │
  ├─ finishPr  stage(명시) → stageCheck → commit → push → gh pr create
  │      ├ stageCheck 실패 ─→ restore --staged · commit 안 함 · pushed:false
  │      ├ push 실패 ───────→ pushed:false
  │      └ PR 실패 ────────→ 🔴 pushed:true 를 남긴다 ("브랜치는 origin 에 있다")
  │
  └─ finish
       ├ main 복귀 시도
       │   ├ 깨끗함 ─→ switch main ─→ RETURNED (작업 브랜치는 남긴다)
       │   └ 미커밋 변경 ─→ 🔴 RETURN_DIRTY — 아무것도 지우지 않고 BLOCKED
       ├ lock 해제
       ├ Slack 발송 (write 회차는 성공도 알린다)
       └ exit  BLOCKED 있으면 non-zero
```

### 복구 가능한 실패의 처리

| 상황 | 자동화가 하는 것 | 사람이 하는 것 |
|---|---|---|
| push 성공 · PR 실패 | 브랜치명 로그·Slack 에 남기고 **main 복귀** | GitHub 에서 그 브랜치로 PR 을 연다 |
| 미커밋 변경으로 복귀 실패 | 🔴 **아무것도 지우지 않는다.** BLOCKED + 복구 방법 | `git -C <runtime> status` 로 확인 후 판단 |
| 살아 있는 lock | 그 회차 건너뜀 | 없음 (다음 회차가 정상 진행) |
| 45분 이상 붙잡힌 lock | `LOCK_STUCK` 으로 멈춤 | 프로세스 확인 후 lock 파일 제거 |

🔴 **어떤 경우에도 `reset --hard` · `switch -f` · `branch -D` 를 쓰지 않는다.**

---

## 7. 롤백

```bash
# ① 가동 중지
launchctl bootout gui/$(id -u)/com.soransoran.magazine-auto-register
launchctl bootout gui/$(id -u)/com.soransoran.magazine-producer

# ② 파일 제거 — 🔴 bootout 만으로는 로그인 때 다시 등록된다
rm ~/Library/LaunchAgents/com.soransoran.magazine-auto-register.plist
rm ~/Library/LaunchAgents/com.soransoran.magazine-producer.plist

# ③ 확인 — "Could not find service" 가 정상이다
launchctl print gui/$(id -u)/com.soransoran.magazine-auto-register
```

옛 symlink 로 되돌려야 한다면 보관소에 있다:
`~/Library/Application Support/soransoran/launchd-rollback/`
🔴 다만 그 symlink 는 TCC 때문에 **애초에 동작하지 않는다.** 되돌릴 이유는 없다.

### 자동 PR 만 끄고 싶다면

템플릿의 `ProgramArguments` 에서 `--write` · `--pr` 두 줄을 빼고 다시 설치한다.
그러면 dry-run 리포트만 나간다 (파일 변경 0 · Slack 발송 0).

---

## 8. 회귀 테스트

```bash
npm run magazine:auto-check       # 자동 레인 게이트 · 관문 · git lifecycle (node)
npm run magazine:launchd-check    # 설치기 판정 · 템플릿 렌더 (tsx)
```

🔴 **clean checkout 에서 0 FAIL 이어야 한다.**
옛 테스트는 커밋된 적 없는 원고 3건에 의존해 CI 에서 언제나 1 FAIL 이었다.
지금 표본은 `scripts/__fixtures__/magazine/` 에 추적돼 있다.

---

## 9. 알려진 것

- `drafts/magazine/after-holiday-body-ache/draft.md` 에는 ChatGPT 인용 마커가 **아직 남아 있다.**
  `dea1c7a` (#299) 가 `articles.ts` 본문만 고쳤다. 관문은 이것을 정상적으로 막는다 —
  회귀 테스트가 "여전히 막힌다" 를 시험한다. 원본 정리는 별건이다.
- 자동 레인은 `imageMode` 와 무관하게 hero 를 요구한다(`scripts/magazine-auto-register.mjs:1253` `--require-hero` · `scripts/magazine-batch-qa.mjs:274`). hero 유지는 charter §12.
- 등록·병합은 위험 등급으로 막지 않는다 — `AUTO_RISK`·`MERGE_RISK` 는 M3-A 에서 제거됐다(`scripts/magazine-register.mjs:49` · `scripts/lib/magazine-merge-gate.mjs:62`). 위험은 검증 강도로 다룬다(charter §3-B).
