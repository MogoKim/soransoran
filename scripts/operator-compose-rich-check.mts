#!/usr/bin/env tsx
/**
 * 운영 직접 작성 — 글 본문 에디터(사진·유튜브·굵게) 전용 검사 (2026-10-14)
 *
 *   npx tsx --tsconfig tsconfig.ops.json scripts/operator-compose-rich-check.mts
 *   DATABASE_URL=postgresql://soran@127.0.0.1:54329/soran_test \
 *     npx tsx --tsconfig tsconfig.ops.json scripts/operator-compose-rich-check.mts --db   # + 격리 DB
 *
 * 🔴 `--tsconfig tsconfig.ops.json` 이 필요하다. post-html · image-optimize 는 `server-only` 를
 *    부르는데 그 패키지는 설치돼 있지 않다 — ops tsconfig 가 빈 shim 으로 잇는다.
 * 🔴 운영 DB·운영 R2 에 붙지 않는다. 업로드는 가짜 저장소로, 이미지 처리는 실제 sharp 로 본다.
 *    실제 트랜잭션(thumbnailUrl 저장 · 감사 기록 · 중복 키)은 `--db` 로 격리 Postgres 에서 본다(CI 밖).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PrismaClient } from '@prisma/client'
import sharp from 'sharp'

import {
  assertOperatorPostData, buildOperatorCommentData, buildOperatorPostData, operatorThumbnailUrl,
  REQUIRED_OPERATOR_POST_KEYS,
} from '../src/lib/operator-writer'
import { isHtmlContent, postContentToText, sanitizePostHtml } from '../src/lib/post-html'
import { MIN_POST_CONTENT_LENGTH } from '../src/lib/post-policy'
import { MAX_IMAGE_BYTES } from '../src/lib/post-media-policy'
import { receivePostImage, type StoreImage } from '../src/lib/post-image-upload'
import { createOperatorCommentTx, createOperatorPostTx } from '../src/lib/operator-compose-tx'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = (p: string): string => readFileSync(join(ROOT, p), 'utf8')
/** 🔴 주석을 뺀 코드만 — 설명 문장에 나온 단어를 코드로 세지 않는다 */
const code = (p: string): string => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

let pass = 0
let fail = 0
const expect = (label: string, actual: unknown, want: unknown): void => {
  const ok = JSON.stringify(actual) === JSON.stringify(want)
  ok ? (pass += 1) : (fail += 1)
  console.log(`  ${ok ? '✅' : '🔴'} ${label}`)
  if (!ok) console.log(`       기대 ${JSON.stringify(want)} · 실제 ${JSON.stringify(actual)}`)
}
const truthy = (label: string, v: boolean): void => expect(label, v, true)
const throws = (label: string, f: () => void): void => {
  let threw = false
  try { f() } catch { threw = true }
  expect(label, threw, true)
}

const OWN1 = 'https://img.soransoran.com/posts/u1/a.webp'
const OWN2 = 'https://img.soransoran.com/posts/u1/b.webp'
const EXT = 'https://evil.example.com/x.png'
const YT = '<div data-youtube-video=""><iframe src="https://www.youtube-nocookie.com/embed/abc123" width="640" height="480" allowfullscreen="true"></iframe></div>'

/** 🔴 액션(`createOperatorPost`)이 본문에 하는 일과 **같은 순서** — sanitize → 글자 추출 */
function actionContent(raw: string): { content: string; text: string } {
  const trimmed = raw.trim()
  const content = isHtmlContent(trimmed) ? sanitizePostHtml(trimmed) : trimmed
  return { content, text: postContentToText(content) }
}
// 🔴 위 순서가 실제 액션과 같은지 소스로 못박는다 — 검사만 다른 순서를 쓰면 시험이 결함을 덮는다
truthy('액션의 본문 처리 순서가 검사와 같다(sanitize → postContentToText → 최소 글자)',
  /const content = isHtmlContent\(raw\) \? sanitizePostHtml\(raw\) : raw\s+const text = postContentToText\(content\)\s+if \(text\.length < MIN_POST_CONTENT_LENGTH\)/
    .test(src('src/lib/actions/operator-compose.ts')))

const base = { boardType: 'FREE' as const, title: '제목입니다', authorId: 'u-op', operatorWriterId: 'ow-1' }

// ─────────────────────────────────────────────────────────
console.log('\n① 대표 사진(thumbnailUrl)')
{
  const { content } = actionContent(`<p>앞 글</p><p><img src="${EXT}"></p><p><img src="${OWN1}"></p><p><img src="${OWN2}"></p>`)
  const data = buildOperatorPostData({ ...base, content })
  expect('첫 번째 허용 R2 사진이 대표 사진 (외부 사진 건너뜀)', data.thumbnailUrl, OWN1)
  assertOperatorPostData(data as Record<string, unknown>)
  pass += 1; console.log('  ✅ 대표 사진이 있는 글도 저장 직전 검사 통과')
}
{
  const { content } = actionContent('<p>사진 없는 글입니다. 열 글자 넘게.</p>')
  const data = buildOperatorPostData({ ...base, content })
  expect('사진이 없으면 thumbnailUrl=null', data.thumbnailUrl, null)
  assertOperatorPostData(data as Record<string, unknown>)
  pass += 1; console.log('  ✅ 사진 없는 글 저장 직전 검사 통과')
}
expect('평문 본문 속 <img> 글자는 사진이 아니다 → null', operatorThumbnailUrl(`안녕하세요 <img src="${OWN1}"> 글자입니다`), null)
expect('외부 사진만 있으면 null', operatorThumbnailUrl(`<p><img src="${EXT}"></p>`), null)
truthy('thumbnailUrl 이 필수 키로 묶였다', REQUIRED_OPERATOR_POST_KEYS.includes('thumbnailUrl'))
{
  const { content } = actionContent(`<p>글 열 글자 넘게 적었어요</p><p><img src="${OWN1}"></p>`)
  const good = buildOperatorPostData({ ...base, content }) as Record<string, unknown>
  throws('🔴 본문에 없는 R2 주소를 대표로 끼우면 막힌다', () => assertOperatorPostData({ ...good, thumbnailUrl: OWN2 }))
  throws('🔴 외부 주소를 대표로 끼우면 막힌다', () => assertOperatorPostData({ ...good, thumbnailUrl: EXT }))
  throws('🔴 사진 있는 글에서 대표를 비우면 막힌다', () => assertOperatorPostData({ ...good, thumbnailUrl: null }))
  const { thumbnailUrl: _drop, ...noThumb } = good
  throws('🔴 thumbnailUrl 키가 빠지면 막힌다', () => assertOperatorPostData(noThumb))
  expect('정체성 유지 — source=USER · status=PUBLISHED · operatorWriterId · personaId 없음',
    [good.source, good.status, good.operatorWriterId, 'personaId' in good], ['USER', 'PUBLISHED', 'ow-1', false])
}

// ─────────────────────────────────────────────────────────
console.log('\n② 본문 정제 — 외부 사진 · 금지 HTML · 임시 blob')
{
  const raw = `<p>오늘 <strong>굵게</strong> 쓴 글이에요 <a href="javascript:alert(1)">링크</a></p>`
    + `<p><img src="${EXT}"></p><p><img src="blob:http://localhost/123"></p><p><img src="data:image/png;base64,AAAA"></p>`
    + `<p><img src="${OWN1}" onerror="alert(1)"></p>${YT}<script>alert(1)</script>`
    + `<p style="color:red" onclick="x()">끝</p><iframe src="https://evil.example.com/embed"></iframe>`
  const { content } = actionContent(raw)
  truthy('굵게(strong) 유지', content.includes('<strong>굵게</strong>'))
  truthy('우리 R2 사진 유지', content.includes(`src="${OWN1}"`))
  truthy('유튜브(nocookie) iframe 유지', content.includes('https://www.youtube-nocookie.com/embed/abc123'))
  truthy('외부 사진 제거', !content.includes('evil.example.com/x.png'))
  truthy('🔴 업로드 중이던 blob: 사진 제거 — 임시 이미지는 저장되지 않는다', !content.includes('blob:'))
  truthy('data: 사진 제거', !content.includes('data:image'))
  truthy('script 제거', !/<script/i.test(content))
  truthy('on* 속성 제거', !/onerror|onclick/i.test(content))
  truthy('style 속성 제거', !/style=/i.test(content))
  truthy('javascript: 링크 제거(글자는 남김)', !content.includes('javascript:') && content.includes('링크'))
  truthy('타사 iframe 제거', !content.includes('evil.example.com/embed'))
  expect('정제 뒤 대표 사진 = 우리 R2 첫 장', buildOperatorPostData({ ...base, content }).thumbnailUrl, OWN1)
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 최소 본문 — HTML 길이로 우회할 수 없다 · 사진만 있는 글 불가')
{
  const photoOnly = actionContent(`<p><img src="${OWN1}"></p><p><img src="${OWN2}"></p>${YT}`)
  truthy('사진·영상만 있는 글: HTML 은 길지만', photoOnly.content.length > 200)
  truthy('🔴 글자는 최소 미만 → 막힌다', photoOnly.text.length < MIN_POST_CONTENT_LENGTH)
  const tagHeavy = actionContent('<p><strong></strong><strong></strong><strong></strong><strong></strong></p><p>짧다</p>')
  truthy('🔴 빈 태그를 쌓아도 글자 수는 그대로 → 막힌다', tagHeavy.text.length < MIN_POST_CONTENT_LENGTH)
  const ok = actionContent(`<p>열 글자를 넘는 진짜 본문입니다</p><p><img src="${OWN1}"></p>`)
  truthy('글자가 충분하면 통과', ok.text.length >= MIN_POST_CONTENT_LENGTH)
  truthy('운영 액션에는 "사진이 있으면 짧아도 통과" 예외가 없다(회원 글과 다르다)',
    !/hasImage/.test(src('src/lib/actions/operator-compose.ts')))
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 사진 업로드 — 회원과 같은 함수 · 가짜 저장소 · 실제 sharp')
{
  type Call = { key: string; contentType: string; bytes: number }
  const calls: Call[] = []
  const store: StoreImage = async (buffer, key, contentType) => {
    calls.push({ key, contentType, bytes: buffer.length })
    return { url: `https://img.soransoran.com/${key}` }
  }
  const post = (file: File | null): Request => {
    const fd = new FormData()
    if (file) fd.append('file', file)
    return new Request('http://localhost/api/admin/uploads', { method: 'POST', body: fd })
  }
  // EXIF(Orientation·카메라 정보)가 붙은 JPEG 를 실제로 만든다
  const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 100, b: 50 } } })
    .jpeg().withMetadata({ orientation: 6, exif: { IFD0: { Make: 'TestCam', Model: 'X1' } } }).toBuffer()
  truthy('시험 JPEG 에 EXIF 가 실제로 있다', (await sharp(jpeg).metadata()).exif !== undefined)

  let res = await receivePostImage(post(new File([new Uint8Array(jpeg)], 'a.jpg', { type: 'image/jpeg' })), { ownerId: 'admin-1', store, logTag: 't' })
  const body = (await res.json()) as { url?: string; width?: number; height?: number }
  expect('정상 JPEG → 200', res.status, 200)
  expect('저장 1회', calls.length, 1)
  truthy('key = posts/<세션 주인>/<uuid>.webp', /^posts\/admin-1\/[0-9a-f-]{36}\.webp$/.test(calls[0]?.key ?? ''))
  expect('contentType = image/webp', calls[0]?.contentType, 'image/webp')
  truthy('응답 url 은 우리 R2 주소', (body.url ?? '').startsWith('https://img.soransoran.com/posts/admin-1/'))
  expect('Orientation 6 이 반영돼 가로세로가 돌아갔다', [body.width, body.height], [48, 64])

  // EXIF 제거를 저장된 바이트로 직접 확인한다
  let saved: Buffer | null = null
  await receivePostImage(post(new File([new Uint8Array(jpeg)], 'a.jpg', { type: 'image/jpeg' })), {
    ownerId: 'admin-1', logTag: 't', store: async (buffer, key) => { saved = buffer; return { url: `https://img.soransoran.com/${key}` } },
  })
  const meta = saved ? await sharp(saved).metadata() : null
  expect('저장본은 webp', meta?.format, 'webp')
  expect('🔴 저장본에 EXIF 없음', meta?.exif, undefined)

  calls.length = 0
  res = await receivePostImage(post(new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], 'big.jpg', { type: 'image/jpeg' })), { ownerId: 'a', store, logTag: 't' })
  expect('4MB 초과 → 413 · 저장 0', [res.status, calls.length], [413, 0])
  res = await receivePostImage(post(new File([new Uint8Array(jpeg)], 'a.pdf', { type: 'application/pdf' })), { ownerId: 'a', store, logTag: 't' })
  expect('허용하지 않는 MIME → 415 · 저장 0', [res.status, calls.length], [415, 0])
  res = await receivePostImage(post(new File([new TextEncoder().encode('not an image')], 'fake.png', { type: 'image/png' })), { ownerId: 'a', store, logTag: 't' })
  expect('🔴 이미지라고 주장한 글자 파일 → sharp 가 거부 → 500 · 저장 0', [res.status, calls.length], [500, 0])
  res = await receivePostImage(post(null), { ownerId: 'a', store, logTag: 't' })
  expect('파일 없음 → 400 · 저장 0', [res.status, calls.length], [400, 0])
  res = await receivePostImage(post(new File([new TextEncoder().encode('x')], 'IMG_1.heic', { type: 'image/heic' })), { ownerId: 'a', store, logTag: 't' })
  expect('image/heic 형식은 형식 검사를 지나 sharp 판정으로 간다(가짜 바이트라 500) · 저장 0', [res.status, calls.length], [500, 0])
  /**
   * 🔴 기존 동작 기록(이번 변경으로 바뀌지 않음): type 이 빈 파일은 multipart 로 보내는 순간
   *    `application/octet-stream` 이 되어 "빈 type + .heic" 예외에 닿지 않는다 → 415.
   *    회원 업로드도 같은 함수라 같은 결과다. 고치는 일은 이 PR 범위 밖이다.
   */
  res = await receivePostImage(post(new File([new TextEncoder().encode('x')], 'IMG_1.HEIC', { type: '' })), { ownerId: 'a', store, logTag: 't' })
  expect('(기존 동작) type 빈 HEIC 는 multipart 를 지나며 octet-stream 이 되어 415', res.status, 415)
  res = await receivePostImage(post(new File([new Uint8Array(jpeg)], 'a.jpg', { type: 'image/jpeg' })), {
    ownerId: 'a', logTag: 't', store: async () => { throw new Error('R2 down') },
  })
  expect('저장소 실패 → 500 (원인은 화면에 흘리지 않음)', [res.status, ((await res.json()) as { error: string }).error.includes('R2')], [500, false])
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 관리자 업로드 라우트 — 구조')
{
  const admin = code('src/app/api/admin/uploads/route.ts')
  const member = code('src/app/api/uploads/route.ts')
  const at = (s: string, needle: string): number => s.indexOf(needle)
  truthy('세션 → requireAdmin → R2 설정 → 한도 → 파일 처리 순서',
    at(admin, 'await auth()') < at(admin, 'await requireAdmin()')
    && at(admin, 'await requireAdmin()') < at(admin, 'isR2Configured()')
    && at(admin, 'isR2Configured()') < at(admin, 'checkActionRateLimit(')
    && at(admin, 'checkActionRateLimit(') < at(admin, 'receivePostImage('))
  truthy('🔴 업로드 주인은 세션 id (요청 본문에서 받지 않음)',
    /receivePostImage\(request, \{ ownerId: actorUserId,/.test(admin) && !/formData\(\)/.test(admin))
  truthy('🔴 회원의 isOnboarded 에 기대지 않는다', !/isOnboarded/.test(admin))
  truthy('회원 라우트도 같은 함수를 지난다', /receivePostImage\(request, \{ ownerId: userId, store: uploadToR2/.test(member))
  truthy('회원 라우트의 가입 완료 문은 그대로', /isOnboarded/.test(member) && at(member, 'isOnboarded') < at(member, 'receivePostImage('))
  truthy('회원·관리자 같은 한도 상수', /UPLOAD_LIMIT, UPLOAD_WINDOW_MS/.test(admin) && /UPLOAD_LIMIT, UPLOAD_WINDOW_MS/.test(member))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 화면 배선')
{
  const editor = code('src/components/features/PostEditor.tsx')
  const form = code('src/components/admin/OperatorComposeForm.tsx')
  const postForm = code('src/components/features/PostForm.tsx')
  truthy('PostEditor 기본 업로드 주소는 /api/uploads', /uploadEndpoint = '\/api\/uploads'/.test(editor))
  truthy('PostEditor 는 그 주소로 보낸다', /fetch\(uploadEndpoint,/.test(editor) && !/fetch\('\/api\/uploads'/.test(editor))
  truthy('/write(PostForm)는 주소를 넘기지 않는다 → 동작 그대로', !/uploadEndpoint/.test(postForm))
  truthy('운영 폼은 관리자 업로드 주소를 넘긴다', /ADMIN_UPLOAD_ENDPOINT = '\/api\/admin\/uploads'/.test(form) && /uploadEndpoint=\{ADMIN_UPLOAD_ENDPOINT\}/.test(form))
  truthy('🔴 운영 폼은 회원 작성 액션을 쓰지 않는다', !/createPost\b/.test(form) && /createOperatorContent/.test(form))
  truthy('🔴 업로드 중이면 canSubmit=false', /!\(mode === 'post' && uploading\)/.test(form))
  truthy('🔴 implicit submission 도 canSubmit 으로 막는다', /action=\{\(formData\) => \{[\s\S]*?if \(!canSubmit\) return\s+formAction\(formData\)/.test(form))
  truthy('🔴 미리보기는 HTML 을 그리지 않는다(dangerouslySetInnerHTML 없음)', !/dangerouslySetInnerHTML/.test(form))
  truthy('글 길이는 글자(postText) 기준', /const measured = mode === 'post' \? postText : commentBody/.test(form))
  truthy('댓글 모드는 textarea 그대로', /<textarea\s+name="content"\s+value=\{commentBody\}/.test(form))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 댓글 경로 결과 변화 0')
{
  const c = buildOperatorCommentData({ postId: 'p1', content: '댓글입니다', authorId: 'u', operatorWriterId: 'ow' })
  expect('댓글 데이터 모양 그대로', c, { postId: 'p1', authorId: 'u', content: '댓글입니다', operatorWriterId: 'ow', source: 'USER', commentOrigin: 'OPERATOR' })
  truthy('댓글 데이터에 thumbnailUrl 없음', !('thumbnailUrl' in c))
}

// ─────────────────────────────────────────────────────────
// ⑧ 격리 DB — 실제 트랜잭션 (`--db` 일 때만)
// ─────────────────────────────────────────────────────────
if (process.argv.includes('--db')) {
  console.log('\n⑧ 격리 DB — 사진 있는 운영 글의 실제 저장')
  // 🔴 운영 DB 차단 — 이 주소가 아니면 한 줄도 쓰지 않는다
  if (!/^postgresql:\/\/[^@/]*@(127\.0\.0\.1|localhost):\d+\/soran_test(\?|$)/.test(process.env.DATABASE_URL ?? '')) {
    console.error('🔴 격리 DB 가 아니다. 멈춘다.'); process.exit(2)
  }
  const prisma = new PrismaClient()
  try {
    await prisma.operatorWriteLog.deleteMany({})
    await prisma.comment.deleteMany({})
    await prisma.post.deleteMany({})
    await prisma.operatorWriter.deleteMany({})
    await prisma.persona.deleteMany({})
    await prisma.account.deleteMany({})
    await prisma.user.deleteMany({})
    const admin = await prisma.user.create({ data: { name: '관리자', isAdmin: true }, select: { id: true } })
    const writers = []
    for (const code of ['OP01', 'OP30']) {
      const u = await prisma.user.create({ data: { nickname: `작성자${code}` }, select: { id: true } })
      writers.push(await prisma.operatorWriter.create({ data: { code, userId: u.id }, select: { id: true, userId: true } }))
    }
    const counts = async (): Promise<number[]> => [await prisma.account.count(), await prisma.persona.count()]
    const before = await counts()

    const { content } = actionContent(`<p>사진 있는 운영 글입니다 <strong>굵게</strong></p><p><img src="${EXT}"></p><p><img src="${OWN1}"></p>${YT}`)
    const r = await createOperatorPostTx(prisma, {
      operatorWriterId: writers[1]!.id, boardType: 'FREE', title: '사진 글', content, actorUserId: admin.id, requestKey: 'rk-rich-1',
    })
    expect('생성 성공', r.kind, 'created')
    const post = r.kind === 'created'
      ? await prisma.post.findUniqueOrThrow({ where: { id: r.postId }, select: { thumbnailUrl: true, operatorWriterId: true, personaId: true, authorId: true, source: true, content: true } })
      : null
    expect('🔴 DB 의 thumbnailUrl = 첫 우리 R2 사진', post?.thumbnailUrl, OWN1)
    expect('OperatorWriter 글 (OP30) · personaId null · 작성자 = OP30 의 User · source USER',
      [post?.operatorWriterId, post?.personaId, post?.authorId, post?.source], [writers[1]!.id, null, writers[1]!.userId, 'USER'])
    truthy('저장 본문에 외부 사진 없음 · 유튜브 있음', !(post?.content ?? '').includes('evil.example.com') && (post?.content ?? '').includes('youtube-nocookie'))
    const log = await prisma.operatorWriteLog.findMany({ select: { operatorWriterId: true, actorUserId: true, kind: true, requestKey: true } })
    expect('감사 기록 1건 — 공개 작성자 OP30 · 실제 조작자 관리자', log.map((l) => [l.operatorWriterId, l.actorUserId, l.kind, l.requestKey]), [[writers[1]!.id, admin.id, 'post', 'rk-rich-1']])

    const dup = await createOperatorPostTx(prisma, {
      operatorWriterId: writers[1]!.id, boardType: 'FREE', title: '사진 글', content, actorUserId: admin.id, requestKey: 'rk-rich-1',
    })
    expect('🔴 같은 requestKey 재전송 → duplicate', dup.kind, 'duplicate')
    expect('중복 뒤 글 1편 · 감사 1건 그대로', [await prisma.post.count(), await prisma.operatorWriteLog.count()], [1, 1])

    const plain = await createOperatorPostTx(prisma, {
      operatorWriterId: writers[0]!.id, boardType: 'MENOPAUSE', title: '글만 있는 글', content: actionContent('<p>사진 없이 글만 쓴 운영 글</p>').content, actorUserId: admin.id, requestKey: 'rk-rich-2',
    })
    const plainPost = plain.kind === 'created' ? await prisma.post.findUniqueOrThrow({ where: { id: plain.postId }, select: { thumbnailUrl: true } }) : null
    expect('사진 없는 글 → thumbnailUrl null', [plain.kind, plainPost?.thumbnailUrl], ['created', null])

    const target = r.kind === 'created' ? r.postId : ''
    const c = await createOperatorCommentTx(prisma, { operatorWriterId: writers[0]!.id, postId: target, content: '댓글은 그대로예요', actorUserId: admin.id, requestKey: 'rk-c-1' })
    const cm = c.kind === 'created' ? await prisma.comment.findFirstOrThrow({ select: { commentOrigin: true, operatorWriterId: true, personaId: true, content: true } }) : null
    expect('댓글 경로 결과 그대로 — OPERATOR · OP01 · personaId null · 원문 그대로', [c.kind, cm?.commentOrigin, cm?.operatorWriterId, cm?.personaId, cm?.content],
      ['created', 'OPERATOR', writers[0]!.id, null, '댓글은 그대로예요'])
    expect('🔴 Account·Persona 생성 0', await counts(), before)
  } finally {
    await prisma.$disconnect()
  }
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} 통과 ${pass} · 실패 ${fail}\n`)
process.exit(fail === 0 ? 0 : 1)
