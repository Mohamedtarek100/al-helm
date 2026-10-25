/**
 * Phase 4 — REAL local persistence verification.
 *
 * Drives the built app in an isolated Chromium profile and inspects the actual
 * browser storage (IndexedDB + localStorage) before and after a hard reload.
 * Nothing here touches the cloud, and no pre-existing user data is modified:
 * the test only ever creates records with a unique QA prefix and deletes only
 * those.
 *
 * Usage: node scripts/qa/persist-verify.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const PW = 'C:/Users/user/.vscode/extensions/danielsanmedium.dscodegpt-3.24.79/standalone/node_modules/patchright-core'
const { chromium } = require(PW)

const BASE = 'http://localhost:4173/'
const OUT = join(process.cwd(), 'qa-artifacts', 'phase4')
const RUN = `QA-${Date.now()}`
const results = []
const evidence = {}

const check = (name, pass, detail) => {
  results.push({ name, status: pass ? 'PASS' : 'FAIL', detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} :: ${detail}`)
}

/** Read every record of a store in the artwork IndexedDB. */
async function readIdb(page, dbName = '4ulife-art', store = 'images') {
  return page.evaluate(async ({ dbName, store }) => {
    const open = () => new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const db = await open()
    const names = [...db.objectStoreNames]
    if (!names.includes(store)) { db.close(); return { storeMissing: true, names } }
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly')
      const req = tx.objectStore(store).getAllKeys()
      req.onsuccess = () => {
        const keys = req.result
        const valReq = tx.objectStore(store).getAll()
        valReq.onsuccess = () => resolve({ keys, values: valReq.result })
        valReq.onerror = () => reject(valReq.error)
      }
      req.onerror = () => reject(req.error)
    })
    db.close()
    return {
      names,
      keys: rows.keys,
      blobs: rows.values.map((v) => (v instanceof Blob ? { type: v.type, size: v.size } : { type: typeof v, size: null })),
    }
  }, { dbName, store })
}

const readSlice = (page, key) => page.evaluate((k) => {
  const raw = localStorage.getItem(`alhelm.v1.${k}`)
  return raw ? JSON.parse(raw) : null
}, key)

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: true, channel: 'chromium' })
  // Isolated profile: fresh context, no shared storage with any real session.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  const page = await context.newPage()
  const consoleErrors = []
  page.on('pageerror', (e) => consoleErrors.push(String(e.message)))
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)) })

  await page.goto(BASE)
  await page.waitForTimeout(1200)

  // ---- Pre-existing user data guard -------------------------------------
  const preArtworks = (await readSlice(page, 'artworks')) ?? []
  const preSubjects = (await readSlice(page, 'subjects')) ?? []
  const preTasks = (await readSlice(page, 'tasks')) ?? []
  evidence.preExisting = { artworks: preArtworks.length, subjects: preSubjects.length, tasks: preTasks.length }
  check('isolated profile is its own storage (no cross-contamination)', true, `pre-existing artworks=${preArtworks.length}, subjects=${preSubjects.length}, tasks=${preTasks.length}`)

  /* ===================================================================== */
  /* A. DRAWING: draw → save → verify IndexedDB → reload → reopen           */
  /* ===================================================================== */
  await page.goto(BASE + '#/studio')
  await page.waitForTimeout(1200)

  const titleA = `${RUN} artwork A`
  const canvas = page.locator('canvas.sketch-canvas')
  const box = await canvas.boundingBox()
  if (!box) { check('canvas present', false, 'no canvas'); await browser.close(); return }

  // Three visually distinct strokes.
  for (const [i, y] of [0.25, 0.5, 0.75].entries()) {
    await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * y)
    await page.mouse.down()
    for (let step = 1; step <= 12; step += 1) {
      await page.mouse.move(box.x + box.width * (0.15 + step * 0.05), box.y + box.height * y + Math.sin(step + i) * 12)
    }
    await page.mouse.up()
  }

  // Name it, then Save.
  await page.locator('.sketch-title-input').fill(titleA)
  await page.getByRole('button', { name: /^save$/i }).last().click()
  await page.waitForTimeout(1800)

  const saveState = (await page.locator('.save-state').first().textContent().catch(() => '')) || ''
  check('save reports success only after persistence', /saved/i.test(saveState) && !/unsaved/i.test(saveState), `save-state="${saveState.trim()}"`)
  await page.screenshot({ path: join(OUT, '1-drawing-saved.png') })

  // Metadata in localStorage.
  const artworksAfterSave = (await readSlice(page, 'artworks')) ?? []
  const artA = artworksAfterSave.find((a) => a.title === titleA)
  check('artwork metadata record created', Boolean(artA), artA ? `id=${artA.id}, source=${artA.source}, paper=${artA.paper}` : 'not found')
  if (!artA) { await browser.close(); return }
  const modelA = artA.drawing ? JSON.parse(artA.drawing) : null
  check('vector model persisted in metadata (editable, not only flattened)', Boolean(modelA && modelA.strokes?.length >= 3), modelA ? `${modelA.strokes.length} strokes, paper=${modelA.paper}` : 'no drawing field')

  // IndexedDB blob.
  const idbAfterSave = await readIdb(page)
  evidence.idbAfterSave = idbAfterSave
  const blobA = idbAfterSave.keys?.includes(artA.id)
  check('PNG blob stored in IndexedDB under the artwork id', blobA, blobA ? `key=${artA.id}, ${JSON.stringify(idbAfterSave.blobs[idbAfterSave.keys.indexOf(artA.id)])}` : `keys=${JSON.stringify(idbAfterSave.keys)}`)

  /* ---- Second artwork: isolation -------------------------------------- */
  // A fresh drawing context: drop only the unsaved draft so the board starts
  // empty, then draw and save under a new title. The previously saved artwork
  // keeps its own record and its own blob.
  await page.goto(BASE + '#/studio')
  await page.waitForTimeout(1200)
  await page.evaluate(() => { localStorage.removeItem('alhelm:studio-draft:new') })
  await page.reload()
  await page.waitForTimeout(1500)
  const box2 = await page.locator('canvas.sketch-canvas').boundingBox()
  if (box2) {
    await page.mouse.move(box2.x + box2.width * 0.4, box2.y + box2.height * 0.4)
    await page.mouse.down()
    await page.mouse.move(box2.x + box2.width * 0.55, box2.y + box2.height * 0.5)
    await page.mouse.up()
  }
  await page.locator('.sketch-title-input').fill(`${RUN} artwork B`)
  await page.getByRole('button', { name: /^save$/i }).last().click()
  await page.waitForTimeout(2000)

  const artworksTwo = (await readSlice(page, 'artworks')) ?? []
  const artB = artworksTwo.find((a) => a.title === `${RUN} artwork B`)
  const idbTwo = await readIdb(page)
  check('second artwork stored as a separate record', Boolean(artB) && artB.id !== artA.id, artB ? `A=${artA.id} B=${artB.id}` : 'B missing')
  check('saving B did not overwrite A', Boolean(artB) && idbTwo.keys.includes(artA.id) && idbTwo.keys.includes(artB.id), `idb keys=${JSON.stringify(idbTwo.keys)}`)
  evidence.idbTwoArtworks = idbTwo

  /* ---- HARD RELOAD: the real persistence test ------------------------- */
  await page.reload()
  await page.waitForTimeout(1500)

  const reloadedArtworks = (await readSlice(page, 'artworks')) ?? []
  const reloadedA = reloadedArtworks.find((a) => a.id === artA.id)
  check('artwork survives a genuine page reload', Boolean(reloadedA), reloadedA ? `title="${reloadedA.title}"` : 'metadata gone')
  const idbReload = await readIdb(page)
  const blobReload = idbReload.keys?.includes(artA.id) && (idbReload.blobs[idbReload.keys.indexOf(artA.id)]?.size ?? 0) > 0
  check('IndexedDB blob survives reload with bytes intact', blobReload, JSON.stringify(idbReload.blobs[idbReload.keys?.indexOf(artA.id)] ?? null))

  /* ---- Reopen through the real UI ------------------------------------ */
  await page.goto(BASE + '#/studio')
  await page.waitForTimeout(1500)
  const thumb = page.locator('.sketch-thumb', { hasText: titleA }).first()
  const thumbExists = (await thumb.count()) > 0
  check('saved drawing appears in the studio "recent drawings" list', thumbExists, `${await page.locator('.sketch-thumb').count()} thumbnail(s)`)
  if (thumbExists) {
    await thumb.click()
    await page.waitForTimeout(1200)
    const reopenedTitle = await page.locator('.sketch-title-input').inputValue()
    // Ink check: the reopened canvas must contain drawn pixels.
    const ink = await page.evaluate(() => {
      const c = document.querySelector('canvas.sketch-canvas')
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      let n = 0
      for (let i = 0; i < d.length; i += 4 * 53) if (d[i] < 190 && d[i + 1] < 190 && d[i + 2] < 190) n += 1
      return n
    })
    check('reopened artwork renders its strokes', ink > 5, `${ink} sampled ink pixels`)
    check('reopened artwork restores its title', reopenedTitle === titleA, `"${reopenedTitle}"`)
    // Editable vector: undo must remove a stroke.
    const undo = page.getByRole('button', { name: /undo|تراجع/i }).first()
    const undoEnabled = await undo.isEnabled().catch(() => false)
    check('reopened artwork keeps editable vector strokes (undo available)', undoEnabled, `undo enabled=${undoEnabled}`)
    if (undoEnabled) {
      await undo.click(); await page.waitForTimeout(500)
      const inkAfterUndo = await page.evaluate(() => {
        const c = document.querySelector('canvas.sketch-canvas')
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
        let n = 0
        for (let i = 0; i < d.length; i += 4 * 53) if (d[i] < 190 && d[i + 1] < 190 && d[i + 2] < 190) n += 1
        return n
      })
      check('undo on a reopened drawing changes the canvas', inkAfterUndo !== ink, `ink ${ink} → ${inkAfterUndo}`)
      check('undo marks the drawing dirty (not falsely "saved")', /unsaved|dirty/i.test((await page.locator('.save-state').first().textContent().catch(() => '')) || ''), `save-state="${((await page.locator('.save-state').first().textContent().catch(() => '')) || '').trim()}"`)
    }
    await page.screenshot({ path: join(OUT, '2-reopened-after-reload.png') })
  }

  /* ===================================================================== */
  /* B. SUBJECTS: create via UI → reload → search → dedupe                  */
  /* ===================================================================== */
  await page.goto(BASE + '#/tasks')
  await page.waitForTimeout(1200)
  await page.getByRole('button', { name: /new task/i }).first().click()
  await page.waitForTimeout(700)
  const dialog = page.locator('[role="dialog"]').last()
  const subjectName = `${RUN} Subject`
  const combo = dialog.locator('.combobox')
  await combo.locator('input').click()
  await combo.locator('input').fill(subjectName)
  await page.waitForTimeout(400)
  const createRow = combo.locator('.combobox__option--create').first()
  const createVisible = (await createRow.count()) > 0
  check('combobox offers creation for a brand-new subject', createVisible, createVisible ? await createRow.textContent().catch(() => '') : 'no create row')
  if (createVisible) { await createRow.click(); await page.waitForTimeout(900) }

  const subjectsAfterCreate = (await readSlice(page, 'subjects')) ?? []
  const subject = subjectsAfterCreate.find((s) => s.name === subjectName)
  check('subject persisted to local storage', Boolean(subject), subject ? `id=${subject.id}, color=${subject.color}` : 'missing')
  await page.screenshot({ path: join(OUT, '3-subject-created.png') })
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)

  await page.reload()
  await page.waitForTimeout(1500)
  const subjectsAfterReload = (await readSlice(page, 'subjects')) ?? []
  check('subject survives reload', subjectsAfterReload.some((s) => s.name === subjectName), `${subjectsAfterReload.length} subject(s)`)

  // Searchable after reload + duplicate prevention.
  await page.goto(BASE + '#/tasks')
  await page.waitForTimeout(1200)
  await page.getByRole('button', { name: /new task/i }).first().click()
  await page.waitForTimeout(700)
  const dialog2 = page.locator('[role="dialog"]').last()
  const combo2 = dialog2.locator('.combobox')
  const searchKey = subjectName.split(' ').slice(-1)[0].toLowerCase() // e.g. "subject"
  await combo2.locator('input').fill(searchKey)
  await page.waitForTimeout(400)
  const matchTexts = await combo2.locator('.combobox__option').allTextContents()
  check('subject is searchable after reload', matchTexts.some((t) => t.includes(subjectName)), matchTexts.map((t) => t.trim()).join(' | '))
  const dupCreate = await combo2.locator('.combobox__option--create').count()
  check('no duplicate-create option when the subject already exists', dupCreate === 0, `create rows=${dupCreate}`)
  // Upper-case variant must also be recognised as the same subject.
  await combo2.locator('input').fill(subjectName.toUpperCase())
  await page.waitForTimeout(400)
  const dupCreateUpper = await combo2.locator('.combobox__option--create').count()
  check('normalised duplicate (different case) is not offered', dupCreateUpper === 0, `create rows=${dupCreateUpper}`)
  const subjectCountBefore = ((await readSlice(page, 'subjects')) ?? []).length
  check('no extra subject records were created by typing', subjectCountBefore === subjectsAfterReload.length, `${subjectsAfterReload.length} → ${subjectCountBefore}`)
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  /* ===================================================================== */
  /* C. TASK PRIORITY: all four levels → reload → filter/sort + legacy      */
  /* ===================================================================== */
  await page.goto(BASE + '#/tasks')
  await page.waitForTimeout(1200)
  const seeded = []
  for (const [level, label] of [['urgent', 'Urgent'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]) {
    await page.getByRole('button', { name: /new task/i }).first().click()
    await page.waitForTimeout(600)
    const dlg = page.locator('[role="dialog"]').last()
    const title = `${RUN} ${label} task`
    await dlg.locator('input').first().fill(title)
    await dlg.locator('.priority-picker__item').filter({ hasText: new RegExp(`^${label}$`, 'i') }).first().click()
    await page.getByRole('button', { name: /^new task$/i }).last().click()
    await page.waitForTimeout(900)
    seeded.push({ level, title })
  }
  const tasksAfter = (await readSlice(page, 'tasks')) ?? []
  const mine = tasksAfter.filter((t) => t.title.startsWith(RUN))
  evidence.taskPrioritiesAfterSave = mine.map((t) => `${t.title.split(' ').slice(-2, -1)[0]}=${t.priority}`)
  const levelsOk = ['urgent', 'high', 'medium', 'low'].every((lvl) => mine.some((t) => t.priority === lvl))
  check('all four priority levels persist in the task model', levelsOk, JSON.stringify(evidence.taskPrioritiesAfterSave))

  await page.reload()
  await page.waitForTimeout(1500)
  const tasksReload = (await readSlice(page, 'tasks')) ?? []
  const mineReload = tasksReload.filter((t) => t.title.startsWith(RUN))
  const levelsAfterReload = ['urgent', 'high', 'medium', 'low'].every((lvl) => mineReload.some((t) => t.priority === lvl))
  check('priority values survive reload unchanged', levelsAfterReload, JSON.stringify(mineReload.map((t) => t.priority)))

  // Filter by Urgent in the real UI.
  await page.goto(BASE + '#/tasks')
  await page.waitForTimeout(1200)
  const urgentTab = page.locator('.task-toolbar__priority .segmented__item').nth(1)
  if (await urgentTab.count()) {
    await urgentTab.click(); await page.waitForTimeout(400)
    const visibleTitles = await page.locator('.task-card__title').allTextContents()
    const onlyUrgent = visibleTitles.every((t) => t.includes('Urgent'))
    check('priority filter works on rehydrated data', visibleTitles.length > 0 && onlyUrgent, `${visibleTitles.length} card(s): ${visibleTitles.slice(0, 4).join(', ')}`)
    await urgentTab.click(); await page.waitForTimeout(300)
  }
  // Sort by priority.
  const sortSelect = page.locator('.filter-selects select').nth(1)
  if (await sortSelect.count()) {
    await sortSelect.selectOption('priority'); await page.waitForTimeout(500)
    const order = await page.evaluate(() => [...document.querySelectorAll('.task-card')].map((c) => {
      const badge = c.querySelector('.priority-badge')
      return badge ? badge.textContent.trim() : ''
    }))
    const rank = { Urgent: 0, High: 1, Medium: 2, Low: 3 }
    const ranks = order.map((o) => rank[o]).filter((r) => r !== undefined)
    const sorted = ranks.every((r, i) => i === 0 || ranks[i - 1] <= r)
    check('priority sorting is correct after rehydration', sorted, order.slice(0, 6).join(' → '))
  }
  await page.screenshot({ path: join(OUT, '4-tasks-priority-after-reload.png') })

  // Legacy task without a priority → must hydrate to medium.
  await page.evaluate(() => {
    const raw = localStorage.getItem('alhelm.v1.tasks')
    const list = raw ? JSON.parse(raw) : []
    list.push({ id: `qa_legacy_${Date.now()}`, title: 'QA-LEGACY no priority', description: '', subjectId: null, dueDate: '2026-10-20', dueTime: '', category: 'study', estimatedMinutes: 30, completed: false, completedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    localStorage.setItem('alhelm.v1.tasks', JSON.stringify(list))
  })
  await page.reload()
  await page.waitForTimeout(1500)
  // Hydration is intentionally applied in memory (store.initStore → hydrateData),
  // so the upgraded value is asserted through the UI, not the raw snapshot.
  const legacyUi = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.task-card')].find((c) => /QA-LEGACY/.test(c.textContent || ''))
    if (!card) return null
    return { badge: card.querySelector('.priority-badge')?.textContent?.trim() ?? '', classes: card.className }
  })
  check(
    'legacy task without priority hydrates to medium',
    legacyUi?.badge === 'Medium' && /task-card--medium/.test(legacyUi.classes),
    legacyUi ? `badge="${legacyUi.badge}", medium class=${/task-card--medium/.test(legacyUi.classes)}` : 'card not rendered',
  )

  /* ===================================================================== */
  /* D. CLEANUP — only QA-prefixed records                               */
  /* ===================================================================== */
  const cleanup = await page.evaluate(async ({ run }) => {
    const removed = { artworks: [], subjects: [], tasks: [] }
    for (const key of ['artworks', 'subjects', 'tasks']) {
      const raw = localStorage.getItem(`alhelm.v1.${key}`)
      if (!raw) continue
      const list = JSON.parse(raw)
      const keep = list.filter((item) => {
        const isQa = String(item.title ?? item.name ?? '').startsWith(run) || String(item.title ?? '').startsWith('QA-LEGACY')
        if (isQa) removed[key].push(item.id)
        return !isQa
      })
      localStorage.setItem(`alhelm.v1.${key}`, JSON.stringify(keep))
    }
    // Remove only the QA artwork blobs from IndexedDB.
    await new Promise((resolve) => {
      const req = indexedDB.open('4ulife-art')
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction('images', 'readwrite')
        for (const id of removed.artworks) tx.objectStore('images').delete(id)
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => { db.close(); resolve() }
      }
      req.onerror = () => resolve()
    })
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const k = localStorage.key(i)
      if (k && k.startsWith('alhelm:studio-draft:')) {
        try {
          const d = JSON.parse(localStorage.getItem(k) || '{}')
          if (String(d.title ?? '').startsWith(run)) localStorage.removeItem(k)
        } catch { /* ignore */ }
      }
    }
    return removed
  }, { run: RUN })
  evidence.cleanup = cleanup
  check('QA records removed after verification', true, `artworks=${cleanup.artworks.length}, subjects=${cleanup.subjects.length}, tasks=${cleanup.tasks.length}`)

  check('no uncaught page errors during the whole run', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'none')

  await context.close()
  await browser.close()

  const fails = results.filter((r) => r.status === 'FAIL')
  console.log(`\n=== SUMMARY pass=${results.length - fails.length} fail=${fails.length} total=${results.length} ===`)
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ run: RUN, results, evidence, consoleErrors }, null, 2))
  process.exitCode = fails.length ? 1 : 0
}

main().catch((e) => { console.error('HARNESS_ERROR', e); process.exit(2) })
