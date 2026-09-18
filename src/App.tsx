import { Route, Routes } from 'react-router-dom'
import AppShell from '@/components/AppShell'
import HomePage from '@/pages/HomePage'
import InspectionsPage from '@/pages/InspectionsPage'
import NewInspectionPage from '@/pages/NewInspectionPage'
import InspectionPage from '@/pages/InspectionPage'
import NotFoundPage from '@/pages/NotFoundPage'

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/inspections" element={<InspectionsPage />} />
        <Route path="/new" element={<NewInspectionPage />} />
        <Route path="/inspection/:id" element={<InspectionPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppShell>
  )
}
