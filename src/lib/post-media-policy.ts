/**
 * 글에 붙는 미디어 정책. 에디터·업로드 API·서버 액션이 같은 값을 본다.
 *
 * 🔴 1차 범위는 사진과 유튜브뿐이다.
 *    동영상 파일 업로드 · 타사 영상 iframe · 일반 링크 OG 카드는 넣지 않았다.
 *    우나어에서 확인한 것: 동영상은 트랜스코딩도 썸네일도 없이 원본이 그대로 올라가고,
 *    글을 지워도 본문 속 파일은 남는다(우나어는 thumbnailUrl 하나만 지운다).
 *    50MB 짜리가 지워지지 않고 쌓이는 구조를 먼저 들여올 이유가 없다.
 *
 * 🔴 파일 크기는 4MB 다. Vercel 서버리스 요청 본문 상한이 4.5MB 라
 *    그보다 크면 우리 코드가 보기도 전에 잘린다. 사람이 보는 오류 문구도 없이.
 */

/** 서버가 한 번에 받는 파일 크기. Vercel 4.5MB 제한 이하로 둔다. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024

/** 글 하나에 붙일 수 있는 사진 수. */
export const MAX_IMAGE_COUNT = 6

/**
 * 받는 형식.
 *
 * 🔴 heic·heif 를 받는다. 아이폰 기본 촬영 포맷이라 이걸 막으면
 *    "설정을 바꿔 오세요" 를 안내해야 한다 — 40~60대 이용자에게 그건 포기 사유다.
 *    sharp 가 서버에서 WebP 로 바꾸므로 브라우저 지원 여부는 문제가 되지 않는다.
 */
export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
] as const

/** 확장자로도 한 번 본다 — iOS 17 일부에서 heic 의 file.type 이 빈 문자열로 온다. */
export const HEIC_EXTENSION = /\.(heic|heif)$/i

export const IMAGE_TOO_LARGE = '사진이 너무 커요. 4MB 이하로 골라주세요.'
export const IMAGE_TYPE_NOT_ALLOWED = '사진 형식이 맞지 않아요. JPG · PNG · WebP · GIF · HEIC 만 올릴 수 있어요.'
export const IMAGE_TOO_MANY = `사진은 ${MAX_IMAGE_COUNT}장까지 넣을 수 있어요.`
export const IMAGE_UPLOAD_FAILED = '사진을 올리지 못했어요. 잠시 후 다시 시도해 주세요.'
export const IMAGE_UPLOAD_OFF = '지금은 사진을 올릴 수 없어요. 글만 먼저 올려주세요.'

/**
 * 비회원이 사진 버튼을 눌렀을 때.
 *
 * 🔴 업로드를 열지 않는다. 신원 없는 업로드는 스팸이 가장 먼저 찾는 문이고,
 *    R2 키가 userId 로 나뉘어 있어 비회원 몫을 둘 자리도 없다(api/uploads).
 * 🔴 그래서 서버까지 보내지 않고 여기서 먼저 말한다. 401 을 받아 와서
 *    "로그인이 필요합니다" 를 띄우면 사진이 사라졌다 나타나는 것을 한 번 보게 된다.
 */
export const IMAGE_NEEDS_LOGIN = '사진은 로그인 후에 올릴 수 있어요'

/** 유튜브 주소인가 — 에디터 입력·붙여넣기 양쪽이 같은 것을 본다. */
export const YOUTUBE_URL = /^https:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)[\w-]+/

export const YOUTUBE_INVALID = '유튜브 주소가 맞는지 확인해 주세요.'
