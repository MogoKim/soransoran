/**
 * 토스트 공개 표면 — 🔴 밖에서는 이 세 개만 쓴다.
 *
 * 기능 컴포넌트:  const toast = useToast(); toast.success('댓글이 등록됐어요')
 * 셸:            <ToastProvider> … <ToastViewport chrome={chrome} /> </ToastProvider>
 *
 * 위치·색·크기·머무는 시간은 toast-tokens.ts 에서만 바뀐다.
 * 기능 쪽이 그것들을 알면 정책을 고칠 때 호출부를 전부 찾아다녀야 한다.
 */
export { default as ToastProvider, useToast } from '@/components/ui/toast/toast-context'
export { default as ToastViewport } from '@/components/ui/toast/toast-viewport'
export type { ToastOptions } from '@/components/ui/toast/toast-context'
export type { ToastChrome, ToastVariant } from '@/components/ui/toast/toast-tokens'
