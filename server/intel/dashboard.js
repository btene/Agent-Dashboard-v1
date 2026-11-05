// Business-owner dashboard metrics. Live records only; demo data never counts.
import { tierFor } from './scoring.js';

export function computeDashboard({ store, settings, days = 30 }) {
  const since = Date.now() - days * 86_400_000;
  const live = store.list('projects').filter((p) => p.environment === 'live');
  const emails = store.list('emails').filter((e) => e.environment !== 'demo');
  const contacts = store.list('contacts').filter((c) => c.environment === 'live');
  const activities = store.list('activities');
  const minScore = settings.scoring?.minScoreForOutreach || 60;

  const newVerified = live.filter((p) => Date.parse(p.firstSeenAt) >= since && p.verification?.status === 'verified' && !p.classification?.excluded);
  const highPriority = live.filter((p) => (p.score?.total || 0) >= Math.max(minScore, 75) && !p.classification?.excluded && !['lost', 'not_a_fit', 'awarded'].includes(p.stage));
  const needVerification = live.filter((p) => !['verified'].includes(p.verification?.status) || (p.lastVerifiedAt && Date.parse(p.lastVerifiedAt) < Date.now() - 30 * 86_400_000));
  const decisionMakers = contacts.filter((c) => c.email || c.phone);
  const awaiting = emails.filter((e) => e.status === 'pending_approval' || e.status === 'approved');
  const sent = emails.filter((e) => ['sent', 'replied'].includes(e.status) && Date.parse(e.sentAt || e.updatedAt) >= since);
  const replies = emails.filter((e) => e.status === 'replied');
  const bids = live.filter((p) => ['bid_submitted', 'awarded', 'lost'].includes(p.stage));
  const awarded = live.filter((p) => p.stage === 'awarded');
  // Pipeline value: only amounts a person entered (bid or contract). Permit valuation is the whole building, not the landscape contract, so it is reported separately and labelled.
  const pipelineValue = live.filter((p) => ['contacted', 'replied', 'bid_submitted'].includes(p.stage)).reduce((s, p) => s + (p.bidAmount || 0), 0);
  const contractValue = awarded.reduce((s, p) => s + (p.contractValue || 0), 0);
  const permitValuationOfOpen = highPriority.reduce((s, p) => s + (p.valuation || 0), 0);

  const metrics = [
    { key: 'new_verified', label: 'New verified projects', value: newVerified.length, hint: `Found in the last ${days} days from official sources`, filter: { recentDays: days, verified: true } },
    { key: 'high_priority', label: 'High-priority landscaping opportunities', value: highPriority.length, hint: 'Score 75 or higher and still open', filter: { tier: 'high', open: true } },
    { key: 'needs_verification', label: 'Projects requiring verification', value: needVerification.length, hint: 'Source unavailable, not found, or not re-checked in 30 days', filter: { needsVerification: true } },
    { key: 'decision_makers', label: 'Decision-makers identified', value: decisionMakers.length, hint: 'Contacts with an email or phone', link: '/crm' },
    { key: 'emails_awaiting', label: 'Emails awaiting approval', value: awaiting.length, hint: 'Drafts waiting for you, plus approved but unsent', link: '/outreach?status=pending_approval,approved' },
    { key: 'emails_sent', label: 'Emails sent', value: sent.length, hint: `Last ${days} days`, link: '/outreach?status=sent,replied' },
    { key: 'replies', label: 'Replies received', value: replies.length, hint: 'Marked as replied', link: '/outreach?status=replied' },
    { key: 'bids', label: 'Bids submitted', value: bids.length, hint: 'Projects at bid or beyond', filter: { stage: 'bid_submitted,awarded,lost' } },
    { key: 'awarded', label: 'Contracts awarded', value: awarded.length, hint: 'Projects marked awarded', filter: { stage: 'awarded' } },
    { key: 'pipeline_value', label: 'Estimated pipeline value', value: pipelineValue, format: 'usd', hint: pipelineValue ? 'Sum of your submitted bid amounts on open projects' : 'Enter bid amounts on projects to see this. Permit valuations are not used because they describe the whole building.', filter: { stage: 'contacted,replied,bid_submitted' } },
  ];

  const map = live.filter((p) => p.lat != null && p.lon != null && !p.classification?.excluded).map((p) => ({ id: p.id, lat: p.lat, lon: p.lon, name: p.displayName, score: p.score?.total || 0, tier: p.tier || tierFor(p.score?.total || 0).key, city: p.city, valuation: p.valuation, status: p.status, stage: p.stage }));

  const liveSources = store.list('sources');
  const connected = liveSources.filter((s) => s.status === 'connected').length;
  const dataNotice = live.length ? null : connected ? 'Connected sources have not returned any commercial permits yet. Run "Automatic permit monitoring" from the Control Center.' : 'No live data yet. Connect a permit source under Integrations and run it, or import a permitted export. Until then only clearly labelled demo projects exist.';

  return { days, metrics, map, totals: { liveProjects: live.length, demoProjects: store.list('projects').length - live.length, contractValue, permitValuationOfOpen }, dataNotice, generatedAt: new Date().toISOString() };
}
