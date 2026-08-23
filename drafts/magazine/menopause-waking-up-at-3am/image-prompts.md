# 이미지 프롬프트 — 갱년기 새벽 3시에 깨는 이유

> 이번 배치에서 이미지를 **생성하지 않는다.** 프롬프트만 준비한다.
> 생성·내려받기는 6-E-5 에서 한다. 첫 글 절차(`../when-does-menopause-start/image-prompts.md`)와 동일.

## 공통 방향

```
✅ Korean woman in her late 40s — 40대 후반으로 명시
✅ 자연스러운 표정 · 실제 생활 장면 · 부드러운 자연광
✅ 가로 이미지 (hero 16:9 · 보조 4:3)

🚫 not elderly, not a grandmother, no gray hair emphasis
🚫 병원 · 약 · 주사 · 의료기기 · 진료실
🚫 우는 얼굴 · 과한 우울 · 겁주는 어두운 분위기
🚫 과한 뷰티 광고 느낌 (매끈한 보정 · 화장품 · 모델 포즈)
🚫 20~30대로 보이는 젊은 모델
🚫 텍스트 · 로고 · 워터마크
```

⚠️ 첫 글에서 실측한 것: 나이 지시를 `in her 50s` 로만 주면 결과가 60대 인상으로 흐른다.
`late 40s` + `not elderly, not a grandmother` 를 **같이** 넣어야 의도한 연령대가 나온다.

---

## 1) hero — 16:9 · 1200 × 675

```
A Korean woman in her late 40s sitting quietly on the edge of her bed in
soft early morning light, awake before sunrise. Calm, ordinary expression —
not distressed, not crying. Plain bedroom, simple bedding, a window with
pale blue-grey dawn light coming in. Natural dark hair, no emphasis on grey
hair. She is clearly middle-aged, not elderly, not a grandmother.
Realistic candid photography, soft natural light, warm neutral tones with
muted blue accents. Landscape 16:9.
No text, no logo, no watermark.
Avoid: medical setting, pills, medical devices, hospital, crying face,
heavy sadness, dramatic or scary lighting, beauty-ad retouching,
a model who looks like she is in her 20s or 30s.
```

**alt 후보**
- `이른 새벽에 잠에서 깨어 침대 가장자리에 앉아 있는 40대 후반 한국 여성`
- `동트기 전 침실 창가 빛 속에 앉아 있는 40대 후반 한국 여성`

**용도**: `heroImage` · OG 이미지(6-E-3 에서 og:image 연결 완료 — hero 가 있으면 공유 카드에 자동으로 붙는다)
**저장 경로**: `public/magazine/menopause-waking-up-at-3am/hero.webp`

---

## 2) 보조 이미지 후보 — 4:3 · 1200 × 900 · **이번 발행에서는 사용 보류**

본문 h2 4 "새벽에 깼을 때 해볼 수 있는 것"의 "한 줄만 적어 두기"와 연결되는 장면.

```
A Korean woman in her late 40s at a kitchen table in early morning light,
writing a short note in a small notebook, a warm cup of tea beside her.
Relaxed everyday atmosphere, soft daylight through a window.
Natural dark hair, clearly middle-aged, not elderly, not a grandmother.
Realistic candid photography, warm beige tones. Landscape 4:3.
No text visible in the notebook. No logo, no watermark.
Avoid: medical charts, prescriptions, clinical setting, crying,
beauty-ad retouching, a model in her 20s or 30s.
```

**alt 후보**
- `아침 식탁에서 수첩에 짧게 기록하는 40대 후반 한국 여성`

**보류 이유**: 본문 중간 `image` 블록은 이번 초안에 넣지 않았다(지시).
넣기로 결정되면 h2 4 뒤에 `{ type: 'image', image: {...} }` 로 삽입한다.

---

## 반영 절차 (6-E-5)

```
1. ChatGPT 등에서 hero 생성 → 내려받기
2. webp 변환 · 폭 1200px 기준 (sips 는 webp 쓰기를 지원하지 않는다 —
   브라우저 canvas toDataURL('image/webp', 0.85) 경로를 쓴다. 첫 글에서 실측한 방법)
3. public/magazine/menopause-waking-up-at-3am/hero.webp 로 저장
4. articles.ts 의 heroImage 에 src·alt·width·height 를 전부 채운다
```

⚠️ `MagazineImage` 는 `src`·`alt`·`width`·`height` 가 **전부 필수**다. 하나라도 빠지면 빌드가 막는다.
⚠️ hero 없이도 발행은 된다. 그 경우 `og:image` 키 자체가 생략되고 `twitter:card` 가 `summary` 로 떨어진다(6-E-3 구현).
