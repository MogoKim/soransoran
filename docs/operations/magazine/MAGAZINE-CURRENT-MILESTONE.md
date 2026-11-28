# Magazine current milestone

기준 시각: 2026-11-26 12:51 KST (관측 시각 — 아래 표의 값은 이 시각 또는 표에 적은 시각에 본 것이다)
상위 정본: `M-GRAPH-PROJECT-CHARTER.md`(독자·목적·관계·편집 판단·품질 기준) · `magazine-automation-runbook.md`(실행·provider·rollout·release·공개·복구)

이 문서는 소란소란 매거진의 **현재 상태와 지금 critical path**만 관리한다. 정책은 위 두 문서에만 있고 여기에 복제하지 않는다.
목적은 글 수가 아니라, 검색으로 들어온 독자가 유용한 답을 얻고 필요하면 더 읽고 커뮤니티의 실제 대화로 가서
7일 안에 다른 날 다시 와 글·댓글을 남기는 것이다(North Star 정의는 `NORTH-STAR.md` 그대로 · 독자 범위와 편집 판단은 charter §3-C).
우선순위는 **OUTCOME → M-GRAPH → M-AUTO → 신뢰성 장치**다.

🔴 **이 문서의 값은 관측한 시각의 사실이다.** 다시 쓰기 전에 git · runtime pin · `launchctl` · 공개 화면으로 다시 읽는다.
코드가 main 에 있다는 것, 실행 계획이 돌았다는 것, 자연 회차가 사람 손 없이 공개까지 갔다는 것은 서로 다른 사실이며 아래에서 따로 적는다.

## 1. 한눈에 — 2026-11-26

| 구분 | 사실 |
|---|---|
| 코드 | vNext 세로 경로의 코드가 main 에 있다 |
| 실행 계획 | 회사 Mac 에서 실제 launcher 명령이 후보 1건을 고르고 종료 0 으로 끝났다 — **계획만**(유료 생성 꺼짐) |
| 공개 | vNext 경로로 만든 첫 글(#900)이 2026-11-26 10:30 뒤 공개됐다 |
| 자연 무인 공개 | 🔴 **아직 없다.** 다음 주제를 고르는 일부터 공개까지 사람 손이 빠지는지는 입증되지 않았다 |
| 독자 결과 | 🔴 **입증되지 않았다.** 7일 안에 다시 와서 쓴 실사용자로 이어졌는지 잴 수단이 아직 없다 |

## 2. 현재 상태 (관측)

| 항목 | 사실 | 본 시각 · 증거 |
|---|---|---|
| 관측한 운영 배포 | `2434214a` · [#904](https://github.com/MogoKim/soransoran/pull/904) 병합본 | 11-26 12:50 · 운영 도메인의 READY 배포와 Git SHA 대조 |
| 회사 Mac 매거진 runtime | `4c5c7eaa`. 오전에 생산기 수정판 `8475532b`를 반영한 뒤 그래프 감시기 관련 세 파일만 fast-forward했다. 미추적 파일 173개의 지문이 동일했다 | 11-26 12:47 · 회사 Mac HEAD와 변경 경로 대조 |
| rollout · 유료 생성 | 실효 경로 vNext · release `draft` · 유료 생성 스위치 **OFF** → 생산기 결과 `PLAN_ONLY` | 11-26 · launcher 재현 |
| 00:10 회차 (11-26) | 옛 runtime 에서 `VNEXT_NOT_IMPLEMENTED` 로 끝났다(launchd 종료 1 · 알림 없음). runtime 을 올린 뒤 같은 명령은 종료 0 · 후보 `I-T3-47` 선택 · provider 호출 0 | 11-26 오전 |
| 다음 회차 | 설정이 그대로면 11-27 00:10 도 **계획만** 돈다 | — |
| 공개 글 | 사이트맵 상세 **58편** | 11-26 10:47 |
| 차단 전 관련 글 영역 | 연구한 관계를 쓰는 글(GRAPH) **21편** · 대체 추천(FALLBACK) **37편** · 방향별 링크 182개 · 이 영역에서 들어오는 링크가 0 인 글 17편 · 사이트맵 밖을 가리키는 링크 0 | 11-26 10:47 · 공개 HTML 전수 |
| 지금 고를 수 있는 후보 | **2건** — `I-T3-47`(family) · `I-T6-11`(money-work). 연구 질문 167개와 별개로 현재 생산 계획이 실제로 고를 수 있는 수다 | 11-26 · 계획 조회 |
| 첫 vNext 공개 | [`resume-age-career-gap`](https://soransoran.com/magazine/resume-age-career-gap) — [#900](https://github.com/MogoKim/soransoran/pull/900). 상세·목록·사이트맵에서 확인했다. 창업자가 이 글을 채택했다(A commissioning — runbook §0.0B.6) | 11-26 10:30 뒤 |
| 차단 전 그 글의 추천 | 나가는 추천 3개 가운데 2개 대상이 이 글로 되돌아온다. 글 끝 커뮤니티 안내는 게시판 첫 화면으로 간다 | 11-26 10:47 공개 HTML |
| 11:05 그래프 감시 | 회사 Mac의 57편 목록에 없는 동일한 공개 글(#900)로 향하는 링크 10개를 미공개 누출로 판정했다. 11:06 환경변수 설정·재배포와 로컬 control 기록 후 영구 차단 PR은 작업판 변경 때문에 실패했다. 상세·목록·사이트맵에 글이 있고 당시 상세 추천은 `FALLBACK / DISABLED`였다 | 11-26 · graph-watch 로그와 11:26 운영 응답 |
| 차단 후 관련 글 영역 | 58편 모두 FALLBACK. 상세 canonical 58건 일치, 추천 174개 중 사이트맵 밖 0개. 기존 글 11편이 이력서 글을 추천한다 | 11-26 11:40 · 운영 사이트맵 전체 상세 HTML |
| 복구 후 관련 글 영역 | 연구 기반 추천 21편·기본 추천 37편, 추천 182개. 상세 canonical 불일치와 사이트맵 밖 링크 모두 0개. 이력서 글이 연구 기반 추천 3개를 표시한다. 회사 Mac의 수정된 감시기도 58편 전수 확인·관측 0건·종료 0 | 11-26 12:50 · 공개 HTML과 읽기 전용 감시 결과 |
| 비용 | 상한은 runbook §0.0B.2 그대로. 11-25 첫 실제 원고·이미지 각 1회 · 수리 0 — 사용량 환산 약 $0.019(한 편의 표본이며 평균이 아니다) | 11-25 · 저장소 밖 보고 |
| legacy 큐 | 동결. 11-24 후보 10건은 전송 결과 불명 8 · QA 실패 뒤 재생성 보류 2 로 **보존**한다. vNext 로 승계하지 않는다(runbook §0.0B.7) | 11-24 |
| 생산 키 접근 | 🔴 무인(비대화형) 접근은 검증되지 않았다 — 유료 생성을 켜기 전에 확인할 것 | 11-26 |
| D100 경계 | 11-26 · 11-27 은 보조 호스트와 그 runtime·launchd · 품질 지문 32개 파일 · 커뮤니티 밤 작업 파일을 **동결**한다. 매거진 전용 변경은 이 범위를 건드리지 않는다 | 11-26 |
| 상시 호스트 | 매거진 레인은 회사 Mac 에 있다. 보조 Mac 이관(S10)은 자연 무인 공개와 장애 알림 실수신 뒤의 일이다 | — |

저장소 밖 증거(정본 아님 · 당시 관측 원본): `~/Documents/soransoran-work/2026-11-26/MAGAZINE-CODEX-REPORT.md` 와 같은 폴더의 실측 JSON.
[#900 CI 실행 기록](https://github.com/MogoKim/soransoran/actions/runs/45544590138)(24분 12초 — 한 사례).

### 축별 판정

| 축 | 판정 | 근거 |
|---|---|---|
| **M-GRAPH** | **PARTIAL** | 연구 기반 추천 복구(21편 GRAPH · 37편 FALLBACK). 오전 전수 관측에서 추천 영역 유입 0인 글 17편 · 새 질문을 찾아 후보로 채우는 공급 loop 미자동(후보 2건) |
| **M-AUTO** | **PARTIAL** | vNext 경로의 첫 글 공개 · 유료 생성 OFF 라 자연 회차는 계획만 · 무인 자연 공개 0 · 장애 알림 미구현 · `OPERATING_PASS` 아님 |
| **OUTCOME** | **NOT PROVEN** | 7일 재방문 참여로의 전환 미입증 · 검색 첫 화면 점유와 AI 답변 인용도 미입증 · 매거진 귀속 측정 수단 없음(OPEN ITEM) |

## 3. 지금 할 일

11-27 11:05 KST에는 회사 Mac의 예약 감시가 운영 도메인의 배포를 확인하고 정상 종료했는지 로그에서 본다. 11-26 복구 직후 같은 감시기로 읽기 전용 전수 검사를 완료했다.

편집 판단은 charter §3-C 다 — 발행 편수는 목표가 아니며, 아래 순서는 독자가 막힌 곳과 운영이 조용히 실패하는 곳을 먼저 본다.

| 순서 | 할 일 | 끝났다고 말할 조건 |
|---|---|---|
| 1 | 공개된 이력서 글에서 검색·추천·커뮤니티 이동의 기준선을 잡고, 독자가 답을 적용하거나 대화를 찾을 때의 첫 마찰 한 곳을 특정한다 | 같은 기간의 노출·클릭 · 글별 커뮤니티 이동 · 가입·글·댓글 집계를 대조했다. 이동 기록이 0건이면 수집이 정상인지부터 봤다 |
| 2 | 회사 Mac 의 생산 키 무인 접근 · 유료 생성 설정 · 조용한 실패 감지를 검증한다 | 사람 입력 없이 키를 읽는다 · 계획만 돈 회차와 실패한 회차를 로그 밖에서 구별할 수 있다(runbook §5) |
| 3 | 유료 생성을 켠 자연 회차 1회 — 00:10 생산 → 01:00 등록 → 공개 | 사람 손 0 으로 release·배포·공개. 조건이 채워지면 가장 빠른 후속 공개는 11-28 10:30 이다(목표이며 약속이 아니다) |
| 4 | 기존 재고 밖의 실제 질문 하나가 조사·근거·관계 검증을 거쳐 후보로 채워지는지 본다 | 후보가 2건에서 실제로 늘었다 — 못 채우면 키를 연결해도 며칠 안에 다시 멈춘다 |
| 5 | 추천 영역 유입 0 인 17편의 질문과 기존 유입을 대조한다. 첫 대상은 경력 재시작 묶음이다 | 관련 글을 늘리기 전에 어느 연결이 독자에게 유용한지 근거를 적었다 |

- 유입은 있는데 대화로 이어지지 않으면 글 끝 안내와 목적지를 먼저 본다. 이동 클릭만 늘고 실제 참여가 늘지 않으면 같은 안내를 전면 확대하지 않는다.
- 표본이 작으면 편성의 승자를 정하지 않는다.

## 4. Critical path — 의존 순서

날짜가 아니라 앞 단계의 PASS 가 다음 단계를 연다. 계약은 runbook §0.0B, 관계·공급 정책은 charter §18-B 다.
**진행 위치: S6(A) 의 글이 공개됐다 → 다음은 S7.** S0~S5 의 산출 코드는 main 에 있다. 단계별 PASS 증거를 이 문서가 다시 판정하지 않는다 —
각 단계의 검사와 PR 기록이 증거다.

| 단계 | 내용 | PASS | STOP | rollback |
|---|---|---|---|---|
| S0 | 권위 문서 재동결(charter · runbook · 이 문서) | `master:doc-check` · Codex 재검토 | 창업자 결정 필요한 정책 충돌 | revert |
| S1 | 공용 코어 — QA core 추출 · 공용 상수 · WebP 판독 · 엄격 control 판독 · relation-policy 출판 최소/표시 목표 분리 · 미등록 검사 방지 | legacy 회차 산출 바이트 불변 · `magazine:auto-check` · `check:m3a` | 바이트 차이 | PR revert |
| S2 | ContentPlanInputBundle 엄격 투영 export + 정적 compiler + 동적 admission(control · 중복 — legacy queue 는 신원 투영만 · same-release) · ProviderPlan 투영 · PII scan (계약 charter §18-B.1 · runbook §0.0B.1). 현재 배포판 `g-20261102-427d4d` 의 최초 Bundle 은 **1회 bootstrap 변경**으로 추가한다(조건 정본 charter §18-B.5) | 결정적 planHash · 날짜·provider·control·slug 0 · admission 통과 STANDARD 후보 ≥1 · bootstrap 은 해시·신원 정확 일치 · graph 바이트 변경 0 | 후보 0 → S9 를 앞당긴다 · bootstrap mismatch → 쓰기 0 | revert |
| S3 | release 경로 — `articles.ts` 전용 writer · vNext merge gate(planHash 재컴파일) · `feat/magazine-release-*` | 격리 저장소에서 Draft·auto PR 각 1 · 변조 반례 차단 · legacy PR 판정 회귀 0 | 회귀 | revert |
| S4 | Job · fake provider · 검증·부분 수리 · hero · vnext 위임 · dev 전용 시계 · production-shaped rehearsal | runbook §0.0B.8 전 항목 | 하나라도 FAIL | switch `legacy` |
| S4′ (S1 뒤 병렬) | 띠배너(`next/image`) · hero 비율 · 진단 이벤트 · 제품 전체 North Star 하한 계측(Prisma 변경 0) | 글자 크기 3단계 · 767px · 52px · 토큰 · 기존 글 렌더 회귀 0 | 회귀 | revert |
| S5 | provider canary — 창업자가 별도 project·최소 권한 키 발급 · 모델 블라인드 비교 · `store` 실효값 · DELETE·404 · background + structured output · 이미지 16:9 | 상한 안 · 계약 일치 | `DESIGN_CONTRACT_CONFLICT` | 호출 중지 · 키 폐기 |
| **S6 ← 글 공개됨** | **A commissioning** — 같은 자동 경로를 `vnext / draft / 1` 로 · 마지막 병합만 창업자 | 사람 원고 수정 0 · 병합·공개·watch | 아니오 → 시스템 수정 · 같은 plan 재생성 | PR close · switch `legacy` |
| **S7 ← 다음** | 다른 cluster 포함 STANDARD 2~3편 (`vnext / auto`) | 사람 입력 0 · 첫 통과 · 중복 0 · 잔존물 0 · watch 실패 0 · 비용 상한 | 기준 위반 | `targetCandidates` 1 · switch `legacy` |
| S8 | 자연 무인 회차 B → legacy 단일 삭제 단계 | B 공개 · 삭제 네 조건(runbook §0.0B.7) | 조건 미충족 | 삭제 전 switch · 삭제 뒤 git revert |
| S9 (S8 과 병렬 착수) | 지속 공급 — graph 승격 lane · Evidence 공급 loop | 출판 최소 후보가 마르지 않는다 | 수율 0 | graph previous |
| S10 | 매거진 레인을 보조 Mac 단독 owner 로 | 보조 Mac 자연 회차 1회 · 회사 Mac 매거진 job 0 · 레인 단위 owner 표식 | 이중 owner 흔적 | 역순 복귀 |

- 7 · 30 · 90일은 **관찰 창**이다(7일 공급 연속 · 30일 품질 지표 · 90일 North Star 하한 추이). 배포·삭제·이관의 gate 가 아니다.
- 🔴 S8 의 네 조건이 채워지기 전에는 옛 생산기 · 큐 · 실험 파일 · 이력 문서를 지우지 않는다(runbook §11).
- 독자 실험(§3 의 1·5)은 S7~S10 을 기다리지 않는다. 문서 정리도 이 경로를 늦추지 않는다.

## 5. OPEN ITEM — 블로커 아님

- **매거진 귀속** — 사람 단위 first-touch 최소 설계가 필요하다(charter §18-B.8). Prisma 변경은 별도 결정 전 0.
- **vNext 장애 알림** — 정상은 조용히, 복구가 필요한 장애만. 현재 vNext 회차에는 발송이 없다(runbook §5).
- **30대 독자 반영** — 질문·이미지 기준은 생성 지시와 검증 코드를 함께 바꾸는 별도 변경이다(charter §3-C).
- **같은 주소의 사실 갱신 · 같은 날 두 번째 신규 발행 · 낮 시간 등록** — 현재 release 는 다음 날 이후 빈 날짜의 10:30 만 배정한다. 필요가 확인될 때 구현한다.
- **graph 승격 lane 자동화 범위** — 정책·영토 확대는 사람, 승인된 current 의 결정적 promote 는 자동 lane 후보(charter §18-B.5).
- **CONTROLLED validator** — 주장↔출처 대조 코드가 없어 CONTROLLED 출판 0(charter §18-B.6 · §12).
- **매거진 레인 이관 절차** — `ALWAYS-ON-HOST.md` 의 레인 단위 owner 계약과 맞춘다(S10).

## 6. 판정 경계

- M-AUTO 판정 근거와 A 의 위치는 runbook §0.0B.6, legacy 삭제 조건은 runbook §0.0B.7 이 정본이다.
- 한 글 공개 · PR·CI·rehearsal 한 번 통과를 전체 완료로 부르지 않는다. A 의 공개는 M-AUTO `OPERATING_PASS` 가 아니다.
- 신규 0편인 날은 실패가 아니다. 약속한 회차가 오류로 0건이면 장애다(charter §3-C).

---

## 당시 관측 — 지금의 사실이 아니다

- **2026-11-09 13:40 KST** — origin/main 과 runtime 이 `a5507b76` · rollout 파일 없음(실효 legacy) · "vNext 세로 경로 코드 없음" ·
  자연 회차 11-03 ~ 11-09 7회 연속 등록 0 · 공개 57편 · 예약 재고 0 · 새 출판 최소 기준 후보 근사 4건.
  그날의 표 전체는 [기준 커밋의 원문](https://github.com/MogoKim/soransoran/blob/20a0443b610aae331857d096db5df3252d5fe24d/docs/operations/magazine/MAGAZINE-CURRENT-MILESTONE.md?plain=1#L21-L46)에 있다.

## 대체 기록

- 2026-11-26: 11-09 판의 "현재 상태"(실효 legacy · vNext 코드 없음)와 "S0 ← 현재" 를 위 관측으로 대체했다. S0~S10 의 정의는 그대로다.
- 2026-11-09: 11-03 판의 "다음 즉시 작업 ①A" · ①A~⑦ 로컬 자식 커밋 순서 · "3+1 기준 공급 0 → 공급 loop 가 A 보다 먼저" 판정을
  S0~S10 으로 대체했다.
- 2026-11-03: 2026-10-16 plan-first 48~72시간 commissioning 판을 대체했다.
- 옛 전문은 Git 이력(이 문서를 바꾼 각 변경의 parent)에서 볼 수 있다.
