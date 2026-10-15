# legacy-only producer golden

`magazine-direct-spec-source-check.mjs` 만 읽는다. 운영 queue · articles.ts · drafts/magazine 에는 영향이 없다.

- `input.json` — legacy 큐 3행(EVERGREEN · SEASONAL publishWindow · series 1편)과 고정 시각, 전송 메시지용 brief.md 본문.
- `expected.json` — **부모 커밋 `47b8314e490be98d7b60b321b9f67413a8be5777`** 의 `planRun` 과 `deliveryGate` 가
  이 입력으로 낸 결과: run.json(`startedAt`·`finishedAt` 제외), slug 별 `brief.todo.md`·`review.todo.md`,
  legacy 전송 `message`·`messageFingerprint`.

생성 방법(2026-10-15): 부모 커밋을 `git archive` 로 임시 폴더에 풀고, 같은 입력을 임시 HOME·drafts 로
`planRun` → 각 selected 행에 `briefMd` 를 brief.md 로 놓고 `deliveryGate({ queueItem: run.json 행 })` 를 불렀다.
같은 생성기로 DIRECT_SPEC source 관문 이전 head(`423e46c0`)도 바이트 동일했다.

🔴 이 파일은 손으로 고치지 않는다. legacy 출력이 의도적으로 바뀌는 변경이면 그 변경의 근거와 함께
부모 기준을 다시 만들고 커밋 메시지에 남긴다.
