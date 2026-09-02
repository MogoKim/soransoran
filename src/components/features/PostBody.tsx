import { toSafePostHtml } from '@/lib/post-html'
import { cn } from '@/lib/utils'

/**
 * 글 본문을 화면에 낸다 — 고객 상세와 운영 콘솔이 같은 것을 쓴다.
 *
 * 🔴 dangerouslySetInnerHTML 을 쓰는 자리는 이 파일 하나다.
 *    화면마다 따로 부르면 한 곳을 고쳐도 나머지가 따라오지 않는다.
 *    지날 수 있는 문을 하나로 두어야 그 문만 지키면 된다.
 *
 * 🔴 toSafePostHtml 을 통과하지 않은 문자열을 여기 넣을 수 없다.
 *    함수 안에서 부르므로 호출하는 쪽이 sanitize 를 잊을 수가 없다.
 *
 * 🔴 옛 글(평문)도 여기를 지난다. 저장된 형식을 판별해 줄바꿈을 지킨다 —
 *    26 건을 HTML 로 바꾸는 마이그레이션을 하지 않기 위한 선택이다.
 */
export default function PostBody({
  content,
  className,
}: {
  content: string
  className?: string
}) {
  return (
    <div
      className={cn('post-body text-content-primary', className)}
      dangerouslySetInnerHTML={{ __html: toSafePostHtml(content) }}
    />
  )
}
