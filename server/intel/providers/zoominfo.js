// ZoomInfo. ZoomInfo's API is sold under enterprise agreements only and is
// authenticated with a username plus client id / private key (JWT). There is
// no self-serve API key, so this adapter is configuration-only: it records
// what is needed and reports honestly that it is not available until an
// enterprise API contract is in place. Docs: https://api-docs.zoominfo.com/
export const INFO = {
  id: 'zoominfo', name: 'ZoomInfo', website: 'https://www.zoominfo.com/', docs: 'https://api-docs.zoominfo.com/',
  capabilities: { peopleSearchByCompanyAndTitle: 'yes (enterprise API)', personEnrichment: 'yes (enterprise API)', emailVerification: 'yes', companyEnrichment: 'yes', linkedinUrlReturned: 'yes', phones: 'yes (direct dials), enterprise licence' },
  credentials: [
    { key: 'username', label: 'ZoomInfo username', help: 'Issued with an enterprise API agreement.' },
    { key: 'clientId', label: 'Client ID', help: 'From ZoomInfo API admin.' },
    { key: 'privateKey', label: 'Private key', help: 'PKI private key from ZoomInfo API admin.' },
  ],
  enterpriseOnly: true,
};
export const isConfigured = (cfg) => Boolean(cfg?.username && cfg?.clientId && cfg?.privateKey);
const notAvailable = () => { throw Object.assign(new Error('ZoomInfo: API access requires an enterprise agreement; this adapter is a placeholder until credentials are issued. Use the ZoomInfo web app and import an export instead.'), { provider: 'zoominfo', status: 501 }); };
export async function searchPeople() { return notAvailable(); }
export async function enrichPerson() { return notAvailable(); }
export async function verifyEmail() { return notAvailable(); }
export async function enrichCompany() { return notAvailable(); }
