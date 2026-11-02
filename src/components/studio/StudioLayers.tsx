import { useI18n } from '../../i18n/useI18n'
import { IconButton } from '../Button'
import { ChevronDownIcon, EyeIcon, EyeOffIcon, PlusIcon, TrashIcon, LockIcon, UnlockIcon, SaveIcon } from '../icons'
import type { DrawingDocument, DrawingLayer } from '../../services/drawing'

/**
 * Layer panel.
 *
 * Real layer management over the vector document: visibility, lock, ordering,
 * rename and delete. The list is rendered top-layer-first, which is the order
 * every raster editor uses — the array in the document is bottom-first because
 * that is the paint order.
 *
 * LOCKING is enforced by the canvas, not only displayed here: a locked layer
 * refuses strokes, so a background or a finished line art layer cannot be
 * damaged by a stray touch.
 */
export function LayersPanel({
  layers,
  activeId,
  doc,
  onSelect,
  onAdd,
  onDelete,
  onMove,
  onToggleVisible,
  onToggleLocked,
  onRename,
  onOpenNavigator,
  compact,
}: {
  layers: DrawingLayer[]
  activeId: string
  doc: DrawingDocument
  onSelect: (id: string) => void
  onAdd: () => void
  onDelete: (id: string) => void
  onMove: (id: string, direction: 1 | -1) => void
  onToggleVisible: (id: string) => void
  onToggleLocked: (id: string) => void
  onRename: (id: string, name: string) => void
  onOpenNavigator: () => void
  compact: boolean
}) {
  const { t } = useI18n()
  const fallbackLayerId = layers[0]?.id

  return (
    <section className={`studio-layers ${compact ? 'studio-layers--compact' : ''}`} aria-label={t('sketchLayers')}>
      <header className="studio-block__head">
        <h3 className="studio-block__title">{t('sketchLayers')}</h3>
        <div className="studio-block__tools">
          <IconButton label={t('studioNavigator')} size="sm" variant="quiet" onClick={onOpenNavigator}><SaveIcon size={15} /></IconButton>
          <IconButton label={t('sketchAddLayer')} size="sm" variant="secondary" onClick={onAdd}><PlusIcon size={15} /></IconButton>
        </div>
      </header>
      <ul className="studio-layerlist">
        {[...layers].reverse().map((layer) => {
          const index = layers.findIndex((entry) => entry.id === layer.id)
          const active = layer.id === activeId
          const elementTotal = doc.strokes.filter((element) => (element.layerId ?? fallbackLayerId) === layer.id).length
            + (doc.shapes ?? []).filter((element) => (element.layerId ?? fallbackLayerId) === layer.id).length
            + (doc.texts ?? []).filter((element) => (element.layerId ?? fallbackLayerId) === layer.id).length
          return (
            <li key={layer.id} className={`studio-layer ${active ? 'studio-layer--active' : ''}`}>
              <button
                type="button"
                className="studio-layer__main"
                aria-pressed={active}
                onClick={() => onSelect(layer.id)}
              >
                <span className="studio-layer__thumb" aria-hidden="true" data-count={elementTotal} style={{ background: layerTint(layers, doc, layer.id) }} />
                <span className="studio-layer__text">
                  <span className="studio-layer__name">{layer.name}</span>
                  <span className="studio-layer__meta">{elementTotal} {t('studioElements')}</span>
                </span>
              </button>
              <div className="studio-layer__actions">
                <IconButton
                  label={layer.locked ? t('studioUnlockLayer') : t('studioLockLayer')}
                  size="sm"
                  variant="quiet"
                  onClick={() => onToggleLocked(layer.id)}
                >
                  {layer.locked ? <LockIcon size={14} /> : <UnlockIcon size={14} />}
                </IconButton>
                <IconButton
                  label={layer.visible ? t('sketchHideLayer') : t('sketchShowLayer')}
                  size="sm"
                  variant="quiet"
                  onClick={() => onToggleVisible(layer.id)}
                >
                  {layer.visible ? <EyeIcon size={14} /> : <EyeOffIcon size={14} />}
                </IconButton>
                <IconButton label={t('sketchMoveLayerUp')} size="sm" variant="quiet" onClick={() => onMove(layer.id, 1)} disabled={index === layers.length - 1}>
                  <ChevronDownIcon size={13} className="studio-flip" />
                </IconButton>
                <IconButton label={t('sketchMoveLayerDown')} size="sm" variant="quiet" onClick={() => onMove(layer.id, -1)} disabled={index === 0}>
                  <ChevronDownIcon size={13} />
                </IconButton>
                <IconButton label={t('sketchDeleteLayer')} size="sm" variant="danger" onClick={() => onDelete(layer.id)} disabled={layers.length <= 1}>
                  <TrashIcon size={13} />
                </IconButton>
              </div>
              {active && (
                <input
                  className="studio-layer__rename"
                  value={layer.name}
                  maxLength={60}
                  aria-label={t('sketchLayerName')}
                  onChange={(event) => onRename(layer.id, event.currentTarget.value)}
                />
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/**
 * A representative thumbnail background for a layer.
 *
 * A real raster thumbnail would require re-rendering every layer into an
 * offscreen canvas on every list render, which is what made the old panel feel
 * slow on a phone. The thumbnail shows the layer's own ink over its paper: an
 * EMPTY layer reads as blank paper (not a grey blob), and a layer with content
 * reads as that content's colour.
 */
function layerTint(layers: DrawingLayer[], doc: DrawingDocument, layerId: string): string {
  const fallback = layers[0]?.id
  const colours = doc.strokes
    .filter((stroke) => (stroke.layerId ?? fallback) === layerId && !stroke.eraser)
    .map((stroke) => stroke.color)
  if (!colours.length) return '#fdf8ef'
  const ink = colours[colours.length - 1]
  return `linear-gradient(135deg, #fdf8ef 0%, #fdf8ef 34%, ${ink} 40%, ${ink} 100%)`
}
