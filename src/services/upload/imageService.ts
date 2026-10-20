/**
 * Image storage service interface.
 *
 * Local object URLs are temporary previews. Authenticated cloud uploads use a
 * private bucket and signed URLs; the store persists only the user's object path.
 */

export interface UploadedImage {
  /** Displayable URL (local object URL or short-lived private signed URL). */
  url: string
  /** Storage path / key. Null for local previews. */
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
  /** Releases a local preview or uploaded file when explicitly requested. */
  release(image: UploadedImage): Promise<void>
}

export class UploadError extends Error { }

export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024

class LocalObjectUrlUploader implements ImageUploader {
  readonly kind = 'local' as const
  readonly label = 'Local preview only (not uploaded to cloud)'
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

export class SupabaseStorageUploader implements ImageUploader {
  readonly kind = 'cloud' as const
  readonly label = 'Private Supabase artwork storage'
  readonly accepts = ACCEPTED_IMAGE_TYPES.join(',')
  readonly maxBytes = MAX_IMAGE_BYTES
  private readonly bucket = 'artworks'
  async upload(file: File): Promise<UploadedImage> {
    const { supabase } = await import('../persistence/supabase')
    if (!supabase) throw new UploadError('Cloud storage is not configured.')
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) throw new UploadError('Unsupported artwork image type.')
    if (file.size > this.maxBytes) throw new UploadError('Artwork image exceeds 6 MB.')
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError) throw authError
    if (!user) throw new UploadError('Sign in to upload private artwork.')
    const extension = file.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'image'
    const path = `${user.id}/${crypto.randomUUID()}.${extension}`
    const { error } = await supabase.storage.from(this.bucket).upload(path, file, { contentType:file.type, upsert:false })
    if (error) throw error
    const { data: signed, error:signedError } = await supabase.storage.from(this.bucket).createSignedUrl(path, 3600)
    if (signedError) {
      await supabase.storage.from(this.bucket).remove([path])
      throw signedError
    }
    return { url:signed.signedUrl, path, size:file.size, mimeType:file.type }
  }
  async release(image: UploadedImage): Promise<void> {
    if (image.url.startsWith('blob:')) URL.revokeObjectURL(image.url)
    if (!image.path) return
    const { supabase } = await import('../persistence/supabase')
    if (!supabase) return
    const { error } = await supabase.storage.from(this.bucket).remove([image.path])
    if (error) throw error
  }
}

/** Use private cloud uploads only when the configured Supabase client is present. */
export function createImageUploader(): ImageUploader {
  const configured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
  return configured ? new SupabaseStorageUploader() : new LocalObjectUrlUploader()
}

export const imageUploader: ImageUploader = createImageUploader()
