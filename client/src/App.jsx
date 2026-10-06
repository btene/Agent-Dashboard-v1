import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import AgentsPage from './pages/AgentsPage.jsx';
import AgentDetailPage from './pages/AgentDetailPage.jsx';
import RunsPage from './pages/RunsPage.jsx';
import RunDetailPage from './pages/RunDetailPage.jsx';
import AnalyticsPage from './pages/AnalyticsPage.jsx';
import ConnectionsPage from './pages/ConnectionsPage.jsx';
import LinkedDashboardPage from './pages/LinkedDashboardPage.jsx';
import { useLiveEvents } from './lib/hooks.js';
import { postToParent } from './lib/bridge.js';

export default function App() {
  // Forward run outcomes to a parent dashboard when embedded.
  useLiveEvents((e) => {
    if (['run.succeeded', 'run.failed', 'run.cancelled', 'run.started'].includes(e.type)) postToParent(e.type, e.data);
  });
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/agents" replace />} />
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
