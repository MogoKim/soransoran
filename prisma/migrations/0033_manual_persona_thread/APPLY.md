# 0033 적용 계약

이 migration은 `ManualPersonaThreadLog`라는 새 감사 원장만 추가한다. 기존 댓글을 수정하거나 backfill하지 않는다.

이 migration과 이를 읽는 애플리케이션은 **D20 자연 운영 PASS와 창업자의 별도 적용 승인 전에는 Production에 넣지 않는다.**

승인 뒤 순서는 다음과 같다.

1. migration을 먼저 적용한다.
2. `prisma migrate status`와 `prisma generate`를 확인한다.
3. 수동 Persona 대화 기능이 포함된 애플리케이션을 배포한다.
4. 기능은 첫 배포에서 `OFF` 상태로 유지한다.
5. 격리 DB 검사와 D20 자연 증명 이후 별도 승인으로 `ADMIN_CANARY`를 연다.

애플리케이션을 먼저 배포하면 새 테이블 조회가 실패한다. 같은 이유로 migration 적용 전 기능 플래그를 열지 않는다.

롤백은 애플리케이션만 먼저 이전 판으로 되돌리고, 감사 원장 테이블과 enum은 보존한다. 공개 Comment와 수동 provenance를 서로 분리하면 이후 무결성 판정이 깨지기 때문이다.

테이블과 enum 제거는 `ManualPersonaThreadLog` 행이 0건임을 확인하고 창업자가 별도로 승인한 경우에만 독립 migration으로 수행한다.
