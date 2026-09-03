import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * 🔴 타이포 역할 별칭을 font-size 그룹으로 등록한다. 등록하지 않으면 조용히 지워진다.
 *
 *    tailwind-merge 는 `text-*` 가 크기인지 색인지를 **이름 모양으로** 판별한다.
 *    `xs`·`sm` 은 크기로 알지만 `meta` 는 모르므로 **색 클래스로 분류**하고,
 *    그러면 진짜 색과 같은 그룹이 되어 뒤엣것만 남는다.
 *
 *      등록 전 실측:  cn('text-meta', 'text-content-muted') → 'text-content-muted'
 *                     (크기가 사라져 본문 크기로 튄다. 빌드 CSS 는 멀쩡해서 안 잡힌다)
 *      등록 후 실측:  cn('text-meta', 'text-content-muted') → 둘 다 유지
 *                     cn('text-meta', 'text-sm')            → 'text-sm' (크기끼리는 정상 충돌)
 *
 * 🔴 별칭을 새로 만들 때마다 이 배열에 넣는다. tailwind.config.ts 의 fontSize 에만
 *    추가하고 여기를 빠뜨리면 화면에서만 조용히 어긋난다 — 정본 §12-6.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['meta'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
