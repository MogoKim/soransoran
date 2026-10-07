import 'server-only'

import { cache } from 'react'
import { auth } from '@/lib/auth'

/**
 * 요청 하나 안에서 세션 판정을 한 번만 한다.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §8-11 (D1).
 *
 * 🔴 같은 화면 렌더 안의 HeaderAuth · 콘텐츠 상세 · 가입 제안 판정이 이 함수 하나를 본다.
 *    따로 auth() 를 부르면 같은 쿠키를 요청마다 여러 번 해독한다.
 * 🔴 React cache 는 서버 컴포넌트 렌더 범위에서만 공유된다. server action 과 route handler 는
 *    지금처럼 auth() 를 직접 부른다 — 그 경로의 인증 동작은 이 파일이 바꾸지 않는다.
 * 🔴 세션은 JWT 라 이 판정에 DB 조회가 없다.
 */
export const getRequestSession = cache(() => auth())
