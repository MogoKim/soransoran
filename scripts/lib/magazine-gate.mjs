#!/usr/bin/env node
/**
 * 매거진 공개 판정 — 스크립트 쪽 구현
 *
 * ⚠️ 이 규칙은 `src/lib/magazine.ts` 에도 있다. **두 곳에 같은 규칙이 산다.**
 *    스크립트가 TS 를 실행하지 못해 import 할 수 없기 때문이다.
 *
 *    두 구현이 조용히 갈라지면 QA 가 "공개"라고 본 글이 런타임에서는 숨겨지거나
 *    그 반대가 된다. 아무 에러도 나지 않고 아무도 모른다.
 *
 *    그래서 assertGateInSync() 가 magazine.ts 를 텍스트로 읽어 대조한다.
 *    규칙을 고칠 때는 **양쪽을 같이** 고쳐야 하고, 안 그러면 QA 가 FAIL 을 낸다.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** KST 기본 공개 시각 — magazine.ts 의 KST_PUBLISH_TIME 과 같아야 한다 */
export const KST_PUBLISH_TIME = 'T10:30:00+09:00'

/** publishAt 이 없으면 publishedAt 을 KST 10:30 으로 본다 */
export function resolvePublishAt(article) {
  return new Date(article.publishAt ?? `${article.publishedAt}${KST_PUBLISH_TIME}`).getTime()
}

/** 지금 공개해도 되는 글인가. qaStatus·riskLevel 은 런타임 판정에 쓰지 않는다 */
export function isPublic(article, now = Date.now()) {
  if (article.status === 'DRAFT' || article.status === 'BLOCKED') return false
  return resolvePublishAt(article) <= now
}

/** 리포트에 붙일 상태 표기 */
export function statusLabel(article) {
  if (article.status === 'BLOCKED') return 'BLOCKED'
  if (article.status === 'DRAFT') return 'DRAFT'
  return isPublic(article) ? 'PUBLIC' : `SCHEDULED ${article.publishAt ?? article.publishedAt}`
}

/**
 * 런타임 구현과 어긋나지 않았는지 대조한다.
 *
 * 주석이 아니라 **실제 코드 문자열**을 본다 — 주석만 맞추고 코드를 바꾸면
 * 감지하지 못하기 때문이다.
 *
 * @param {string} [runtimePath] 기본값 src/lib/magazine.ts
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function assertGateInSync(runtimePath) {
  const path = runtimePath ?? join(process.cwd(), 'src/lib/magazine.ts')
  if (!existsSync(path)) {
    return { ok: false, problems: [`런타임 판정 파일이 없다: ${path}`] }
  }

  const src = readFileSync(path, 'utf8')
  // 주석을 걷어낸 실제 코드만 본다
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const problems = []

  // 정규식 메타문자를 그대로 찾기 위한 이스케이프 ('+09:00' 의 + 가 대표적)
  const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const checks = [
    {
      why: `KST 기본 공개 시각이 '${KST_PUBLISH_TIME}' 이어야 한다`,
      pass: new RegExp(`KST_PUBLISH_TIME\\s*=\\s*'${esc(KST_PUBLISH_TIME)}'`).test(code),
    },
    {
      why: "DRAFT 는 비공개여야 한다 (status === 'DRAFT' 검사)",
      pass: /status\s*===\s*'DRAFT'/.test(code),
    },
    {
      why: "BLOCKED 는 비공개여야 한다 (status === 'BLOCKED' 검사)",
      pass: /status\s*===\s*'BLOCKED'/.test(code),
    },
    {
      why: 'DRAFT · BLOCKED 검사가 false 를 돌려줘야 한다',
      pass: /'DRAFT'[\s\S]{0,60}'BLOCKED'[\s\S]{0,40}return\s+false/.test(code),
    },
    {
      why: 'publishAt 이 없으면 publishedAt + KST 시각을 쓴다',
      pass: /publishAt\s*\?\?\s*`\$\{article\.publishedAt\}\$\{KST_PUBLISH_TIME\}`/.test(code),
    },
    {
      why: '공개 조건이 resolvePublishAt(article) <= now 여야 한다',
      pass: /resolvePublishAt\(article\)\s*<=\s*now/.test(code),
    },
    {
      why: '관문이 공개분만 반환해야 한다 (getAllMagazineArticles 가 isPublic 으로 filter)',
      pass: /getAllMagazineArticles[\s\S]{0,200}isPublicMagazineArticle/.test(code),
    },
  ]

  for (const c of checks) if (!c.pass) problems.push(c.why)
  return { ok: problems.length === 0, problems }
}
