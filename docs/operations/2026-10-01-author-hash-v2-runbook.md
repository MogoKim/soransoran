# 작가 해시 v1 → v2 전환 runbook (2026-10-01)

> 코드 정본: `scripts/lib/voice-author-hash.mts`(계산 · 세대 판정 · Gate ⑥-B 허가) ·
> `scripts/lib/voice-author-hash-migration.mts`(계획 · 적용 · 되돌리기) · CLI `scripts/voice-author-hash-migrate.mts`
>
> 🔴 **이 문서의 적용 · 되돌리기 단계는 창업자 승인 뒤에만 한다.** 코드 병합만으로는 운영 DB 가 바뀌지 않는다.

## 1. 왜 하나

- 크롤 작가 해시는 `VoiceSource` · `VoiceCommentSignal` 의 `authorHash` · `authorHashNorm` 에만 저장된다.
  말투 자산 corpus 는 불투명한 `speakerId` 를 쓰고, export 와 학습 선별은 `authorHash` 칸을 금지한다.
- 저장값은 `sha256:` 세대(v1) 하나다. 2026-08-26 에 한 번에 적재됐다.
- 적재 · 배정 도구 11곳은 key 가 없으면 **공개 기본값**으로 조용히 내려갔다. 계약 계기판만 그 값을 거부했다.
  그래서 한 판정에 권위가 둘이었다.
- 공개 사슬로 만든 해시는 사전 대입으로 이름을 되살릴 수 있다.
- **새 key 만 넣고 저장값을 두면** Gate ⑥-B B2 가 전부 빗나가 **거짓 통과**가 된다.

v2 는 v1 을 감싼다: `hmac-v2:<kid12>:<hex64>` = `HMAC-SHA256(key, v1 의 hex64)`.

- 원문 없이 옮길 수 있다.
- 같은 사람은 전환 전과 후에 같은 값으로 비교된다.
- `kid` 는 key 의 지문이라, 다른 key 로 만든 값을 가려낸다.

## 2. 창업자 승인 항목 (적용 전에 전부)

| # | 결정 | 기본 권고 |
|---|---|---|
| A1 | **key 생성.** `openssl rand -hex 32`(64자)로 만들어 정본 env `~/Library/Application Support/soransoran/env.local` 에 `VOICE_AUTHOR_HASH_SALT=<값>` 한 줄을 넣는다. 비밀번호 관리자에도 보관한다. 저장소 · 로그 · 채팅에는 절대 남기지 않는다 | 32자 미만이면 도구가 거부한다 |
| A2 | **v1 사슬 원본 대조 증명.** `npm run voice:author-hash-legacy-proof`(read-only)가 **PROVEN** 이어야 한다. 이 도구는 `VoiceSource` 표본 200행의 sourceRef 로 우나어 원본 작가명을 읽어 v1 사슬로 다시 계산해 대조한다. PROVEN 은 대조 100행 이상에 원본 · 정규화 해시가 전부 일치할 때다. `--apply` 도 적용 직전에 같은 대조를 다시 돌린다. 사람 확인으로 대신하는 옵션은 없다. **2026-10-01 실측: UNKNOWN.** 표본 200행 중 대조 0행이다. 우나어 read-only role 에서 `CafePost` 가 0행이다(통계 추정치도 0). 같은 스키마의 `Post` · `Comment` 는 읽힌다. 원본이 비워진 것으로 보이며 원인은 확인하지 못했다 | UNKNOWN 이면 적용하지 않는다. 원본 작가명을 다시 읽을 수 있게 되는 것(우나어 CafePost 복구 또는 다른 원본)이 선결 조건이다 |
| A3 | **되돌리기 백업 보존 기간.** 백업은 `~/Library/Application Support/soransoran/author-hash-rollback/` 아래 0600 권한 파일로 남는다. 백업에는 **v1 값**이 들어 있어 사전 대입이 가능하다 | 검증 후 7일 보존, 그 뒤 삭제(A4 와 함께) |
| A4 | **key 보존.** 되돌리기는 적용 때와 **같은 key** 로만 된다. 백업을 지우기 전에는 key 를 바꾸거나 지우지 않는다 | — |
| A5 | **실행 창.** 22:00~07:00 결정 창을 피하고, voice 적재 도구가 돌지 않는 시간에 한다. 적재 도구는 launchd 에 없다 | 평일 낮 |

## 3. 순서

코드 병합(main) → A1 key 추가 → ① 계획 → ② 적용 → ③ 검증

key 를 넣고 아직 전환하지 않은 사이에는 다음처럼 동작한다(fail-closed).

- 계기판: Gate ⑥-B 를 `needs-migration` 으로 보고 **모름**을 낸다. 지금(key 없음 → 모름)과 결과가 같다.
- 적재 · 배정 도구: 전부 멈춘다(`writableStateOf` · `authorGateOf`).

### ① 계획 (read-only · 기본값)

```bash
npm run voice:author-hash-migrate
```

기대 출력은 수와 상태뿐이다. 해시 · 이름 · key 는 나오지 않는다.

- `key 있음 (kid 지문만 · 12자)`
- `voiceSource 행 9674` · `voiceCommentSignal 행 59252` (2026-10-01 기준. 달라졌으면 먼저 원인을 본다)
- `상태 needs-migration` · `할 일 migrate` · `감쌀 행 N` · `갱신 문장 M`
- `회원 이름 probe proven | unproven` — 참고값이다. 적용 판정은 A2 원본 대조다
- `쓰기 시도 0`

다음 경우에는 멈춘다.

- 상태가 `mixed` · `corrupt` · `key-mismatch` · `empty` 이면 적용하지 않고 원인을 본다.
- `갱신 문장 M` 은 트랜잭션 안의 왕복 수다. 운영 DB 왕복 시간 × M 이 트랜잭션 시한(코드 `TX_TIMEOUT_MS` = 90분)의 절반(45분)을 넘으면 적용하지 않고 보고한다.

### ② 적용 (🔴 승인 뒤에만)

```bash
npm run voice:author-hash-legacy-proof     # A2 — PROVEN(exit 0) 이 아니면 여기서 멈춘다
npm run voice:author-hash-migrate -- --apply   # 적용 직전 원본 대조를 다시 돌려 PROVEN 일 때만 감싼다
```

도구 계약(격리 DB 검사 `npm run voice:author-hash-db-check` 가 잠근다):

- 파일 lock 으로 같은 호스트의 동시 실행을 막는다.
- 적용 전에 세대를 다시 확인한다. `needs-migration` 일 때만 적용한다. `v2-ready` 면 noop 이라 재실행해도 같다(이중 HMAC 없음).
- **백업을 먼저** 쓴다. JSONL 과 `.sha256` 을 0600 으로 남기고 줄 수를 대조한다.
- 트랜잭션은 **단일 Serializable** 이다. (hash, norm) 쌍마다 "지금 값 = 읽은 v1" 인 행만 갱신한다.
  갱신 수가 읽은 수와 다르면 전체 롤백한다(`CONCURRENT_CHANGE`).
- 트랜잭션 안에서 사후 검증을 한다. 하나라도 어긋나면 전체 롤백한다(DB 변경 0).
  - 행 수 불변
  - 전부 지금 key 의 v2
  - 알려진 이름(회원 · Persona 표시명)의 B2 충돌 수가 전과 같음
- 출력: `전환 — N행 v2 · B2 충돌 수 전후 a = a · 되돌리기 백업 <경로>`

### ③ 검증

```bash
npm run voice:author-hash-migrate            # 상태 v2-ready · 할 일 noop · 쓰기 시도 0
```

- 계약 계기판(stage-controller dry-run 또는 `readContractValidPersonas`)에서 Gate ⑥-B 가 **측정됨**으로 바뀌었는지 본다.
  모름 사유 `표시명 Gate ⑥-B 미측정` 이 사라져야 한다.
- 적재 도구 dry-run(`voice-unao-import-live`)이 `writableStateOf` 를 통과하는지 본다. write 는 하지 않는다.

## 4. 되돌리기

```bash
npm run voice:author-hash-migrate -- --rollback=<적용 때 출력된 백업 경로>
```

- **같은 key** 가 정본 env 에 있어야 한다.
- 백업 checksum 이 맞아야 한다. 변조되었거나 없으면 `BACKUP_INVALID` 로 거절한다.
- 단일 트랜잭션이다. 행마다 "지금 값 = 백업 v1 을 지금 key 로 감싼 값" 일 때만 v1 으로 되돌린다.
  하나라도 어긋나면 전체 롤백한다(그 사이 바뀐 행을 덮지 않는다).
- 증거:
  - 출력 `되돌리기 — N행 v1 복원`. N 은 적용 때의 행 수와 같아야 한다.
  - 이어서 계획을 돌리면 `상태 needs-migration` 이다.
- 되돌린 뒤 key 를 지우면 원래 상태(key 없음 → 계기판 모름 · 도구 멈춤)로 돌아간다.
- 스키마 변경은 없다. 코드 rollback 과 데이터 rollback 은 서로 독립이다.

## 5. 이상 상황

| 증상 | 뜻 | 할 일 |
|---|---|---|
| `LOCKED` — lock 파일이 있다 | 다른 실행이 돌고 있거나, 앞 실행이 강제 종료됐다 | `pgrep -f voice-author-hash-migrate` 가 비어 있을 때만 `~/Library/Application Support/soransoran/author-hash-migrate.lock` 을 지운다 |
| `TX_FAILED` | 트랜잭션 전체 롤백. DB 변경 0 | 사유 코드를 본다. 백업 파일은 남았으니 A3 에 따라 지운다 |
| `LEGACY_DOMAIN_UNPROVEN` | 원본 대조가 PROVEN 이 아니다(UNKNOWN 이거나 대조를 끝내지 못함) | 적용하지 않는다. A2 선결 조건부터 푼다 |
| `REFUSED` + `mixed`/`corrupt`/`key-mismatch` | 저장값이 전환할 수 있는 상태가 아니다 | 적용하지 않는다. 원인(부분 적재 · 다른 key)을 먼저 본다 |
| 되돌리기 `ROLLBACK_MISMATCH` | 적용 뒤 값이 바뀌었거나 key 가 다르다 | key 를 확인한다. 추측으로 덮지 않는다 |
