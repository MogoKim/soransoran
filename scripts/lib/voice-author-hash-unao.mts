/**
 * 작가 해시 v1 사슬 원본 대조 — 우나어 read-only 작가명 조회 (2026-10-01 author-hash v2)
 *
 * 🔴 SELECT 만 한다(`READ_QUERIES.authorsByIds` · SELECT 전용 role). 소란소란 DB 에 연결하지 않는다.
 * 🔴 읽은 작가명은 호출부(`readLegacyDomainProof`)가 해시 대조에만 쓴다 — 이 파일은 출력 · 저장하지 않는다.
 * 🔴 URL 은 정본 env → 없으면 `.env.local`(`loadUnaoReadonlyUrl`) 순. 출력하지 않는다.
 */
import pg from 'pg'

import { readEnvKeys } from './canonical-env.mjs'
import { READ_QUERIES, UNAO_READONLY_URL_ENV, loadUnaoReadonlyUrl } from './voice-unao-readonly.mjs'

const CHUNK = 100

function unaoReadonlyUrl(): string {
  const env = readEnvKeys([UNAO_READONLY_URL_ENV])
  const v = env.ok ? (env.values[UNAO_READONLY_URL_ENV] ?? '').trim() : ''
  return v !== '' ? v : loadUnaoReadonlyUrl()
}

/** 우나어 read-only 연결을 열고 `sourceRef(= CafePost.id) → author` 조회 함수를 빌려준다. 끝나면 닫는다 */
export async function withUnaoAuthorFetcher<T>(
  fn: (fetchAuthors: (sourceRefs: string[]) => Promise<Map<string, string | null>>) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: unaoReadonlyUrl(), ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    return await fn(async (sourceRefs) => {
      const out = new Map<string, string | null>()
      for (let i = 0; i < sourceRefs.length; i += CHUNK) {
        const res = await client.query(READ_QUERIES.authorsByIds, [sourceRefs.slice(i, i + CHUNK)])
        for (const r of res.rows as Array<{ id: unknown; author: unknown }>) {
          out.set(String(r.id), typeof r.author === 'string' ? r.author : null)
        }
      }
      return out
    })
  } finally {
    await client.end()
  }
}
