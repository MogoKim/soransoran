#!/usr/bin/env node

import assert from 'node:assert/strict'

import {
  ARTICLE_SPEC_MODE,
  ARTICLE_SPEC_SCHEMA,
  articleSpecHash,
  canonicalJson,
  compileArticleSpec,
  verifyArticleSpec,
} from './lib/magazine-article-spec.mjs'

let pass = 0
let fail = 0
const check = (name, fn) => {
  try { fn(); pass++; console.log(`PASS ${name}`) }
  catch (error) { fail++; console.error(`FAIL ${name}: ${error?.stack ?? error}`) }
}
const throws = (code, mutate) => {
  const input = fixture()
  mutate(input)
  assert.throws(() => compileArticleSpec(input), (error) => error?.code === code)
}

function fixture() {
  return {
    node: {
      status: 'APPROVED',
      id: 'intent/sleep/waking-at-3am',
      intentId: 'intent/sleep/waking-at-3am',
      slug: 'waking-at-3am',
      graphVersion: 'g-test-001',
      readerQuestion: '새벽 세 시에 자꾸 깨는 이유가 무엇인지, 오늘부터 무엇을 살펴봐야 할까?',
      scope: {
        include: ['중간 각성 경험', '생활에서 확인할 단서'],
        exclude: ['질환 진단', '수면제 추천'],
      },
      outline: ['먼저 확인할 점', '밤중 각성의 흔한 맥락', '기록하고 도움을 구할 때'],
      evidence: {
        factsToVerify: ['진단으로 단정하지 않았는가', '지속되면 전문가 확인을 권하는가'],
        sourceRequirements: ['변할 수 있는 의학 수치는 쓰지 않는다', '일반 정보와 개인 진단을 구분한다'],
      },
      safetyConstraints: ['불안을 부추기지 않는다'],
      hubPath: '/magazine?cluster=sleep',
      ctaLabel: '우리의 잠 이야기를 나눠요',
    },
    queueItem: {
      day: 1001,
      slug: 'waking-at-3am',
      title: '새벽 세 시에 자꾸 깰 때 먼저 살펴볼 것',
      contentType: 'EVERGREEN',
      intent: '질문',
      cluster: 'sleep',
      target: '40대 후반~60대 중반 여성',
      validationProfile: 'MEDICAL',
      riskLevel: 'MEDIUM',
      reviewMode: 'RISK_SENTENCES',
      imageMode: 'REQUIRED',
      autoEligible: true,
      seriesId: 'sleep-change',
      seriesOrder: 1,
      ctaBoard: '/community/menopause',
      internalLinks: ['sleep-hot-flash', 'night-sweats-sleep'],
      whyNow: '검색 질문에 직접 답하고 잠 경험을 커뮤니티 대화로 잇는다',
      notes: '원인을 하나로 단정하지 않고 오래가면 진료 확인을 권한다',
      intentId: 'intent/sleep/waking-at-3am',
      g8ManifestHash: 'sha256:test',
    },
    relations: {
      direct: [
        { slug: 'sleep-hot-flash', source: 'M-GRAPH', relationType: 'DIRECT_NEXT', reason: '열감과 각성을 함께 살핀다' },
        { slug: 'night-sweats-sleep', source: 'M-GRAPH', relationType: 'SAME_EXPERIENCE', reason: '비슷한 밤 경험이다' },
        { slug: 'sleep-routine-reset', source: 'M-GRAPH', relationType: 'ACTION_OR_CONTEXT', reason: '생활 기록으로 이어진다' },
      ],
      discovery: { slug: 'menopause-palpitations-night', source: 'M-GRAPH', relationType: 'BRIDGE_DISCOVERY', reason: '밤중 신체 변화의 다른 질문이다' },
    },
    hero: {
      alt: '늦은 밤 스탠드 불빛 아래 조용히 앉아 있는 50대 한국 여성',
      scene: '어두운 방에 작은 조명만 켜 두고 침대 가에 앉아 있는 모습',
    },
    publication: { publishAt: '2026-10-20T10:30:00+09:00' },
  }
}

const a = compileArticleSpec(fixture())
const b = compileArticleSpec(fixture())

check('schema와 mode가 고정된다', () => {
  assert.equal(a.schemaVersion, ARTICLE_SPEC_SCHEMA)
  assert.equal(a.mode, ARTICLE_SPEC_MODE)
})
check('같은 입력은 같은 canonical JSON과 hash를 만든다', () => {
  assert.equal(canonicalJson(a), canonicalJson(b))
  assert.equal(a.specHash, b.specHash)
})
check('객체 입력 key 순서는 hash에 영향을 주지 않는다', () => {
  const input = fixture()
  input.node = Object.fromEntries(Object.entries(input.node).reverse())
  assert.equal(compileArticleSpec(input).specHash, a.specHash)
})
check('specHash 검증이 통과한다', () => assert.equal(verifyArticleSpec(a).ok, true))
check('본문을 바꾸면 hash 검증이 실패한다', () => {
  const changed = structuredClone(a)
  changed.editorial.outline[0] = '바꾼 구조'
  assert.equal(verifyArticleSpec(changed).code, 'ARTICLE_SPEC_HASH')
})
check('hash를 다시 계산해도 schema 밖 필드는 차단한다', () => {
  const changed = structuredClone(a)
  changed.unknown = true
  delete changed.specHash
  changed.specHash = articleSpecHash(changed)
  assert.equal(verifyArticleSpec(changed).code, 'ARTICLE_SPEC_SHAPE')
})
check('출력에 시계나 생성 시각이 없다', () => {
  assert.equal('generatedAt' in a, false)
  assert.equal('compiledAt' in a, false)
})
check('승인 노드가 아니면 차단한다', () => throws('ARTICLE_SPEC_NODE_NOT_APPROVED', (x) => { x.node.status = 'DRAFT' }))
check('node와 queue의 intent가 다르면 차단한다', () => throws('ARTICLE_SPEC_IDENTITY', (x) => { x.node.intentId = 'other' }))
check('node와 queue의 slug가 다르면 차단한다', () => throws('ARTICLE_SPEC_IDENTITY', (x) => { x.node.slug = 'other' }))
check('validationProfile을 추정할 수 없으면 차단한다', () => throws('PROFILE_UNRESOLVED', (x) => { delete x.queueItem.validationProfile; x.queueItem.slug = 'new-unknown'; x.node.slug = 'new-unknown' }))
check('직접 관련 글이 3개가 아니면 차단한다', () => throws('ARTICLE_SPEC_RELATION', (x) => { x.relations.direct.pop() }))
check('3+1에 중복이 있으면 차단한다', () => throws('ARTICLE_SPEC_RELATION', (x) => { x.relations.discovery.slug = x.relations.direct[0].slug }))
check('자기 링크는 차단한다', () => throws('ARTICLE_SPEC_RELATION', (x) => { x.relations.direct[0].slug = x.queueItem.slug }))
check('관계 근거가 비면 차단한다', () => throws('ARTICLE_SPEC_INPUT', (x) => { x.relations.direct[0].reason = '' }))
check('독자 질문이 비면 차단한다', () => throws('ARTICLE_SPEC_INPUT', (x) => { x.node.readerQuestion = '' }))
check('범위 include가 비면 차단한다', () => throws('ARTICLE_SPEC_INPUT', (x) => { x.node.scope.include = [] }))
check('범위 exclude가 비면 차단한다', () => throws('ARTICLE_SPEC_INPUT', (x) => { x.node.scope.exclude = [] }))
check('구조가 3개 미만이면 차단한다', () => throws('ARTICLE_SPEC_INPUT', (x) => { x.node.outline = ['하나', '둘'] }))
check('근거 확인 항목이 비면 차단한다', () => throws('ARTICLE_SPEC_INPUT', (x) => { x.node.evidence.factsToVerify = [] }))
check('출처 요구가 비면 차단한다', () => throws('ARTICLE_SPEC_INPUT', (x) => { x.node.evidence.sourceRequirements = [] }))
check('CTA가 커뮤니티 밖이면 차단한다', () => throws('ARTICLE_SPEC_CTA', (x) => { x.queueItem.ctaBoard = '/jobs' }))
check('hub가 외부 URL이면 차단한다', () => throws('ARTICLE_SPEC_PATH', (x) => { x.node.hubPath = 'https://example.com' }))
check('REQUIRED hero에 alt가 없으면 차단한다', () => throws('ARTICLE_SPEC_HERO', (x) => { x.hero.alt = '' }))
check('NO_IMAGE에 hero를 넣으면 차단한다', () => throws('ARTICLE_SPEC_HERO', (x) => { x.queueItem.imageMode = 'NO_IMAGE' }))
check('예약 시각이 KST 형식이 아니면 차단한다', () => throws('ARTICLE_SPEC_PUBLICATION', (x) => { x.publication.publishAt = '2026-10-20T01:30:00Z' }))
check('SEASONAL은 publishWindow가 필요하다', () => throws('ARTICLE_SPEC_PUBLICATION', (x) => { x.queueItem.contentType = 'SEASONAL' }))
check('SEASONAL 예약이 window 밖이면 차단한다', () => throws('ARTICLE_SPEC_PUBLICATION', (x) => {
  x.queueItem.contentType = 'SEASONAL'
  x.queueItem.publishWindow = { after: '2026-11-01', before: '2026-11-30' }
}))
check('seriesId가 있으면 순서가 필요하다', () => throws('ARTICLE_SPEC_SERIES', (x) => { delete x.queueItem.seriesOrder }))
check('고정 형식·길이·CTA 계약을 싣는다', () => {
  assert.deepEqual(a.format.bodyLength.hard, { min: 800, max: 3000 })
  assert.equal(a.format.ctaCount, 1)
  assert.equal(a.format.ctaMustBeLast, true)
  assert.equal(a.navigation.direct.length, 3)
  assert.ok(a.navigation.discovery.slug)
})
check('모델·시계·네트워크 입력이 없어도 순수 컴파일된다', () => {
  assert.match(a.specHash, /^sha256:[a-f0-9]{64}$/)
  assert.equal(a.publication.publishAt, '2026-10-20T10:30:00+09:00')
})

console.log(`\nArticleSpec 계약 검사: ${pass} pass, ${fail} fail`)
if (fail) process.exit(1)
