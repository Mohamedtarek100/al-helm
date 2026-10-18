import { Route, Routes } from 'react-router-dom'
import { AppShell } from './app/AppShell'
import { HomePage } from './pages/HomePage'
import { TasksPage } from './pages/TasksPage'
import { SchedulePage } from './pages/SchedulePage'
import { FocusPage } from './pages/FocusPage'
import { StudioPage } from './pages/StudioPage'
import { ProgressPage } from './pages/ProgressPage'
import { NotificationsPage } from './pages/NotificationsPage'
import { SettingsPage } from './pages/SettingsPage'
import { ToastProvider } from './components/Toast'

function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="schedule" element={<SchedulePage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="focus" element={<FocusPage />} />
          <Route path="studio" element={<StudioPage />} />
          <Route path="progress" element={<ProgressPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<HomePage />} />
        </Route>
      </Routes>
    </ToastProvider>
  )
}

export default App
