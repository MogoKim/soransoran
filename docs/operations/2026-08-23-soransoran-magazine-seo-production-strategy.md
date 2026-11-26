# 소란소란 매거진 성장 운영 전략서

> 📜 **이 주소는 안내만 남긴 이력이다 (2026-11-26). 현행 정책은 아래 연결된 정본에서 확인한다.**
>
> 2026-08-23 에 쓰고 2026-08-30 까지 덧붙인 매거진 운영 전략서다. 한때 "매거진 운영의 정본"이었지만,
> 그 안의 생산 시각 · 재고 목표 · 위험 등급별 승인 흐름은 지금 경로와 다르다. 실제 근거가 있는 조항만 아래 표의 정본으로 옮겼다.
> 이 파일에 정책 본문을 다시 적지 않는다.
>
> - **원문(고정)**: [`20a0443b` 의 이 문서 전문](https://github.com/MogoKim/soransoran/blob/20a0443b610aae331857d096db5df3252d5fe24d/docs/operations/2026-08-23-soransoran-magazine-seo-production-strategy.md?plain=1) — 아래 § 번호와 줄 번호는 이 원문의 것이다.
> - **지금의 정본**: [`M-GRAPH-PROJECT-CHARTER.md`](./M-GRAPH-PROJECT-CHARTER.md) · [`magazine-automation-runbook.md`](./magazine-automation-runbook.md) · [`magazine/MAGAZINE-CURRENT-MILESTONE.md`](./magazine/MAGAZINE-CURRENT-MILESTONE.md)
> - 운영 문서 전체의 지도는 [`README.md`](./README.md) 다.

## 조항별 행선지

| 원문 | 내용 | 지금 |
|---|---|---|
| §1 · §2 | 매거진은 SEO 블로그가 아니라 커뮤니티 성장 엔진이다 · 페이지 수와 색인 수는 성과가 아니다 | North Star 는 [`NORTH-STAR.md`](./NORTH-STAR.md) · 매거진의 참여 목표는 charter §3-C · 금지는 charter §4 |
| §3 원칙 1·5·6 · §4 의 10:30 · §6 전체 | 제작과 공개의 분리 · `status`·`publishAt` 공개 판정 · 필드가 없는 과거 레코드 · 미래 글을 숨기는 다섯 곳 · 판정 드리프트 감지 · 10:30 공개 기본값 | runbook §10 ([원문 L191-L285](https://github.com/MogoKim/soransoran/blob/20a0443b610aae331857d096db5df3252d5fe24d/docs/operations/2026-08-23-soransoran-magazine-seo-production-strategy.md?plain=1#L191-L285)) |
| §3 원칙 7 · §9 | Search Console·Naver 제출 게이트(4개 AND) · 예약 공개와 맞물리는 색인 안전 | [`2026-08-23-soransoran-seo-index-policy.md`](./2026-08-23-soransoran-seo-index-policy.md) §5 (그대로) |
| §3 원칙 8 · §7 | 계절형은 이벤트 2~4주 전에 발행한다 · `ContentType` · `PublishWindow` · 유형·축 비율 | charter §13 — 앞의 셋은 유지, 비율은 역사적 기준선 |
| §13.2 의 끝 | 등록 뒤의 `drafts/` 사본은 정본이 아니다 (실제로 갈라진 2건) | runbook §10.5 |
| §13.7 · §13.8 · §13.11 | 결정론 QA 규칙의 실측 근거 — 채택(D1 · D4-A · D5 · D7 · D8) · 폐기(D3) · 보류(D4-B) · 규칙으로 만들지 않은 것 · 제도 서술 신호 · "안전한 원고가 통과했다는 것과 그 유형이 안전하다는 것은 다르다" | charter §12 「결정론 QA 규칙의 근거」 — 구간별 원문 링크가 거기 있다 |
| §14 | 시리즈와 본문 문맥 링크 · 이전/다음/관련을 데이터로 저장하지 않는다 | charter §11 · 필드는 코드가 정본 |
| §15.2 · §16.1 · §16.2 | CTA 는 본문 흐름의 결론이다 · 검색엔진 품질 기준 · 우나어 실패에서 버릴 것 | charter §12 「소란소란 연결」 · 「글 구조와 안전 기준」 · charter §4 |

## 옮기지 않은 것 — 이력

| 원문 | 내용 | 왜 옮기지 않았나 |
|---|---|---|
| §4 의 01:00 생성 | 창업자 PC 의 브라우저로 새벽에 제작 | legacy 웹 UI 경로의 시각이다. 현재 예약 시각과 진입점은 runbook §4.5 |
| §5 · §11 · §17 | 재고 일수 목표와 그에 따른 하루 3~5건 생산 · 매일 보는 5줄 보고 · 당시 큐 현황 | 고정 일수 목표와 완성 원고 선생성은 두지 않는다(charter §18-B.5). 매일 쓰기 할당도 없다(charter §3-C). 재고가 없으면 공백을 둔다는 판단만 §3-C 에 남았다 |
| §3 원칙 2·3·4 · §10 · §13.6 · §13.7 의 목표 표 · §13.9 | 옛 위험 등급에 따른 자동 공개와 차단 · 창업자를 부르는 예외 여섯 가지 · 두 레인 · PASS/FAIL/UNKNOWN 로드맵 · 글 단위 수동 등록 손잡이 | 2026-09-23 · 2026-11-03 창업자 결정이 대체했다 — 위험도는 검증 강도이고 승인은 정책 판 영수증이다(charter §3-B · §18-B.6 · §18-B.7). 알림은 runbook §0.0B.9 · §5 |
| §8 | 정보 주제를 대화 주제로 바꾸는 제목 변환법 | 제목은 조사한 검색 의도를 따른다(charter §10 · §12). 제목 말미 형태 규칙은 2026-10-04 에 제거됐다 |
| §12 · §18 · §19 | 우선순위 기준 열 가지 · 다음 구현 배치 · 관련 문서 | 현재 우선순위는 charter §18-B 머리말, 단계는 milestone |
| §13.1 ~ §13.5 · §13.10 | Claude·ChatGPT·Claude Code 역할 분리 · MCP Playwright 흐름 · 실패 시 동작 · hero 를 Chrome 으로 만들던 절차 | legacy 웹 UI 경로의 계약과 실측이다. vNext 생성·검증·hero 는 runbook §0.0B.2 · §0.0B.3 |
| §16.3 | 우나어 자산에서 가져올 판단 기준 | 당시 참고 목록이다 |

## 이 주소를 지우는 조건

`drafts/magazine/topic-queue.ts`(동결된 legacy 큐)의 주석과 D100 문서 목록이 이 경로를 가리킨다. 옛 생산기·큐를 지우는 단계
(runbook §0.0B.7 의 네 조건 충족 뒤)와 문서 목록 정리가 끝나면 이 파일을 지울 수 있다. 그 전까지는 이 안내를 유지한다. 소유자는 매거진 담당이다.
