// Single settings document: company profile, territory, automation switches,
// operating mode, email account, scoring preferences, onboarding progress.

export const AUTOMATIONS = [
  { id: 'permit_monitoring', label: 'Automatic permit monitoring', description: 'Checks connected permit databases for new or changed commercial permits.', manualSafe: true },
  { id: 'project_discovery', label: 'Construction project discovery', description: 'Turns new permits into project records, classifies them and scores them for landscaping fit.', manualSafe: true },
  { id: 'constructconnect_import', label: 'ConstructConnect imports', description: 'Processes exports you upload from ConstructConnect and keeps their records current.', manualSafe: true },
  { id: 'other_platform_integrations', label: 'Other construction platform integrations', description: 'Processes exports from other licensed providers (Dodge, county portals).', manualSafe: true },
  { id: 'developer_research', label: 'Developer and property owner research', description: 'Flags projects whose developer, owner or contractor is unknown so they can be researched. No outside research provider is connected yet, so this creates research tasks rather than filling names in.', manualSafe: true },
  { id: 'contact_enrichment', label: 'Contact information enrichment', description: 'Finds email addresses and phone numbers for identified decision-makers. Requires a connected enrichment provider; until one is connected this only reports what is missing.', manualSafe: true },
  { id: 'ai_email_drafting', label: 'AI email drafting', description: 'Writes a first-draft outreach email for high-priority projects that have a contact. Drafts always wait for your approval unless the mode below says otherwise.', manualSafe: true },
  { id: 'email_sending', label: 'Automated email sending', description: 'Sends approved emails from your connected account. Off by default — turn it on only when you are ready.', manualSafe: false },
  { id: 'follow_up_reminders', label: 'Follow-up reminders', description: 'Creates a reminder when a sent email has had no reply for a set number of days.', manualSafe: true },
  { id: 'crm_sync', label: 'CRM synchronization', description: 'Keeps the built-in CRM (companies, contacts, pipeline) in step with projects and emails, and pushes changes to webhooks you have configured.', manualSafe: true },
];

export const MODES = {
  manual: { label: 'Manual', description: 'Nothing runs on its own. You start every check, every draft and every email yourself.' },
  semi_automatic: { label: 'Semi-automatic', description: 'Project discovery, research and email drafting run automatically. Every email waits for your approval before it is sent.' },
  automatic: { label: 'Automatic', description: 'Approved workflows run on the rules you set. Emails that meet your rules are sent without a per-email approval.' },
};

export const ONBOARDING_STEPS = [
  { id: 'company', title: 'Company details and service territory', optional: false },
  { id: 'documents', title: 'Upload licenses, insurance and capability documents', optional: true },
  { id: 'email', title: 'Connect an email account', optional: true },
  { id: 'sources', title: 'Select permit databases and construction sources', optional: false },
  { id: 'preferences', title: 'Configure project preferences and lead scoring', optional: true },
  { id: 'tone', title: 'Choose the email outreach tone', optional: true },
  { id: 'review', title: 'Review the first verified projects', optional: false },
  { id: 'campaign', title: 'Approve the first outreach campaign', optional: true },
];

export function defaultSettings() {
  return {
    id: 'settings',
    company: {
      name: 'Advanced Landscape 2000',
      legalName: '',
      website: '',
      phone: '',
      address: '',
      senderName: '',
      senderTitle: '',
      services: ['Commercial landscape construction', 'Ongoing commercial landscape maintenance'],
      summary: 'We handle commercial landscape construction and ongoing maintenance throughout Southern California.',
    },
    territory: {
      description: 'Santa Barbara through San Bernardino, including relevant cities within the service territory',
      counties: ['Santa Barbara', 'Ventura', 'Los Angeles', 'San Bernardino', 'Orange'],
      preferredCities: ['Los Angeles', 'Santa Barbara', 'San Bernardino', 'Ventura', 'Oxnard', 'Thousand Oaks', 'Pasadena', 'Burbank', 'Glendale', 'Long Beach', 'Riverside', 'Ontario', 'Rancho Cucamonga', 'Fontana', 'Santa Clarita', 'Anaheim', 'Irvine'],
      mapCenter: { lat: 34.25, lon: -118.4 },
      mapZoom: 8,
    },
    scoring: { minValuation: 250_000, minScoreForOutreach: 60, excludeResidential: true },
    automations: Object.fromEntries(AUTOMATIONS.map((a) => [a.id, { enabled: a.id !== 'email_sending', interval: a.id === 'permit_monitoring' ? 'daily' : 'daily' }])),
    mode: 'semi_automatic',
    pauseAll: false,
    outreach: { defaultStyle: 'short_direct', followUpDays: 5, dailySendLimit: 20, autoSendMinScore: 80 },
    email: { provider: null, address: '', smtpHost: '', smtpPort: 587, smtpSecure: false, username: '', password: '', connectedAt: null, lastTestAt: null, lastTestOk: null, lastTestError: null },
    onboarding: { startedAt: null, completedAt: null, steps: Object.fromEntries(ONBOARDING_STEPS.map((s) => [s.id, { status: 'pending', completedAt: null }])), dismissed: false },
    environment: 'live', // which environment the UI is viewing
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function createSettingsService(store) {
  function get() {
    let s = store.get('settings', 'settings');
    if (!s) s = store.insert('settings', defaultSettings());
    // Fill in any keys added after the document was first created.
    const d = defaultSettings();
    let changed = false;
    for (const k of Object.keys(d)) if (s[k] === undefined) { s[k] = d[k]; changed = true; }
    for (const a of AUTOMATIONS) if (!s.automations[a.id]) { s.automations[a.id] = d.automations[a.id]; changed = true; }
    for (const st of ONBOARDING_STEPS) if (!s.onboarding.steps[st.id]) { s.onboarding.steps[st.id] = { status: 'pending', completedAt: null }; changed = true; }
    if (changed) store.update('settings', 'settings', s);
    return s;
  }
  function update(patch) {
    const s = get();
    const merged = deepMerge(s, patch);
    merged.updatedAt = new Date().toISOString();
    return store.update('settings', 'settings', merged);
  }
  /** Redact secrets before sending settings to the browser. */
  function publicView() {
    const s = structuredClone(get());
    s.email = { ...s.email, password: s.email.password ? '••••••••' : '', hasPassword: Boolean(s.email.password) };
    return s;
  }
  return { get, update, publicView };
}

function deepMerge(target, patch) {
  if (Array.isArray(patch) || patch === null || typeof patch !== 'object') return patch;
  const out = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && target?.[k] && typeof target[k] === 'object' && !Array.isArray(target[k]) ? deepMerge(target[k], v) : v;
  }
  return out;
}
