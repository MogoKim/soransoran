/**
 * 매거진 QA 공용 상수 — **값의 정의는 여기 한 곳이다** (S1 C2 · 2026-11-09).
 *
 * 🔴 값만 둔다. 함수 · 파일 읽기 · 다른 모듈 import 가 없다 — 어느 lib · CLI · vNext 모듈이 불러도 부작용이 0 이다.
 * 🔴 값과 **순서**를 바꾸지 않는다. 순서까지 바이트에 실린다:
 *    BANNED_WORDS · MEDICAL_ASSERTIONS 는 ArticleSpec(`safety.bannedTerms` · `forbiddenAssertions` → specHash)과
 *    brief 프롬프트 문자열에 그대로 들어간다. 바꾸면 기존 spec 해시와 전송 지문이 달라진다.
 * 🔴 freeze 하지 않는다 — 앞판(QA CLI 의 배열·Set)과 같은 평범한 값이어야 소비자 동작이 그대로다.
 *    대신 어디서도 이 값을 고치지 않는다(push · add · sort 등 0곳 — 같은 객체를 함께 쓰므로 한 곳의 변형이 전부에 번진다).
 *
 * 앞판: QA CLI(`scripts/magazine-qa.mjs`)가 정의하고 lib 가 그 CLI 를 import 했으며, brief 정책이 같은 값을 옮겨 적은 뒤
 *       QA 소스를 정규식으로 다시 읽어 동기화를 확인했다. 지금은 모두 이 객체를 함께 쓴다.
 *       사본이 다시 생기는지는 `scripts/magazine-vnext-boundary-check.mjs`(R3 · R11)가 본다.
 */

/**
 * 제품·브랜드 금지어. 대체 표현은 "우리 나이" 계열.
 * 본문에서 막는 호칭이 hero 대체 텍스트로 새어 나가면 막은 의미가 없다 — hero alt 검사(`magazine-hero-brief.mjs`)도 이 값을 읽는다.
 */
export const BANNED_WORDS = ['시니어', '어르신', '노인', '실버']

/** 의료 단정 — 진단·효과를 확정하는 표현 (전략 원칙 8). 문맥과 무관하게 FAIL */
export const MEDICAL_ASSERTIONS = ['반드시', '치료됩니다', '원인입니다', '완치', '효과적입니다']

/** medical: true 가 없으면 FAIL — 핵심 건강 클러스터 */
export const MEDICAL_REQUIRED = new Set(['menopause-symptom', 'sleep', 'clinic'])
/** 경계 클러스터 — 없으면 WARN */
export const MEDICAL_SUGGESTED = new Set(['daily', 'emotion'])

/** hero 이미지 크기 계약 — 상세 hero · 목록 썸네일이 같은 한 장을 쓴다 */
export const HERO_WIDTH = 1200
export const HERO_HEIGHT = 675
