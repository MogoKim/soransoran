/**
 * vNext release 출처 결속 — 생성 파일이다. 손으로 고치지 않는다.
 * 만드는 곳: `node scripts/magazine-release-binding.mjs --write` — 지금 graph 판의 ContentPlanInputBundle 을 정적 컴파일한 결과 그대로.
 * 검사: check:magazine-graph · scripts/magazine-release-check.mjs 가 컴파일 결과와 바이트로 대조한다.
 * 판이 지금 graph 와 다르거나 null 이면 runtime 은 출처를 쓰지 않는다(폴백).
 */
import type { ReleaseBinding } from '@/lib/magazine-provenance-rule.mjs'

export const RELEASE_BINDING: ReleaseBinding | null = {
  "graphVersion": "g-20261124-e8a6b8",
  "bundleHash": "bf5322bdb91b6b28c4884e63f5194cd8c1afe26d0eb42a987b2a70b8f9404277",
  "policyBoard": {
    "id": "magazine-content-plan-policy/1",
    "hash": "c21d58fd6089c49a1bf3475e74fa8cddc774051d37be777707de07670a15250d"
  },
  "planHashOf": {
    "I-T3-47": "5d529b42d832bbd19b44764c928c916429961ef25f364ca051b95b39376ab504",
    "I-T6-03": "45456475fb5c16b5705755888561a56525f2d32c763153c3f799ca697cd5e1ed",
    "I-T6-05": "d5685904daebffc325a9d4712e0c31cecb7c88022c768b2b5784438effa723fa",
    "I-T6-11": "5832c99dfa5aa1172e36fbd88be5a2fea0540432d9a24e3bd1403a8765c7adc4"
  },
  "relationsOf": {
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
