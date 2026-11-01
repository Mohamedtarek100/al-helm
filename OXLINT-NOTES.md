# Remaining lint warnings — reviewed and intentionally retained

`npm run lint` (`oxlint src`) reports **11 warnings, 0 errors**. Every one was
reviewed individually. None indicates a defect: each is a deliberate,
load-bearing pattern that cannot be "fixed" without breaking behaviour or
introducing a larger hazard. Nothing is suppressed — the warnings stay visible
so a genuine regression of the same kind is still noticed.

## 1. `react(refs)` — "Cannot access refs during render" (8)

The React Compiler rule flags writing `ref.current` in the render body. Every
occurrence is the **latest-value ref** idiom, used to keep an event handler,
timer callback or subscription stable while always seeing current values.

| File | Line | Why the ref write must happen during render |
| --- | --- | --- |
| `components/Modal.tsx` | 39 | `onCloseRef.current = onClose` keeps the open/close lifecycle effect from re-running when the caller passes a fresh inline callback (re-running restores/stores focus and breaks typing mid-word). Moving it to an effect would apply the *previous* callback for one frame during Escape. |
| `components/SketchCanvas.tsx` | 93, 95, 97 | `docRef`, `savedIdRef`, `titleRef` mirror `doc`/`savedId`/`title` so pointer handlers and debounce timers read current drawing state without re-subscribing on every keystroke. |
| `components/SketchCanvas.tsx` | 433 | `captureRef.current = capture` — the fix that stopped Save using a capture closure from first render (stale language). |
| `components/SketchCanvas.tsx` | 488, 490 | `saveRef` / `saveRefSilent` mirror the current `save` so the autosave timer always calls the newest implementation. |

`SketchCanvas.tsx:95/97` are the same read-mirror pattern for `savedId` and
`title`; there is no state update involved, only reads of the latest props.
The alternative (putting these values in dependencies) would re-create handlers
mid-stroke and lose pointer capture.

## 2. `react(only-export-components)` — Fast Refresh (3)

Flagged where a **hook is co-located with the provider/component that owns the
same context**. Splitting them into separate modules would fragment a context
that is only ever used together, for a development-time HMR nicety:

| File | Export | Reason |
| --- | --- | --- |
| `services/guest.tsx:33` | `useGuestContext` | The hook and `AnonymousGuestProvider` share one `Context` object; both must live where it is defined. |
| `pages/ArtLibrary.tsx:36` | `useArtworkImage` | `ART_CATEGORIES` (line 14) is a constant table used only by `ArtLibrary()`. |
| `components/Priority.tsx:61` | `useSaveAction` | `SaveState` (line 54) is the hook's own return type. |

Note: the same rule was **fixed, not suppressed**, for the admin console —
`prefersReducedMotion`/`fadeRise` were moved out of `components/admin/AdminUI.tsx`
into `components/admin/motion.ts`, so every new admin module exports components
or hooks only.

## 3. Rules that were enforced, not relaxed

Nothing was added to `.oxlintrc.json` during this work, and no
`// oxlint-disable` / `// eslint-disable` comment was introduced for the
warnings above. The only suppressions that exist in the tree are pre-existing
and each carries a justification inline (e.g. `adminData.ts` uses none at all —
the variable-arity dependency array that previously needed one was removed by
keying on a serialised dependency list instead).
