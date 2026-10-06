import { useParams } from 'react-router-dom';
import { useApi } from '../lib/hooks.js';
import { ErrorBox } from '../components/ui.jsx';

export default function LinkedDashboardPage() {
  const { id } = useParams();
  const list = useApi('/dashboards');
  const dash = list.data?.find((x) => x.id === id);
  if (list.error) return <ErrorBox error={list.error} />;
  if (!list.data) return <div className="muted">Loading…</div>;
  if (!dash) return <ErrorBox error={new Error('Linked dashboard not found')} />;
  return (
    <>
      <div className="page-header">
        <div><h1>{dash.icon} {dash.name}</h1>{dash.description && <p>{dash.description}</p>}</div>
        <a className="btn" href={dash.url} target="_blank" rel="noreferrer">Open in new tab ↗</a>
      </div>
      <iframe className="frame" src={dash.url} title={dash.name} />
    </>
  );
}
