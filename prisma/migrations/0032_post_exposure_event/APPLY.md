# 0032 PostExposureEvent 적용·확인·복구

이 migration은 실제 상세 열람과 실제 목록 노출을 내부에서 분리하고 30분 중복을 제거하는 원장만 만든다.
기존 `Post.viewCount`와 기존 행은 바꾸지 않는다.

## 배포 순서

1. 이 migration 폴더만 담은 PR-M을 병합한다. 앱 동작은 바뀌지 않는다.
2. 운영 DB에서 미완료·rollback 0, 0032 미적용, 새 enum·표 부재를 읽기 전용으로 확인한다.
3. 별도 승인 뒤 main에서 `npx prisma migrate deploy`를 정확히 한 번 실행한다.
4. 0032 완료, enum 두 개, 표·열·인덱스·FK, 행 0을 읽기 전용으로 확인한다.
5. 그 뒤에만 schema와 앱 경로를 담은 PR-A를 병합한다.

`prisma db push`, `migrate dev`, `migrate resolve`, 직접 SQL 적용과 migration 장부 수정은 금지한다.

## 적용 후 기대 구조

- enum: `PostExposureKind`, `PostExposureSurface`
- 표: `PostExposureEvent`
- unique: `(postId, kind, viewerKeyHash, windowStart)`
- FK: `postId -> Post.id`, delete/update cascade
- 별도 index: `createdAt`, `(postId, kind, createdAt)`
- 행: 0

## 복구

- PR-M만 병합되고 적용 전이면 앱 영향이 없다.
- 적용 뒤 PR-A 전에는 표를 그대로 둔다. 옛 코드는 새 표를 모른다.
- PR-A rollback은 앱 PR만 revert한다. 이미 수락한 실제 노출 행과 누적 조회수는 지우거나 내리지 않는다.
- 표를 없애야 하면 별도 migration으로 처리한다.
- 적용 뒤 이 migration SQL은 수정하지 않는다.
