/**
 * validationProfile — **발행 차단 등급이 아니라 검증 강도다.**
 *
 * 🔴 **정본은 항목이 들고 있는 `validationProfile` 하나다.**
 *    앞판은 `cluster` 와 `notes` 를 정규식으로 훑어 프로필을 **추정**했다.
 *    그 방식은 세 건을 실제로 잘못 분류했다:
 *      · `certificate-in-50s`      자격증 이야기인데 money-work 라는 이유로 FINANCIAL
 *      · `year-end-loneliness`     "우울로 단정하지 않는다" 를 의료 신호로 읽어 MEDICAL
 *      · `dinner-change-two-weeks` "식단을 처방하지 않는다" 를 의료 신호로 읽어 MEDICAL
 *    셋 다 **하지 말아야 할 것을 적어 둔 문장**인데, 그 낱말을 근거로 삼았다.
 *    자유문장 정규식은 "무엇을 다루는가" 와 "무엇을 피하는가" 를 구분하지 못한다.
 *
 * 🔴 그래서 추정을 없앴다.
 *      ① 항목에 유효한 `validationProfile` 이 있으면 **무조건 그것**이다.
 *      ② 없으면 아래 `LEGACY_PROFILE_MAP` 에서 찾는다 — 기존 26행만 위한 **고정 표**다.
 *      ③ 둘 다 없으면 **판정하지 않는다.** 조용히 STANDARD 로 보내지 않는다.
 *
 * 🔴 신규 M3 항목은 `validationProfile` 을 달고 들어온다. 표를 늘리지 않는다.
 */
import { checkTitleForm } from './magazine-editorial.mjs'

export const VALIDATION_PROFILES = ['STANDARD', 'MEDICAL', 'FINANCIAL', 'SENSITIVE']
const VALID = new Set(VALIDATION_PROFILES)

/**
 * 🔴 **기존 26행 호환 표.** 슬러그마다 프로필과 **근거 한 줄**을 손으로 적었다.
 *    정규식이 아니라 사람이 읽고 정한 값이다 — 왜 그 프로필인지 여기서 바로 읽힌다.
 *
 * 🔴 새 주제를 여기 추가하지 않는다. 신규는 `validationProfile` 을 들고 온다.
 */
export const LEGACY_PROFILE_MAP = {
  // ── 의료: 몸·증상·검사·진료를 직접 다룬다 ──
  'checkup-items-50s': { profile: 'MEDICAL', why: '건강검진 항목을 다룬다 — 검사·수치 단정 위험' },
  'palpitations-menopause': { profile: 'MEDICAL', why: '두근거림 증상을 다룬다' },
  'dizziness-menopause': { profile: 'MEDICAL', why: '어지럼 증상을 다룬다' },
  'cold-weather-joint-pain': { profile: 'MEDICAL', why: '관절 통증을 다룬다' },
  'hormone-therapy-who': { profile: 'MEDICAL', why: '호르몬 치료 대상을 다룬다 — 치료 단정 위험' },
  'bone-density-test-when': { profile: 'MEDICAL', why: '골밀도 검사 시기를 다룬다' },
  'breast-exam-interval': { profile: 'MEDICAL', why: '검진 주기를 다룬다' },
  'clinic-or-wait': { profile: 'MEDICAL', why: '진료를 갈지 말지를 다룬다' },
  'menopause-supplements-talk': { profile: 'MEDICAL', why: '보조제 이야기를 다룬다 — 복용 권고 위험' },
  'heating-sleep-waking': { profile: 'MEDICAL', why: '수면 중 각성을 다룬다 — 수면제 권고 위험' },
  'hardest-part-of-menopause': { profile: 'MEDICAL', why: '갱년기 증상 경험을 다룬다' },
  'moment-body-changed': { profile: 'MEDICAL', why: '몸의 변화를 다룬다' },

  // ── 재정: 금액·제도·세제를 직접 다룬다 ──
  'irp-tax-benefit': { profile: 'FINANCIAL', why: '세액공제 계산을 다룬다 — 금액 단정 위험' },
  'national-pension-voluntary': { profile: 'FINANCIAL', why: '연금 임의가입 제도를 다룬다' },
  'year-end-tax-medical': { profile: 'FINANCIAL', why: '연말정산 의료비 공제를 다룬다' },
  'retirement-prep-status': { profile: 'FINANCIAL', why: '노후 준비 금액을 다룬다' },

  // ── 민감: 부부 관계를 다룬다 ──
  'how-much-talk-with-husband': { profile: 'SENSITIVE', why: '부부 대화를 다룬다 — 관계 평가·배우자 비난 위험' },

  /**
   * ── 기본: 경험·생활 이야기다 ──
   * 🔴 `notes` 에 "처방하지 않는다" · "우울로 단정하지 않는다" 가 적혀 있어도
   *    그것은 **피할 것**을 적은 문장이지 다루는 주제가 아니다.
   */
  'dinner-change-two-weeks': { profile: 'STANDARD', why: '식사를 바꿔 본 경험 기록 — 식단 처방은 범위 밖이라고 큐가 이미 적어 뒀다' },
  'restart-exercise-menopause': { profile: 'STANDARD', why: '운동을 다시 시작한 마음 — 프로그램 제시는 범위 밖' },
  'autumn-low-mood': { profile: 'STANDARD', why: '계절에 따른 기분 경험 — 진단명을 붙이지 않는 것이 범위' },
  'year-end-loneliness': { profile: 'STANDARD', why: '연말의 허전함 경험 — 우울로 단정하지 않는 것이 범위' },
  'looking-back-on-the-year': { profile: 'STANDARD', why: '한 해를 돌아보는 글' },
  'kimjang-back-pain-prep': { profile: 'STANDARD', why: '김장 준비 경험' },
  'things-not-told-to-children': { profile: 'STANDARD', why: '가족에게 못 한 이야기' },
  'certificate-in-50s': { profile: 'STANDARD', why: '자격증을 준비한 경험 — 금액·제도를 다루지 않는다' },
  'year-end-gathering-reluctance': { profile: 'STANDARD', why: '송년 모임에 가기 싫은 마음' },
}

/**
 * 항목 하나의 프로필을 정한다.
 *
 * @param {object} item  topic-queue 행 또는 M3 큐 항목
 * @returns {{profile:string|null, source:'item'|'legacy'|null, why:string}}
 */
export function resolveValidationProfile(item) {
  // ① 🔴 항목이 들고 있으면 그것이 정본이다. 다시 추정하지 않는다.
  const declared = item?.validationProfile
  if (declared !== undefined && declared !== null && declared !== '') {
    if (!VALID.has(declared)) {
      return { profile: null, source: null,
        why: `🔴 모르는 validationProfile 이다: ${String(declared)} (${VALIDATION_PROFILES.join('|')})` }
    }
    return { profile: declared, source: 'item', why: `항목이 선언한 값 (${declared})` }
  }

  // ② 기존 26행 — 고정 표
  const legacy = LEGACY_PROFILE_MAP[item?.slug]
  if (legacy) {
    return { profile: legacy.profile, source: 'legacy', why: `기존 큐 호환 표: ${legacy.why}` }
  }

  // ③ 🔴 추정하지 않는다
  return { profile: null, source: null,
    why: `🔴 validationProfile 이 없고 호환 표에도 없다 (${item?.slug ?? '슬러그 없음'}) — 항목에 프로필을 달아야 한다` }
}

/**
 * 🔴 **자동 진행 여부는 등급이 정하지 않는다.**
 *    프로필이 정해졌다면 자동 레인을 **탄다.** 못 나가는 이유는 결정론적 QA 실패뿐이다.
 *
 * 🔴 현재 M3 큐의 작업 제목은 brief frontmatter 로 전달된다.
 *    전송 전에 `checkTitleForm` 으로 빈 값·임시 제목만 막고, 문장 끝 어미로
 *    검색 의도를 추정하지 않는다. 제목과 본문이 같은 질문에 답하는지는 QA 의
 *    `checkTitleBodyMatch` 가 본다 (2026-10-04).
 */
export function isAutoLaneEligible(item) {
  const r = resolveValidationProfile(item)
  if (!r.profile) return { ok: false, code: 'PROFILE_UNRESOLVED', why: r.why }
  const t = checkTitleForm(item?.title)
  if (t.level) {
    return { ok: false, code: 'QUEUE_TITLE_FORM', profile: r.profile,
      why: `큐 작업 제목을 자동 제작에 넣을 수 없다 — ${t.reason}. 전송 전에 큐 제목을 구체화해야 한다` }
  }
  return { ok: true, profile: r.profile, source: r.source, why: r.why }
}

/** 호환 필드는 **읽기만** 한다 — 자동 진행 여부를 정하지 않는다 */
export const LEGACY_FIELDS_READ_ONLY = ['riskLevel', 'reviewMode', 'autoEligible', 'needsFullReview']
export const LEGACY_FIELDS_NOTE =
  '🔴 호환을 위해 값은 읽되 자동 진행 판정에 쓰지 않는다. 판정은 validationProfile 과 결정론적 QA 가 한다'
