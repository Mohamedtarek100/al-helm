import { Route, Routes } from 'react-router-dom'
import { useEffect } from 'react'
import { AppShell } from './app/AppShell'
import { HomePage } from './pages/HomePage'
import { TasksPage } from './pages/TasksPage'
import { SchedulePage } from './pages/SchedulePage'
import { FocusPage } from './pages/FocusPage'
import { StudioPage } from './pages/StudioPage'
import { ProgressPage } from './pages/ProgressPage'
import { NotificationsPage } from './pages/NotificationsPage'
import { CalendarPage } from './pages/CalendarPage'
import { SettingsPage } from './pages/SettingsPage'
import { ReviewPage } from './pages/ReviewPage'
import { ExamPage } from './pages/ExamPage'
import { ToastProvider } from './components/Toast'
import { AdminPage } from './pages/AdminPage'
import { ErrorBoundary } from './components/ErrorBoundary'
import { LockGate } from './app/LockGate'
import { initializeAndroidPush } from './services/androidPush'

/**
 * Application routes.
 *
 * NOTE: I18nProvider is intentionally NOT here. It is mounted in main.tsx,
 * above LaunchGate, so the first-launch WelcomePage (rendered outside App) is
 * inside the same i18n context. Adding a second provider here would nest two
 * independent subscription trees for the same settings.
 */
function App() {
  useEffect(() => {
    let active = true
    let removeListeners: (() => void) | null = null
    void initializeAndroidPush()
      .then((remove) => {
        if (active) removeListeners = remove
        else remove()
      })
      .catch((error: unknown) => console.error('Android push initialization failed.', error))
    return () => {
      active = false
      removeListeners?.()
    }
  }, [])

  return (
      <ToastProvider>
      <ErrorBoundary>
      {/*
        THE LOCK WRAPS THE ENTIRE ROUTER.

        It used to be a LAYOUT ROUTE (`<Route element={<LockGate><AppShell/></LockGate>}>`),
        which put it INSIDE the router. That had two consequences:

          - every navigation remounted the gate, so its in-memory
            `sessionLocked` flag could be lost, and
          - a route entry reached any other way was not guaranteed to pass
            through a locked state at all. Verified in the running app: loading
            with a PIN configured but deep-linking to `#/tasks` showed NO lock
            screen, and the Tasks page was fully interactive.

        Above the router there is exactly one gate, mounted for the whole
        session, and no route — direct link, deep link, back/forward, or
        programmatic — can render without passing it.
      */}
      <LockGate>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="schedule" element={<SchedulePage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="focus" element={<FocusPage />} />
          <Route path="studio" element={<StudioPage />} />
          <Route path="progress" element={<ProgressPage />} />
          <Route path="review" element={<ReviewPage />} />
          <Route path="exams" element={<ExamPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="admin" element={<AdminPage />} />
          <Route path="*" element={<HomePage />} />
        </Route>
      </Routes>
      </LockGate>
      </ErrorBoundary>
      </ToastProvider>
  )
}

export default App
