import { Route, Routes } from 'react-router-dom'
import AppShell from '@/components/AppShell'
import HomePage from '@/pages/HomePage'
import InspectionsPage from '@/pages/InspectionsPage'
import NewInspectionPage from '@/pages/NewInspectionPage'
import InspectionPage from '@/pages/InspectionPage'
import NotFoundPage from '@/pages/NotFoundPage'
import { SessionProvider } from '@/features/auth/session'
import { useSync } from '@/features/auth/useSync'

/** Mounted once so the outbox drains app-wide, wherever the rep happens to be. */
function SyncRunner() {
  useSync()
  return null
}

export default function App() {
  return (
    <SessionProvider>
      <SyncRunner />
      <AppShell>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/inspections" element={<InspectionsPage />} />
          <Route path="/new" element={<NewInspectionPage />} />
          <Route path="/inspection/:id" element={<InspectionPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AppShell>
    </SessionProvider>
  )
}
