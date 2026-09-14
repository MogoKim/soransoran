'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { heroBannerImageUrl } from '@/lib/hero-banner-image'
import {
  HERO_BANNER_ALLOWED_MIME_TYPES,
  HERO_BANNER_IMAGE_SPEC,
  HERO_BANNER_MAX_UPLOAD_BYTES,
  validateHeroBannerImageMetadata,
  type HeroBannerSlot,
} from '@/lib/hero-banner-rules'

/**
 * 이미지 한 자리 — 규격 안내 · 미리보기 · 업로드.
 *
 * 🔴 모바일과 데스크탑을 각각 올린다. 한 장을 잘라 쓰지 않는다 —
 *    배너 안에 카피가 박혀 있어서 crop 이 글자를 자른다.
 *
 * 🔴 브라우저에서 먼저 규격을 본다. 그러나 **서버가 최종 권위자**다.
 *    여기서 미리 보는 이유는 4MB 를 올려 보낸 뒤 거절당하는 대신
 *    고르는 순간 알려 주기 위해서다 — 판정 자체는 같은 함수를 쓴다.
 *
 * 🔴 파일을 고르면 즉시 로컬 미리보기를 띄운다(URL.createObjectURL).
 *    업로드가 끝나면 R2 에 저장된 이미지로 바꾼다 —
 *    "올라간 것" 과 "고른 것" 이 눈으로 구분돼야 운영자가 두 번 올리지 않는다.
 *
 * 🔴 objectURL 을 반드시 revoke 한다. 배너 편집 화면은 한 번 열고 오래 머무는 자리라
 *    고를 때마다 blob 이 쌓이면 메모리를 그대로 먹는다.
 */
type UploadResult = { key: string; url: string | null; width: number; height: number }

export default function HeroBannerImageSlot({
  bannerId,
  slot,
  storedUrl,
  storedKey,
  disabled,
  disabledReason,
}: {
  bannerId: string
  slot: HeroBannerSlot
  /** 이미 저장된 이미지의 공개 주소. 없으면 아직 올리지 않았다. */
  storedUrl: string | null
  storedKey: string | null
  disabled?: boolean
  disabledReason?: string
}) {
  const spec = HERO_BANNER_IMAGE_SPEC[slot]
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [localUrl, setLocalUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploaded, setUploaded] = useState<UploadResult | null>(null)

  useEffect(() => {
    return () => {
      if (localUrl) URL.revokeObjectURL(localUrl)
    }
  }, [localUrl])

  /** 고른 파일의 실제 픽셀 크기. 못 읽으면 null — 그때는 서버 판정에 맡긴다. */
  function readSize(objectUrl: string): Promise<{ width: number; height: number } | null> {
    return new Promise((resolve) => {
      const probe = new window.Image()
      probe.onload = () => resolve({ width: probe.naturalWidth, height: probe.naturalHeight })
      probe.onerror = () => resolve(null)
      probe.src = objectUrl
    })
  }

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    setError(null)
    const file = event.target.files?.[0]
    if (!file) return

    if (localUrl) URL.revokeObjectURL(localUrl)
    const objectUrl = URL.createObjectURL(file)
    setLocalUrl(objectUrl)
    setUploaded(null)

    const size = await readSize(objectUrl)
    if (size) {
      // 🔴 서버와 같은 함수다. 문구가 갈라지지 않는다.
      const invalid = validateHeroBannerImageMetadata(slot, {
        width: size.width,
        height: size.height,
        byteSize: file.size,
        mimeType: file.type,
      })
      if (invalid) {
        setError(invalid.error)
        return
      }
    }

    setBusy(true)
    try {
      const body = new FormData()
      body.append('bannerId', bannerId)
      body.append('slot', slot)
      body.append('file', file)

      const res = await fetch('/api/admin/hero-banners/upload', { method: 'POST', body })
      const data: unknown = await res.json().catch(() => null)

      if (!res.ok) {
        const message =
          data && typeof data === 'object' && 'error' in data
            ? String((data as { error: unknown }).error)
            : '사진을 올리지 못했습니다.'
        setError(message)
        return
      }

      // 🔴 서버가 준 주소라도 next/image 가 그릴 수 있는 host 인지 한 번 더 본다 —
      //    등록되지 않은 host 를 넘기면 렌더 중에 던져 화면 전체가 하얘진다.
      const result = data as UploadResult
      setUploaded({ ...result, url: heroBannerImageUrl(result.key) })
      // 저장된 key 가 서버 컴포넌트 쪽에도 반영되도록 화면을 다시 그린다.
      router.refresh()
    } catch {
      // 🔴 원인을 그대로 보여 주지 않는다 — 네트워크 오류 문구에 내부 주소가 섞인다.
      setError('사진을 올리지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const preview = uploaded?.url ?? localUrl ?? storedUrl
  const previewIsStored = !localUrl && !uploaded && Boolean(storedUrl)
  const ready = Boolean(uploaded?.key ?? storedKey)

  return (
    <div className="rounded-lg border border-subtle bg-surface-card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 text-sm font-bold text-content-primary">{spec.label} 이미지</h3>
        <span className={`text-xs ${ready ? 'text-state-success' : 'text-state-warning'}`}>
          {ready ? '올림' : '없음'}
        </span>
      </div>

      <p className="m-0 mt-1 text-xs text-content-muted">
        권장 {spec.recommendedWidth}×{spec.recommendedHeight} · 최소 {spec.minWidth}×
        {spec.minHeight} · 비율 {spec.targetRatio}:1 · JPG · PNG · WebP ·{' '}
        {Math.round(HERO_BANNER_MAX_UPLOAD_BYTES / (1024 * 1024))}MB 이하
      </p>

      {/* 미리보기 — 비율 상자를 먼저 만들어 이미지가 없어도 자리가 흔들리지 않게 한다 */}
      <div
        className="relative mt-2 w-full max-w-full overflow-hidden rounded-lg bg-surface-soft"
        style={{ aspectRatio: `${spec.recommendedWidth} / ${spec.recommendedHeight}` }}
      >
        {preview ? (
          previewIsStored || uploaded?.url ? (
            <Image
              src={preview}
              alt={`${spec.label} 배너 미리보기`}
              fill
              sizes="(max-width: 1023px) 100vw, 480px"
              className="object-cover"
            />
          ) : (
            // 로컬 blob: 은 next/image 가 다루지 않는다 — 고른 직후의 임시 미리보기다.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt={`${spec.label} 배너 미리보기 (아직 올리지 않음)`}
              className="absolute inset-0 h-full w-full object-cover"
            />
          )
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-xs text-content-muted">
            아직 올린 이미지가 없습니다
          </span>
        )}
      </div>

      {localUrl && !uploaded && !error ? (
        <p className="m-0 mt-1 text-xs text-content-muted">
          고른 사진입니다. 올리는 중이거나 아직 저장되지 않았습니다.
        </p>
      ) : null}

      <div className="mt-2">
        <label
          className={`inline-flex min-h-[52px] items-center justify-center rounded-lg border border-interactive px-3 text-sm font-bold text-content-primary transition duration-150 hover:bg-surface-soft lg:min-h-[48px] ${
            disabled || busy ? 'pointer-events-none opacity-50' : 'cursor-pointer'
          }`}
        >
          {busy ? '올리는 중…' : ready ? '사진 바꾸기' : '사진 고르기'}
          <input
            ref={inputRef}
            type="file"
            accept={HERO_BANNER_ALLOWED_MIME_TYPES.join(',')}
            className="sr-only"
            disabled={disabled || busy}
            onChange={onPick}
          />
        </label>
      </div>

      {disabled && disabledReason ? (
        <p className="m-0 mt-1 text-xs text-content-muted">{disabledReason}</p>
      ) : null}
      {error ? <p className="m-0 mt-1 text-sm text-state-danger">{error}</p> : null}
      {uploaded ? (
        <p className="m-0 mt-1 text-xs text-state-success">
          올렸습니다 · {uploaded.width}×{uploaded.height}
        </p>
      ) : null}
    </div>
  )
}
