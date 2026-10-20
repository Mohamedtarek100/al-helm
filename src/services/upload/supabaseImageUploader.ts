import { supabase } from '../persistence/supabase'
import { ACCEPTED_IMAGE_TYPES, MAX_IMAGE_BYTES, UploadError, type ImageUploader, type UploadedImage } from './imageService'

export class SupabaseStorageUploader implements ImageUploader {
  readonly kind = 'cloud' as const
  readonly label = 'Private Supabase artwork storage'
  readonly accepts = ACCEPTED_IMAGE_TYPES.join(',')
  readonly maxBytes = MAX_IMAGE_BYTES
  private readonly bucket = 'artworks'
  async upload(file: File): Promise<UploadedImage> {
    if (!supabase) throw new UploadError('Cloud storage is not configured.')
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) throw new UploadError('Unsupported artwork image type.')
    if (file.size > this.maxBytes) throw new UploadError('Artwork image exceeds the 6 MB limit.')
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError) throw authError
    if (!user) throw new UploadError('Sign in to upload private artwork.')
    const extension = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'image'
    const path = `${user.id}/${crypto.randomUUID()}.${extension}`
    const { error } = await supabase.storage.from(this.bucket).upload(path, file, { contentType: file.type, upsert: false })
    if (error) throw error
    const { data: signed, error: signedError } = await supabase.storage.from(this.bucket).createSignedUrl(path, 3600)
    if (signedError) throw signedError
    return { url: signed.signedUrl, path, size: file.size, mimeType: file.type }
  }
  async release(image: UploadedImage): Promise<void> {
    if (image.url.startsWith('blob:')) URL.revokeObjectURL(image.url)
    if (supabase && image.path) { const { error } = await supabase.storage.from(this.bucket).remove([image.path]); if (error) throw error }
  }
}
