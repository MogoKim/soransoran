import { NextResponse } from 'next/server'
import { getBoardBySlug } from '@/lib/board-registry'
import { getMagazineArticleBySlug } from '@/lib/magazine'
import { prisma } from '@/lib/prisma'
import { SITE } from '@/lib/brand'

/**
 * 매거진 CTA 클릭 진단선
 *
 * 매거진 글이 커뮤니티 행동으로 이어지는지 보기 위한 1홉 리다이렉트다.
 * 🔴 클릭 수 자체는 North Star 가 아니다. 진단선일 뿐이다.
 *
 * SEO 안전 근거 (7-E-lite-B 감사):
 *   1. robots.ts 가 이미 '/api/' 를 Disallow 한다 — robots 수정 0줄
 *   2. sitemap.ts 는 화이트리스트라 라우트를 만들어도 들어가지 않는다 — sitemap 수정 0줄
 *   3. Route Handler 라 generateMetadata 가 없다 — canonical 중복이 성립하지 않는다
 *   4. 아래에서 x-robots-tag: noindex 를 직접 붙인다
 *
 * 🔴 open redirect 차단이 이 파일의 핵심이다.
 *    사용자 입력(params.board)을 목적지에 절대 쓰지 않는다.
 *    getBoardBySlug 로 레지스트리에서 찾은 뒤, 그 결과의 href(코드 안 상수)만 쓴다.
 *    '../../evil' · 'https%3A%2F%2Fevil.com' 같은 값은 레지스트리에 없으므로
 *    undefined 가 되어 매거진으로 되돌아간다.
 */
export const dynamic = 'force-dynamic'

/** 판정이 어떻게 갈리든 목적지는 항상 우리 도메인의 고정 경로다 */
function redirectTo(path: string) {
  const res = NextResponse.redirect(new URL(path, SITE.url), 302)
  res.headers.set('x-robots-tag', 'noindex')
  return res
}

export async function GET(
  _request: Request,
  { params }: { params: { slug: string; board: string } },
) {
  const article = getMagazineArticleBySlug(params.slug)
  const board = getBoardBySlug(params.board)

  // 없는 글이거나, 레지스트리에 없는 board 이거나, 글을 쓰는 게시판이 아니면
  // 기록하지 않고 매거진으로 되돌린다.
  if (!article || !board || !board.isCommunity) {
    return redirectTo('/magazine')
  }

  // 🔴 기록 실패가 이동을 막으면 안 된다.
  //    진단선 하나 때문에 독자가 커뮤니티로 못 가는 쪽이 훨씬 큰 손해다.
  //    (MagazineClick 테이블이 아직 DB 에 없는 동안에도 CTA 는 정상 동작한다.)
  try {
    await prisma.magazineClick.create({
      data: { slug: article.slug, boardSlug: board.slug },
    })
  } catch {
    // 삼킨다. 로그도 남기지 않는다 — 실패가 잦으면 계기판의 0 이 그걸 드러낸다.
  }

  return redirectTo(board.href)
}
