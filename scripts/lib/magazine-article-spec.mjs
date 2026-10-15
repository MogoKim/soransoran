import { createHash } from 'node:crypto'

import { HARD_BODY, SOFT_BODY } from './magazine-body-length.mjs'
import { BANNED_WORDS, MEDICAL_ASSERTIONS } from './magazine-brief-policy.mjs'
import {
  BRIEF_ALLOWED_NOTATIONS,
  BRIEF_FORBIDDEN_TERMS,
  CTA_HREF_PREFIX,
} from './magazine-manuscript-format.mjs'
import { isAutoLaneEligible, VALIDATION_PROFILES } from './magazine-validation-profile.mjs'

export const ARTICLE_SPEC_SCHEMA = 'magazine-article-spec/1'
export const ARTICLE_SPEC_MODE = 'DIRECT_SPEC_V1'

const RELATION_SOURCES = new Set(['M-GRAPH', 'SERIES', 'HUB'])
const IMAGE_MODES = new Set(['REQUIRED', 'OPTIONAL', 'NO_IMAGE'])
const CONTENT_TYPES = new Set(['EVERGREEN', 'SEASONAL', 'COMMUNITY'])

const text = (value) => String(value ?? '').replace(/\r\n?/g, '\n').trim()
const strings = (value) => Array.isArray(value) ? value.map(text).filter(Boolean) : []
const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`

function fail(code, why) {
  const error = new TypeError(`${code}: ${why}`)
  error.code = code
  throw error
}

function required(value, field) {
  const out = text(value)
  if (!out) fail('ARTICLE_SPEC_INPUT', `${field} 가 비었다`)
  return out
}

function internalPath(value, field) {
  const out = required(value, field)
  if (!out.startsWith('/') || out.startsWith('//') || /\s/.test(out)) {
    fail('ARTICLE_SPEC_PATH', `${field} 는 공백 없는 내부 절대 경로여야 한다: ${out}`)
  }
  return out
}

function slugOf(value, field) {
  const out = required(value, field)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(out)) {
    fail('ARTICLE_SPEC_SLUG', `${field} 는 kebab-case slug 여야 한다: ${out}`)
  }
  return out
}

function exactKeys(value, keys, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('ARTICLE_SPEC_SHAPE', `${field} 가 객체가 아니다`)
  }
  if (Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) {
    fail('ARTICLE_SPEC_SHAPE', `${field} 필드가 schema와 다르다`)
  }
}

function sameCanonical(actual, expected, field) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail('ARTICLE_SPEC_CONTRACT', `${field} 가 정본과 다르다`)
  }
}

function uniqueNonEmpty(value, field, { min = 1 } = {}) {
  const out = strings(value)
  if (out.length < min) fail('ARTICLE_SPEC_INPUT', `${field} 는 ${min}개 이상이어야 한다`)
  if (new Set(out).size !== out.length) fail('ARTICLE_SPEC_INPUT', `${field} 에 중복이 있다`)
  return out
}

/** 객체 key만 정렬하고 배열 순서는 보존한다. 모델·시계·파일·네트워크를 읽지 않는다. */
export function canonicalJson(value) {
  const visit = (item) => {
    if (Array.isArray(item)) return item.map(visit)
    if (item && typeof item === 'object') {
      return Object.fromEntries(
        Object.keys(item).sort().map((key) => [key, visit(item[key])]),
      )
    }
    return item
  }
  return JSON.stringify(visit(value))
}

export function articleSpecHash(specWithoutHash) {
  return sha256(canonicalJson(specWithoutHash))
}

function relation(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('ARTICLE_SPEC_RELATION', `${field} 가 객체가 아니다`)
  }
  const source = required(value.source, `${field}.source`)
  if (!RELATION_SOURCES.has(source)) {
    fail('ARTICLE_SPEC_RELATION', `${field}.source 가 허용 값이 아니다: ${source}`)
  }
  return {
    slug: slugOf(value.slug, `${field}.slug`),
    source,
    relationType: required(value.relationType, `${field}.relationType`),
    reason: required(value.reason, `${field}.reason`),
  }
}

function relationSet(relations, ownSlug) {
  const direct = Array.isArray(relations?.direct)
    ? relations.direct.map((item, index) => relation(item, `relations.direct[${index}]`))
    : []
  if (direct.length !== 3) {
    fail('ARTICLE_SPEC_RELATION', `직접 관련 글은 정확히 3개여야 한다 (현재 ${direct.length}개)`)
  }
  const discovery = relation(relations?.discovery, 'relations.discovery')
  const slugs = [...direct.map((item) => item.slug), discovery.slug]
  if (slugs.includes(ownSlug)) fail('ARTICLE_SPEC_RELATION', '자기 글을 관련 글로 연결할 수 없다')
  if (new Set(slugs).size !== slugs.length) fail('ARTICLE_SPEC_RELATION', '3+1 관련 글에 중복 slug 가 있다')
  return { direct, discovery }
}

function publicationOf(publication, queueItem) {
  const publishAt = required(publication?.publishAt, 'publication.publishAt')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/.test(publishAt)) {
    fail('ARTICLE_SPEC_PUBLICATION', 'publishAt 은 초까지 포함한 KST(+09:00) 시각이어야 한다')
  }
  const publishDate = publishAt.slice(0, 10)
  const window = queueItem?.publishWindow ?? null
  if (queueItem?.contentType === 'SEASONAL' && !window) {
    fail('ARTICLE_SPEC_PUBLICATION', 'SEASONAL 항목에는 publishWindow 가 필요하다')
  }
  if (window) {
    const after = required(window.after, 'publishWindow.after')
    const before = required(window.before, 'publishWindow.before')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(after) || !/^\d{4}-\d{2}-\d{2}$/.test(before) || after > before) {
      fail('ARTICLE_SPEC_PUBLICATION', `publishWindow 날짜가 유효하지 않다: ${after}~${before}`)
    }
    if (publishDate < after || publishDate > before) {
      fail('ARTICLE_SPEC_PUBLICATION', `publishAt ${publishDate} 이 publishWindow ${after}~${before} 밖이다`)
    }
    return { publishAt, publishWindow: { after, before } }
  }
  return { publishAt, publishWindow: null }
}

function heroOf(hero, queueItem) {
  const mode = required(queueItem?.imageMode, 'queueItem.imageMode')
  if (!IMAGE_MODES.has(mode)) fail('ARTICLE_SPEC_HERO', `모르는 imageMode 다: ${mode}`)
  const alt = text(hero?.alt) || null
  const scene = text(hero?.scene) || null
  if (mode === 'REQUIRED' && (!alt || !scene)) {
    fail('ARTICLE_SPEC_HERO', 'REQUIRED hero 는 결정된 alt 와 scene 이 모두 필요하다')
  }
  if (mode === 'NO_IMAGE' && (alt || scene)) {
    fail('ARTICLE_SPEC_HERO', 'NO_IMAGE 항목에 hero 내용을 넣을 수 없다')
  }
  return { mode, required: mode === 'REQUIRED', alt, scene }
}

function seriesOf(queueItem) {
  const id = text(queueItem?.seriesId)
  if (!id) return null
  const order = queueItem?.seriesOrder
  if (!Number.isInteger(order) || order < 1) {
    fail('ARTICLE_SPEC_SERIES', 'seriesId 가 있으면 seriesOrder 는 1 이상의 정수여야 한다')
  }
  return { id, order }
}

/**
 * 승인된 graph node와 queue 행을 버전 고정 원고 계약으로 컴파일한다.
 * 입력이 같으면 canonical JSON과 specHash가 항상 같다.
 */
export function compileArticleSpec({ node, queueItem, relations, publication, hero = null }) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) fail('ARTICLE_SPEC_INPUT', 'node 가 객체가 아니다')
  if (!queueItem || typeof queueItem !== 'object' || Array.isArray(queueItem)) fail('ARTICLE_SPEC_INPUT', 'queueItem 이 객체가 아니다')
  if (node.status !== 'APPROVED') fail('ARTICLE_SPEC_NODE_NOT_APPROVED', `승인 노드가 아니다: ${String(node.status)}`)

  const slug = slugOf(queueItem.slug, 'queueItem.slug')
  const intentId = required(queueItem.intentId, 'queueItem.intentId')
  if (required(node.intentId, 'node.intentId') !== intentId) {
    fail('ARTICLE_SPEC_IDENTITY', 'node.intentId 와 queueItem.intentId 가 다르다')
  }
  if (required(node.slug, 'node.slug') !== slug) {
    fail('ARTICLE_SPEC_IDENTITY', 'node.slug 와 queueItem.slug 가 다르다')
  }

  const lane = isAutoLaneEligible(queueItem)
  if (!lane.ok) fail(lane.code ?? 'ARTICLE_SPEC_PROFILE', lane.why)
  const contentType = required(queueItem.contentType, 'queueItem.contentType')
  if (!CONTENT_TYPES.has(contentType)) fail('ARTICLE_SPEC_INPUT', `모르는 contentType 이다: ${contentType}`)
  const relationContract = relationSet(relations, slug)
  const ctaPath = internalPath(queueItem.ctaBoard, 'queueItem.ctaBoard')
  if (!ctaPath.startsWith(CTA_HREF_PREFIX)) {
    fail('ARTICLE_SPEC_CTA', `CTA 는 ${CTA_HREF_PREFIX} 아래여야 한다`)
  }

  const spec = {
    schemaVersion: ARTICLE_SPEC_SCHEMA,
    mode: ARTICLE_SPEC_MODE,
    identity: {
      slug,
      title: required(queueItem.title, 'queueItem.title'),
      graphVersion: required(node.graphVersion, 'node.graphVersion'),
      graphNodeId: required(node.id, 'node.id'),
      intentId,
      cluster: required(queueItem.cluster, 'queueItem.cluster'),
      contentType,
      admissionManifestHash: required(queueItem.g8ManifestHash, 'queueItem.g8ManifestHash'),
    },
    audience: {
      target: required(queueItem.target, 'queueItem.target'),
      readerQuestion: required(node.readerQuestion, 'node.readerQuestion'),
      searchIntent: required(queueItem.intent, 'queueItem.intent'),
    },
    editorial: {
      whyNow: required(queueItem.whyNow, 'queueItem.whyNow'),
      include: uniqueNonEmpty(node.scope?.include, 'node.scope.include'),
      exclude: uniqueNonEmpty(node.scope?.exclude, 'node.scope.exclude'),
      outline: uniqueNonEmpty(node.outline, 'node.outline', { min: 3 }),
    },
    evidence: {
      factsToVerify: uniqueNonEmpty(node.evidence?.factsToVerify, 'node.evidence.factsToVerify'),
      sourceRequirements: uniqueNonEmpty(node.evidence?.sourceRequirements, 'node.evidence.sourceRequirements'),
    },
    safety: {
      validationProfile: lane.profile,
      riskLevel: required(queueItem.riskLevel, 'queueItem.riskLevel'),
      reviewMode: required(queueItem.reviewMode, 'queueItem.reviewMode'),
      bannedTerms: [...BANNED_WORDS],
      forbiddenAssertions: [...MEDICAL_ASSERTIONS],
      topicConstraints: uniqueNonEmpty([queueItem.notes, ...(node.safetyConstraints ?? [])], 'safety constraints'),
    },
    format: {
      frontmatter: ['title', 'description', 'cluster', 'publishedAt'],
      allowedNotations: [...BRIEF_ALLOWED_NOTATIONS],
      forbiddenNotations: [...BRIEF_FORBIDDEN_TERMS],
      ctaCount: 1,
      ctaMustBeLast: true,
      bodyLength: { hard: { ...HARD_BODY }, soft: { ...SOFT_BODY } },
    },
    navigation: {
      direct: relationContract.direct,
      discovery: relationContract.discovery,
      series: seriesOf(queueItem),
      hub: internalPath(node.hubPath, 'node.hubPath'),
      community: { path: ctaPath, label: required(node.ctaLabel, 'node.ctaLabel') },
    },
    hero: heroOf(hero, queueItem),
    publication: publicationOf(publication, queueItem),
  }

  return Object.freeze({ ...spec, specHash: articleSpecHash(spec) })
}

export function verifyArticleSpec(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    return { ok: false, code: 'ARTICLE_SPEC_INVALID', why: 'spec 이 객체가 아니다' }
  }
  if (spec.schemaVersion !== ARTICLE_SPEC_SCHEMA || spec.mode !== ARTICLE_SPEC_MODE) {
    return { ok: false, code: 'ARTICLE_SPEC_VERSION', why: 'spec 판 또는 mode 가 다르다' }
  }
  try {
    exactKeys(spec, ['audience', 'editorial', 'evidence', 'format', 'hero', 'identity', 'mode', 'navigation', 'publication', 'safety', 'schemaVersion', 'specHash'], 'spec')
    exactKeys(spec.identity, ['slug', 'title', 'graphVersion', 'graphNodeId', 'intentId', 'cluster', 'contentType', 'admissionManifestHash'], 'identity')
    exactKeys(spec.audience, ['target', 'readerQuestion', 'searchIntent'], 'audience')
    exactKeys(spec.editorial, ['whyNow', 'include', 'exclude', 'outline'], 'editorial')
    exactKeys(spec.evidence, ['factsToVerify', 'sourceRequirements'], 'evidence')
    exactKeys(spec.safety, ['validationProfile', 'riskLevel', 'reviewMode', 'bannedTerms', 'forbiddenAssertions', 'topicConstraints'], 'safety')
    exactKeys(spec.format, ['frontmatter', 'allowedNotations', 'forbiddenNotations', 'ctaCount', 'ctaMustBeLast', 'bodyLength'], 'format')
    exactKeys(spec.format?.bodyLength, ['hard', 'soft'], 'format.bodyLength')
    exactKeys(spec.navigation, ['direct', 'discovery', 'series', 'hub', 'community'], 'navigation')
    exactKeys(spec.navigation?.community, ['path', 'label'], 'navigation.community')
    exactKeys(spec.hero, ['mode', 'required', 'alt', 'scene'], 'hero')
    exactKeys(spec.publication, ['publishAt', 'publishWindow'], 'publication')
    if (spec.navigation.series !== null) exactKeys(spec.navigation.series, ['id', 'order'], 'navigation.series')
    if (spec.publication.publishWindow !== null) exactKeys(spec.publication.publishWindow, ['after', 'before'], 'publication.publishWindow')
    for (const [index, item] of spec.navigation.direct.entries()) exactKeys(item, ['slug', 'source', 'relationType', 'reason'], `navigation.direct[${index}]`)
    exactKeys(spec.navigation.discovery, ['slug', 'source', 'relationType', 'reason'], 'navigation.discovery')

    const slug = slugOf(spec.identity?.slug, 'identity.slug')
    required(spec.identity?.title, 'identity.title')
    required(spec.identity?.graphVersion, 'identity.graphVersion')
    required(spec.identity?.graphNodeId, 'identity.graphNodeId')
    required(spec.identity?.intentId, 'identity.intentId')
    required(spec.identity?.cluster, 'identity.cluster')
    const contentType = required(spec.identity?.contentType, 'identity.contentType')
    if (!CONTENT_TYPES.has(contentType)) fail('ARTICLE_SPEC_INPUT', `모르는 contentType 이다: ${contentType}`)
    required(spec.identity?.admissionManifestHash, 'identity.admissionManifestHash')
    required(spec.audience?.target, 'audience.target')
    required(spec.audience?.readerQuestion, 'audience.readerQuestion')
    required(spec.audience?.searchIntent, 'audience.searchIntent')
    uniqueNonEmpty(spec.editorial?.include, 'editorial.include')
    uniqueNonEmpty(spec.editorial?.exclude, 'editorial.exclude')
    uniqueNonEmpty(spec.editorial?.outline, 'editorial.outline', { min: 3 })
    uniqueNonEmpty(spec.evidence?.factsToVerify, 'evidence.factsToVerify')
    uniqueNonEmpty(spec.evidence?.sourceRequirements, 'evidence.sourceRequirements')
    if (!VALIDATION_PROFILES.includes(spec.safety?.validationProfile)) {
      fail('ARTICLE_SPEC_PROFILE', 'validationProfile 이 허용 값이 아니다')
    }
    required(spec.safety?.riskLevel, 'safety.riskLevel')
    required(spec.safety?.reviewMode, 'safety.reviewMode')
    uniqueNonEmpty(spec.safety?.topicConstraints, 'safety.topicConstraints')
    sameCanonical(spec.safety?.bannedTerms, BANNED_WORDS, 'safety.bannedTerms')
    sameCanonical(spec.safety?.forbiddenAssertions, MEDICAL_ASSERTIONS, 'safety.forbiddenAssertions')
    sameCanonical(spec.format?.frontmatter, ['title', 'description', 'cluster', 'publishedAt'], 'format.frontmatter')
    sameCanonical(spec.format?.allowedNotations, BRIEF_ALLOWED_NOTATIONS, 'format.allowedNotations')
    sameCanonical(spec.format?.forbiddenNotations, BRIEF_FORBIDDEN_TERMS, 'format.forbiddenNotations')
    if (spec.format?.ctaCount !== 1 || spec.format?.ctaMustBeLast !== true) {
      fail('ARTICLE_SPEC_FORMAT', 'CTA 1개·마지막 줄 계약이 아니다')
    }
    if (canonicalJson(spec.format?.bodyLength?.hard) !== canonicalJson(HARD_BODY)
      || canonicalJson(spec.format?.bodyLength?.soft) !== canonicalJson(SOFT_BODY)) {
      fail('ARTICLE_SPEC_FORMAT', '본문 길이 계약이 정본과 다르다')
    }
    relationSet(spec.navigation, slug)
    internalPath(spec.navigation?.hub, 'navigation.hub')
    internalPath(spec.navigation?.community?.path, 'navigation.community.path')
    required(spec.navigation?.community?.label, 'navigation.community.label')
    const checkedHero = heroOf(spec.hero, { imageMode: spec.hero?.mode })
    if (spec.hero.required !== checkedHero.required) fail('ARTICLE_SPEC_HERO', 'hero.required 가 mode와 다르다')
    publicationOf(spec.publication, { contentType })
  } catch (error) {
    return { ok: false, code: error?.code ?? 'ARTICLE_SPEC_SHAPE', why: error?.message ?? String(error) }
  }
  const { specHash, ...body } = spec
  const expected = articleSpecHash(body)
  if (specHash !== expected) {
    return { ok: false, code: 'ARTICLE_SPEC_HASH', why: `specHash 가 다르다 (${String(specHash)} != ${expected})` }
  }
  return { ok: true, canonicalJson: canonicalJson(spec), specHash }
}
