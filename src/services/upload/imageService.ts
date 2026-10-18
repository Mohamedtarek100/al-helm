/**
 * Image storage service interface.
 *
 * Phase 1 ships a `LocalObjectUrlUploader` that keeps artwork previews in the
 * browser only. Phase 2 adds a `SupabaseStorageUploader` implementing the very
 * same interface — components never learn where the bytes went.
 */

export interface UploadedImage {
  /** Displayable URL (object URL today, public CDN URL in Phase 2). */
  url: string
  /** Storage path / key. `null` for the local adapter. */
  path: string | null
  /** Bytes, when known. */
  size: number
  mimeType: string
}

export interface ImageUploader {
  readonly kind: 'local' | 'cloud'
  readonly label: string
  readonly accepts: string
  readonly maxBytes: number
  upload(file: File): Promise<UploadedImage>
  /** Revokes the local object URL; a no-op in Phase 2. */
  release(image: UploadedImage): Promise<void>
}

export class UploadError extends Error { }

export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024

class LocalObjectUrlUploader implements ImageUploader {
  readonly kind = 'local' as const
  readonly label = 'معاينة محلية فقط (بدون رفع للسحابة)'
  readonly accepts = ACCEPTED_IMAGE_TYPES.join(',')
  readonly maxBytes = MAX_IMAGE_BYTES

  async upload(file: File): Promise<UploadedImage> {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      throw new UploadError('الملف لازم يكون صورة من نوع PNG أو JPG أو WEBP أو GIF.')
    }
    if (file.size > this.maxBytes) {
      throw new UploadError('حجم الصورة كبير — الحد الأقصى ٦ ميجابايت.')
    }
    const url = URL.createObjectURL(file)
    return { url, path: null, size: file.size, mimeType: file.type }
  }

  async release(image: UploadedImage): Promise<void> {
    if (image.url.startsWith('blob:')) URL.revokeObjectURL(image.url)
  }
}

/**
 * Phase 2 note: swap this for the Supabase implementation once storage
 * buckets exist. Nothing else in the app needs to change.
 */
export function createImageUploader(): ImageUploader {
  return new LocalObjectUrlUploader()
}

export const imageUploader: ImageUploader = createImageUploader()
