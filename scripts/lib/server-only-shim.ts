/**
 * `server-only` 를 검증 스크립트에서만 아무것도 아닌 것으로 만든다.
 *
 * 🔴 이 파일은 tsconfig.ops.json 의 paths 로만 연결된다. 앱 빌드가 보는
 *    tsconfig.json 에는 넣지 않는다 — 거기에 넣으면 Next 가 진짜
 *    server-only 가드 대신 이 빈 파일을 쓰게 되어, 서버 전용 모듈이
 *    브라우저 번들로 새어 들어가도 아무도 모른다.
 */
export {}
