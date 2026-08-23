# 이미지 프롬프트 — 갱년기는 몇 살부터 시작되나요?

> ⚠️ 이번 배치에서 이미지를 **생성하지 않는다.** 프롬프트만 준비한다.
> 생성은 창업자가 ChatGPT 등에서 직접 하고, 내려받아 6-E-1 에서 repo 에 커밋한다.

## 공통 방향

```
✅ 한국 50대 전후 여성 · 자연스러운 표정 · 실제 생활 장면
✅ 밝고 차분한 톤 · 부드러운 자연광
✅ 가로 이미지 (hero 16:9 · 본문 4:3)

🚫 병원 · 약 · 주사 · 의료기기 · 진료실
🚫 과한 뷰티 광고 느낌 (매끈한 피부 보정 · 화장품 · 모델 포즈)
🚫 겁주는 분위기 · 어두운 조명 · 우는 얼굴
🚫 텍스트 삽입 · 워터마크 · 로고
```

---

## 1) hero — 16:9

```
A Korean woman in her early 50s sitting by a bright window at home,
holding a warm cup of tea with both hands, looking outside calmly.
Soft natural morning light. Warm neutral tones, beige and soft coral accents.
Realistic photography, candid moment, not posed.
Landscape 16:9. No text, no logo, no watermark.
Avoid: medical setting, cosmetics, heavy retouching, dramatic lighting.
```

**alt 후보**
- `창가에서 차를 마시며 창밖을 보는 50대 여성`
- `아침 햇살이 드는 창가에 앉아 있는 50대 여성`

**용도**: `heroImage` · OG 이미지
**권장 크기**: 1200 × 675

---

## 2) 본문 중간 — 새벽에 깬 장면 · 4:3

h2 3 "40대 중반부터 느끼기 쉬운 변화" 뒤에 넣기 적합.

```
A Korean woman in her 50s sitting up on the edge of her bed in dim early
morning light, calm expression, hair slightly messy, plain bedroom.
Quiet and ordinary, not distressed. Soft blue-grey dawn tones.
Realistic photography, candid. Landscape 4:3.
No text, no logo. Avoid: medical items, crying, dramatic or scary mood.
```

**alt 후보**
- `새벽에 잠에서 깨어 침대에 앉아 있는 50대 여성`
- `이른 아침 침대 가장자리에 앉아 있는 여성`

**권장 크기**: 1200 × 900

---

## 3) 본문 중간 — 차를 마시며 기록하는 장면 · 4:3

h2 4 "병원에 상담하면 좋은 경우" 근처. 본문의 "짧게라도 적어 두면"과 연결된다.

```
A Korean woman in her 50s at a kitchen table, writing a short note in a
small notebook, a cup of tea beside her. Daytime indoor light.
Focused but relaxed, everyday atmosphere. Warm beige and soft coral tones.
Realistic photography, candid. Landscape 4:3.
No text visible in the notebook. No logo, no watermark.
Avoid: medical charts, prescription, clinical setting.
```

**alt 후보**
- `식탁에서 수첩에 메모하는 50대 여성`
- `차를 곁에 두고 노트에 기록하는 여성`

**권장 크기**: 1200 × 900

---

## 반영 절차 (6-E-1)

```
1. ChatGPT 등에서 생성 → 내려받기
2. webp 변환 · 폭 1200px 기준
3. public/magazine/when-does-menopause-start/ 에 저장
   hero.webp · dawn.webp · notebook.webp
4. article-draft.ts 의 heroImage TODO 채우기 (src·alt·width·height 전부 필수)
5. 본문 이미지는 { type: 'image', image: {...} } 블록으로 삽입
```

⚠️ `MagazineImage` 는 `src`·`alt`·`width`·`height` 가 **전부 필수**다. 하나라도 빠지면 빌드가 막는다.
⚠️ 이미지가 없어도 발행은 가능하다. 그 경우 OG 카드는 로고 폴백이 된다.
