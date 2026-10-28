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
import { I18nProvider } from './i18n/I18nProvider'
import { AdminPage } from './pages/AdminPage'
import { ErrorBoundary } from './components/ErrorBoundary'
import { LockGate } from './app/LockGate'

function App() {
  return (
    <I18nProvider>
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
    </I18nProvider>
  )
}

export default App
