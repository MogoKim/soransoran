/**
 * vNext release 출처 결속 — 생성 파일이다. 손으로 고치지 않는다.
 * 만드는 곳: `node scripts/magazine-release-binding.mjs --write` — 지금 graph 판의 ContentPlanInputBundle 을 정적 컴파일한 결과 그대로.
 * 검사: check:magazine-graph · scripts/magazine-release-check.mjs 가 컴파일 결과와 바이트로 대조한다.
 * 판이 지금 graph 와 다르거나 null 이면 runtime 은 출처를 쓰지 않는다(폴백).
 */
import type { ReleaseBinding } from '@/lib/magazine-provenance-rule.mjs'

export const RELEASE_BINDING: ReleaseBinding | null = {
  "graphVersion": "g-20261128-3fbfc8",
  "bundleHash": "8ef851813ea0b1ceb6c6dac4a35efa5fa42e9fe6a25d9ceab10d64c83059c29a",
  "policyBoard": {
    "id": "magazine-content-plan-policy/1",
    "hash": "c21d58fd6089c49a1bf3475e74fa8cddc774051d37be777707de07670a15250d"
  },
  "planHashOf": {
    "I-T3-03": "ef8170dafb07c065d211f93ffa275b86aafc5668ce365fc06340847ac5404640",
    "I-T3-47": "a28e588090ecac55b81410cdb0849a3d9f2d83135ea5ddb036b9cee79496e204",
    "I-T6-03": "d35bed36cff1f79f92d837af2cd5207b8e5d099a8eb333b7647d6470fe70c916",
    "I-T6-05": "cbdd6ba0d69da819403b3290aff1df8af417691cfbc2dad633f840227048ba12",
    "I-T6-11": "859bf784cf97c4a21635ffaccbd16cdde2490b0cd945e4ab9907fb2955b46582"
  },
  "relationsOf": {
    "I-T3-03": [
      "E-0341"
    ],
    "I-T3-47": [
      "E-0326"
    ],
    "I-T6-03": [
      "E-0338",
      "E-0339",
      "E-0340"
    ],
    "I-T6-05": [
      "E-0329"
    ],
    "I-T6-11": [
      "E-0092"
    ]
  }
}
