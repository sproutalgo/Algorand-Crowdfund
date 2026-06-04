import React, { useEffect } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { ToastProvider } from './context/ToastContext'
import Layout from './components/Layout'
import Home from './pages/Home'
import ProjectDetail from './pages/ProjectDetail'
import CreateProject from './pages/CreateProject'
import MyProjects from './pages/MyProjects'
import AdminDashboard from './pages/AdminDashboard'
import CleanupWallet from './pages/CleanupWallet'
import FAQ          from './pages/FAQ'
import PrivacyPolicy from './pages/PrivacyPolicy'
import Terms         from './pages/Terms'
import DemoProject   from './pages/DemoProject'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname])
  return null
}

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <ScrollToTop />
        <Layout>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/project/demo" element={<DemoProject />} />
            <Route path="/project/:appId" element={<ProjectDetail />} />
            <Route path="/create" element={<CreateProject />} />
            <Route path="/my-projects" element={<MyProjects />} />
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/cleanup" element={<CleanupWallet />} />
            <Route path="/faq"     element={<FAQ />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/terms"   element={<Terms />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </ToastProvider>
  )
}
