// Local session view: list stored OAuth 2.1 sessions (metadata only), revoke locally (delete the
// encrypted token file), and the Stripe-side revocation runbook from docs.stripe.com/treasury/agents.
import {createTokenStore} from './token-store.mjs';
import {PROFILES} from './config.mjs';

export const STRIPE_REVOKE_RUNBOOK={
  source:'https://docs.stripe.com/treasury/agents#manage-mcp-access-and-sessions',
  yourSessions:['Open your Stripe user settings and find OAuth sessions.','Find the client in the OAuth sessions list (this console registers as "Numina local admin (sandbox)" or "(live)").','Click the overflow menu (⋯).','Select Revoke access.'],
  asAdministrator:['Open Team and security in the Dashboard (your role needs permission to manage team members; Administrator has it).','Select the team member.','Find the OAuth sessions table.','Click a session\'s overflow menu and select Revoke access, or select Revoke all.'],
  scope:'Revocation applies only to the account or organization and environment (live mode or a sandbox) you are viewing. Revoke in BOTH the sandbox and live views when retiring this console.',
  auth:'Stripe MCP authentication for this console is OAuth 2.1 only (authorization code + PKCE). There is no agent API key path.',
  teamWide:'Administrators can enable or disable MCP access for the whole team in the Dashboard, configured separately for live mode and sandboxes.'
};
const stores=(config,env)=>PROFILES.map(p=>createTokenStore({file:config.profiles[p].auth.tokenFile,keyEnv:config.profiles[p].auth.tokenKeyEnv,env,profile:p}));
export function listSessions(config,env=process.env){
  return stores(config,env).map(s=>({...s.describe(),authMethod:config.profiles[s.profile].auth.method,authLabel:'OAuth 2.1'}));
}
export function revokeLocal(config,profile,env=process.env){
  if(!PROFILES.includes(profile))throw Object.assign(new Error('profile must be sandbox or live'),{code:'INVALID_PROFILE'});
  const s=stores(config,env).find(x=>x.profile===profile);
  return {profile,deleted:s.revoke(),stripeSide:STRIPE_REVOKE_RUNBOOK};
}
