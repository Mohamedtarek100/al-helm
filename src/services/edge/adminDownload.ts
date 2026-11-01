/**
 * Downloads a generated CSV document.
 *
 * Uses a short-lived object URL that is revoked immediately: a privileged
 * export should not linger in memory longer than the save prompt takes.
 * Falls back to reporting failure rather than silently doing nothing — a
 * "downloaded" toast that never produced a file is a lie.
 */
export function downloadCsv(filename: string, csv: string): boolean {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return false
  try {
    // BOM so Excel opens UTF-8 (Arabic names included) as UTF-8.
    const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()
    // Revoke on the next tick so the click has been handled.
    setTimeout(() => URL.revokeObjectURL(url), 0)
    return true
  } catch {
    return false
  }
}

/** A stable, sortable filename for an owner export. */
export function exportFilename(prefix: string, at: Date = new Date()): string {
  const stamp = at.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `${prefix}-${stamp}.csv`
}
