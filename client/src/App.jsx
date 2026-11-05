import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import AgentsPage from './pages/AgentsPage.jsx';
import AgentDetailPage from './pages/AgentDetailPage.jsx';
import RunsPage from './pages/RunsPage.jsx';
import RunDetailPage from './pages/RunDetailPage.jsx';
import AnalyticsPage from './pages/AnalyticsPage.jsx';
import ConnectionsPage from './pages/ConnectionsPage.jsx';
import LinkedDashboardPage from './pages/LinkedDashboardPage.jsx';
import HomePage from './pages/HomePage.jsx';
import ProjectsPage from './pages/ProjectsPage.jsx';
import ProjectDetailPage from './pages/ProjectDetailPage.jsx';
import AutomationsPage from './pages/AutomationsPage.jsx';
import IntegrationsPage from './pages/IntegrationsPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import OutreachPage from './pages/OutreachPage.jsx';
import CrmPage from './pages/CrmPage.jsx';
import DocumentsPage from './pages/DocumentsPage.jsx';
import OnboardingPage from './pages/OnboardingPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import CompanyPage from './pages/CompanyPage.jsx';
import { useLiveEvents } from './lib/hooks.js';
import { postToParent } from './lib/bridge.js';

export default function App() {
  useLiveEvents((e) => {
    if (['run.succeeded', 'run.failed', 'run.cancelled', 'run.started', 'project.created', 'email.sent'].includes(e.type)) postToParent(e.type, e.data);
  });
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/setup" element={<OnboardingPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:id" element={<ProjectDetailPage />} />
        <Route path="/automations" element={<AutomationsPage />} />
        <Route path="/integrations" element={<IntegrationsPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/outreach" element={<OutreachPage />} />
        <Route path="/crm" element={<CrmPage />} />
        <Route path="/companies/:id" element={<CompanyPage />} />
        <Route path="/documents" element={<DocumentsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/agents/:id" element={<AgentDetailPage />} />
        <Route path="/runs" element={<RunsPage />} />
        <Route path="/runs/:id" element={<RunDetailPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/connections" element={<ConnectionsPage />} />
        <Route path="/linked/:id" element={<LinkedDashboardPage />} />
        <Route path="*" element={<div className="empty"><h2>Page not found</h2></div>} />
      </Routes>
    </Layout>
  );
}
