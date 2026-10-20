/**
 * Export / import service — "نسخة احتياطية" in settings.
 *
 * Phase 1 exports the local snapshot as JSON. Phase 2 will additionally offer
 * a cloud backup once Supabase persistence is live; the UI already labels
 * which one is which.
 */

import type { AppData } from '../../types'
import { hydrateData } from '../domain'
import { getState, replaceState } from '../store'

/* Note: this module is imported lazily from the settings screen so the
 * store and domain modules are never pulled into an eager chunk twice. */

export const EXPORT_VERSION = 1

export interface ExportEnvelope {
  app: 'alhelm'
  version: number
  exportedAt: string
  storage: 'local' | 'cloud'
  data: AppData
}

export function buildExportEnvelope(): ExportEnvelope {
  const state = getState()
  return {
    app: 'alhelm',
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    storage: 'local',
    data: state,
  }
}

export function downloadBackup(): string {
  const envelope = buildExportEnvelope()
  const json = JSON.stringify(envelope, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const stamp = new Date().toISOString().slice(0, 10)
  const link = document.createElement('a')
  link.href = url
  link.download = `alhelm-backup-${stamp}.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return link.download
}

export class ImportError extends Error {}

/** Parses and applies a backup file. Throws `ImportError` with Arabic copy. */
export async function importBackup(file: File): Promise<void> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    throw new ImportError('الملف مش ملف نسخة احتياطية صالح.')
  }

  const candidate = parsed as Partial<ExportEnvelope> & { data?: Partial<AppData> }
  if (candidate?.app !== 'alhelm' || typeof candidate.version !== 'number' || !candidate.data || typeof candidate.data !== 'object') {
    throw new ImportError('محتوى الملف غير متوقع.')
  }
  await replaceState(hydrateData(candidate.data))
}
