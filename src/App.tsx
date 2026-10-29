import { Route, Routes } from 'react-router-dom'
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

/**
 * Application routes.
 *
 * NOTE: I18nProvider is intentionally NOT here. It is mounted in main.tsx,
 * above LaunchGate, so the first-launch WelcomePage (rendered outside App) is
 * inside the same i18n context. Adding a second provider here would nest two
 * independent subscription trees for the same settings.
 */
function App() {
  return (
      <ToastProvider>
      <ErrorBoundary>
      <Routes>
        {/* The lock is an overlay inside the shell, so unlocking returns to the
            exact screen instead of remounting the route. */}
        <Route element={<LockGate><AppShell /></LockGate>}>
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
      </ErrorBoundary>
      </ToastProvider>
  )
}

export default App
