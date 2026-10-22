import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, IconButton } from '../components/Button'
import { Card } from '../components/Card'
import { EmptyState } from '../components/Display'
import { Field, Select, TextArea, TextInput } from '../components/Field'
import { CameraIcon, CloseIcon, EditIcon, ImageIcon, SearchIcon, StarIcon, TrashIcon } from '../components/icons'
import { createArtwork, deleteArtwork, updateArtwork, useAppData } from '../services/store'
import { todayKey } from '../services/date'
import { useI18n } from '../i18n/useI18n'
import type { Artwork } from '../types'

export const ART_CATEGORIES = [
  { key: 'sketches', en: 'Sketches', ar: 'اسكتشات' },
  { key: 'character', en: 'Character Design', ar: 'تصميم شخصيات' },
  { key: 'portraits', en: 'Portraits', ar: 'بورتريهات' },
  { key: 'landscape', en: 'Landscapes', ar: 'مناظر طبيعية' },
  { key: 'architecture', en: 'Architecture', ar: 'عمارة' },
  { key: 'fashion', en: 'Fashion', ar: 'أزياء' },
  { key: 'studyref', en: 'Study References', ar: 'مراجع دراسية' },
  { key: 'ideas', en: 'Ideas & Inspiration', ar: 'أفكار وإلهام' },
  { key: 'other', en: 'Other', ar: 'أخرى' },
] as const

type Sort = 'recent' | 'oldest' | 'title'
type SourceFilter = 'all' | 'drawn' | 'photo' | 'imported'

const SOURCE_LABELS: Record<string, { en: string; ar: string }> = {
  drawn: { en: 'Drawn in app', ar: 'مرسوم داخل التطبيق' },
  photo: { en: 'Camera photo', ar: 'صورة بالكاميرا' },
  imported: { en: 'Imported image', ar: 'صورة مستوردة' },
}

/** Resolve an artwork's displayable image URL, preferring the IndexedDB blob. */
export function useArtworkImage(artwork: Artwork | null | undefined): string {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let cancelled = false
    let objectUrl = ''
    async function resolve() {
      if (!artwork) { setUrl(''); return }
      try {
        const { getImage } = await import('../services/artImages')
        const blob = await getImage(artwork.id)
        if (cancelled) return
        if (blob) {
          objectUrl = URL.createObjectURL(blob)
          setUrl(objectUrl)
          return
        }
      } catch { /* fall through to stored URL */ }
      setUrl(artwork.imageUrl || '')
    }
    void resolve()
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [artwork])
  return url
}

function ArtworkImage({ artwork, className }: { artwork: Artwork; className?: string }) {
  const url = useArtworkImage(artwork)
  if (!url) return <div className={`art-library__thumb art-library__thumb--empty ${className ?? ''}`}><ImageIcon size={32} /></div>
  return <img src={url} alt={artwork.title} className={`art-library__thumb ${className ?? ''}`} loading="lazy" />
}

export function ArtLibrary() {
  const { language } = useI18n()
  const data = useAppData()
  const artworks = data.artworks

  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [source, setSource] = useState<SourceFilter>('all')
  const [tagFilter, setTagFilter] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [sort, setSort] = useState<Sort>('recent')
  const [selected, setSelected] = useState<Artwork | null>(null)
  const [pending, setPending] = useState<{ dataUrl: string; source: Artwork['source'] } | null>(null)
  const [fileError, setFileError] = useState('')
  const importRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState({ title: '', description: '', category: '', tags: '' })

  const sourceLabel = (a: Artwork) => {
    const s = SOURCE_LABELS[a.source ?? 'drawn']
    return language === 'en' ? s.en : s.ar
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = artworks.filter((a) => {
      if (q && !`${a.title} ${a.description}`.toLowerCase().includes(q)) return false
      if (category !== 'all' && (a.category ?? '') !== category) return false
      if (source !== 'all' && (a.source ?? 'drawn') !== source) return false
      if (favoritesOnly && !a.favorite) return false
      if (tagFilter && !(a.tags ?? []).includes(tagFilter)) return false
      return true
    })
    return [...list].sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title)
      if (sort === 'oldest') return a.date.localeCompare(b.date)
      return b.date.localeCompare(a.date)
    })
  }, [artworks, query, category, source, tagFilter, favoritesOnly, sort])

  const allTags = useMemo(() => [...new Set(artworks.flatMap((a) => a.tags ?? []))].sort(), [artworks])

  async function storeImage(id: string, dataUrl: string): Promise<void> {
    const res = await fetch(dataUrl)
    const blob = await res.blob()
    const { putImage } = await import('../services/artImages')
    await putImage(id, blob)
  }

  async function confirmImport(title: string) {
    if (!pending) return
    try {
      const created = await createArtwork({
        title: title.trim() || (language === 'en' ? 'Untitled artwork' : 'عمل بلا عنوان'),
        description: '',
        medium: '',
        date: todayKey(),
        imageUrl: pending.dataUrl,
        imagePath: null,
        source: pending.source,
        category: '',
        tags: [],
        favorite: false,
      })
      await storeImage(created.id, pending.dataUrl)
      setPending(null)
      setSelected(created)
    } catch (err) {
      setFileError(err instanceof Error ? err.message : 'Unable to save this artwork.')
    }
  }

  async function onPickFile(file: File | undefined, sourceKind: Artwork['source']) {
    setFileError('')
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setFileError(language === 'en' ? 'Please choose an image file.' : 'اختاري ملف صورة.')
      return
    }
    if (file.size > 6 * 1024 * 1024) {
      setFileError(language === 'en' ? 'Image is larger than 6 MB.' : 'الصورة أكبر من ٦ ميجابايت.')
      return
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('Unable to read this image.'))
      reader.readAsDataURL(file)
    })
    setPending({ dataUrl, source: sourceKind })
  }

  function openEdit(a: Artwork) {
    setSelected(a)
    setDraft({
      title: a.title,
      description: a.description ?? '',
      category: a.category ?? '',
      tags: (a.tags ?? []).join(', '),
    })
  }

  async function saveDraft() {
    if (!selected) return
    await updateArtwork(selected.id, {
      title: draft.title.trim() || selected.title,
      description: draft.description,
      category: draft.category,
      tags: draft.tags.split(',').map((s) => s.trim()).filter(Boolean),
    })
    setSelected(null)
  }

  async function toggleFavorite(a: Artwork) {
    await updateArtwork(a.id, { favorite: !a.favorite })
  }

  async function remove(a: Artwork) {
    await deleteArtwork(a.id)
    const { deleteImage } = await import('../services/artImages')
    await deleteImage(a.id)
    setSelected(null)
  }

  const categoryLabel = (key: string) => {
    const c = ART_CATEGORIES.find((cc) => cc.key === key)
    return c ? (language === 'en' ? c.en : c.ar) : key
  }

  return (
    <div className="page-stack">
      <div className="art-library__actions">
        <Button variant="primary" onClick={() => document.dispatchEvent(new CustomEvent('art-library:create-drawing'))}>
          {language === 'en' ? 'Create Drawing' : 'ارسمي هنا'}
        </Button>
        <Button variant="secondary" onClick={() => cameraRef.current?.click()}>
          {language === 'en' ? <><CameraIcon size={18} /> Take Photo</> : <>📷 صوّري رسمتك</>}
        </Button>
        <Button variant="secondary" onClick={() => importRef.current?.click()}>
          {language === 'en' ? 'Import Image' : 'استوردي صورة'}
        </Button>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void onPickFile(e.target.files?.[0], 'photo'); e.target.value = '' }} />
        <input ref={importRef} type="file" accept="image/*" hidden onChange={(e) => { void onPickFile(e.target.files?.[0], 'imported'); e.target.value = '' }} />
      </div>

      {fileError && <div className="notice-card">{fileError}</div>}

      <Card className="art-library__filters">
        <div className="art-library__filter-row">
          <label className="art-library__search">
            <SearchIcon size={18} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={language === 'en' ? 'Search titles and notes…' : 'ابحثي في العناوين والملاحظات…'}
              aria-label={language === 'en' ? 'Search artwork' : 'ابحثي في الأعمال'}
            />
          </label>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label={language === 'en' ? 'Category' : 'التصنيف'}>
            <option value="all">{language === 'en' ? 'All categories' : 'كل التصنيفات'}</option>
            {ART_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{language === 'en' ? c.en : c.ar}</option>)}
          </Select>
          <Select value={source} onChange={(e) => setSource(e.target.value as SourceFilter)} aria-label={language === 'en' ? 'Source' : 'المصدر'}>
            <option value="all">{language === 'en' ? 'All sources' : 'كل المصادر'}</option>
            <option value="drawn">{language === 'en' ? 'Drawn in app' : 'مرسوم داخل التطبيق'}</option>
            <option value="photo">{language === 'en' ? 'Camera photo' : 'صورة بالكاميرا'}</option>
            <option value="imported">{language === 'en' ? 'Imported image' : 'صورة مستوردة'}</option>
          </Select>
          <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={language === 'en' ? 'Sort' : 'الترتيب'}>
            <option value="recent">{language === 'en' ? 'Newest first' : 'الأحدث أولاً'}</option>
            <option value="oldest">{language === 'en' ? 'Oldest first' : 'الأقدم أولاً'}</option>
            <option value="title">{language === 'en' ? 'Title A–Z' : 'العنوان أ–ي'}</option>
          </Select>
          <button type="button" className={`icon-btn icon-btn--ghost ${favoritesOnly ? 'is-active' : ''}`} aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly((v) => !v)} title={language === 'en' ? 'Favorites only' : 'المفضلة فقط'}>
            <StarIcon size={18} filled={favoritesOnly} />
          </button>
        </div>
        {allTags.length > 0 && (
          <div className="art-library__tags">
            {allTags.map((tag) => (
              <button key={tag} type="button" className={`art-library__tag ${tagFilter === tag ? 'art-library__tag--active' : ''}`} onClick={() => setTagFilter((tt) => (tt === tag ? '' : tag))}>{tag}</button>
            ))}
          </div>
        )}
      </Card>

      {artworks.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ImageIcon size={40} />}
            title={language === 'en' ? 'Your Art Library is waiting' : 'مكتبة فنك مستنيكي'}
            message={language === 'en'
              ? 'Draw inside 4uLife, photograph a paper drawing, or import an image — everything lives here.'
              : 'ارسمي داخل 4uLife، أو صوّري رسمة على ورقة، أو استوردي صورة — كله هيتجمع هنا.'}
          />
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            title={language === 'en' ? 'No artwork matches your filters' : 'مفيش أعمال تطابق الفلاتر'}
            message={language === 'en' ? 'Try clearing the search or filters.' : 'جرّبي تمسحي البحث أو الفلاتر.'}
            action={<Button size="sm" onClick={() => { setQuery(''); setCategory('all'); setSource('all'); setTagFilter(''); setFavoritesOnly(false) }}>
              {language === 'en' ? 'Clear filters' : 'امسحي الفلاتر'}
            </Button>}
          />
        </Card>
      ) : (
        <div className="art-library__grid">
          {filtered.map((a) => (
            <article key={a.id} className="art-library__card">
              <button type="button" className="art-library__thumbbtn" onClick={() => openEdit(a)}>
                <ArtworkImage artwork={a} />
                <span className="art-library__cardsource">{sourceLabel(a)}</span>
                {a.favorite && <span className="art-library__cardfav"><StarIcon size={14} filled /></span>}
              </button>
              <div className="art-library__cardbody">
                <p className="art-library__cardtitle">{a.title}</p>
                <p className="art-library__cardmeta">
                  {a.category ? categoryLabel(a.category) : ''}
                  {a.tags?.length ? ` · ${a.tags.length}` : ''}
                </p>
                <div className="art-library__cardactions">
                  <IconButton size="sm" label={language === 'en' ? 'Favorite' : 'المفضلة'} onClick={() => { void toggleFavorite(a) }}>
                    <StarIcon size={15} filled={!!a.favorite} />
                  </IconButton>
                  <IconButton size="sm" label={language === 'en' ? 'Edit' : 'تعديل'} onClick={() => openEdit(a)}><EditIcon size={15} /></IconButton>
                  <IconButton size="sm" label={language === 'en' ? 'Delete' : 'حذف'} onClick={() => { void remove(a) }}><TrashIcon size={15} /></IconButton>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {pending && (
        <div className="art-library__previewbackdrop" role="dialog" aria-modal="true">
          <div className="art-library__preview">
            <h3>{language === 'en' ? 'Preview' : 'معاينة'}</h3>
            <img src={pending.dataUrl} alt="" />
            <div className="row row--end">
              <Button variant="ghost" onClick={() => setPending(null)}>{language === 'en' ? 'Cancel' : 'إلغاء'}</Button>
              <Button variant="primary" onClick={() => { void confirmImport('') }}>
                {language === 'en' ? 'Save to Library' : 'حفظ في المكتبة'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div className="art-library__previewbackdrop" role="dialog" aria-modal="true">
          <div className="art-library__preview art-library__preview--wide">
            <div className="row row--between">
              <h3>{language === 'en' ? 'Artwork details' : 'تفاصيل العمل'}</h3>
              <button type="button" className="icon-btn icon-btn--ghost" onClick={() => setSelected(null)} aria-label={language === 'en' ? 'Close' : 'إغلاق'}>
                <CloseIcon size={20} />
              </button>
            </div>
            <ArtworkImage artwork={selected} className="art-library__detailimg" />
            <div className="form-grid">
              <Field label={language === 'en' ? 'Title' : 'العنوان'}>
                <TextInput value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
              </Field>
              <Field label={language === 'en' ? 'Notes' : 'ملاحظات'}>
                <TextArea rows={3} value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} placeholder={language === 'en' ? 'Notes about this piece…' : 'ملاحظات عن العمل…'} />
              </Field>
              <Field label={language === 'en' ? 'Category' : 'التصنيف'}>
                <Select value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}>
                  <option value="">{language === 'en' ? 'Uncategorised' : 'بدون تصنيف'}</option>
                  {ART_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{language === 'en' ? c.en : c.ar}</option>)}
                </Select>
              </Field>
              <Field label={language === 'en' ? 'Tags (comma separated)' : 'وسوم (مفصولة بفاصلة)'}>
                <TextInput value={draft.tags} onChange={(e) => setDraft((d) => ({ ...d, tags: e.target.value }))} />
              </Field>
              <div className="row row--between">
                <p className="t-xs t-muted">{sourceLabel(selected)}</p>
                <div className="row">
                  <Button variant="ghost" onClick={() => setSelected(null)}>{language === 'en' ? 'Back' : 'رجوع'}</Button>
                  <Button variant="primary" onClick={() => { void saveDraft() }}>{language === 'en' ? 'Save' : 'حفظ'}</Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
