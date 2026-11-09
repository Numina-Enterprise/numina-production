// Local session view: list stored OAuth sessions (metadata only), revoke locally (delete the
// encrypted token file), and the Stripe-side revocation runbook from docs.stripe.com/treasury/agents.
import {createTokenStore} from './token-store.mjs';
import {PROFILES} from './config.mjs';

export const STRIPE_REVOKE_RUNBOOK={
  source:'https://docs.stripe.com/treasury/agents#manage-mcp-access-and-sessions',
  yourSessions:['Open your Stripe user settings and find OAuth sessions.','Find the client in the OAuth sessions list (this console registers as "Numina local admin (sandbox)" or "(live)").','Click the overflow menu (⋯).','Select Revoke access.'],
  asAdministrator:['Open Team and security in the Dashboard (your role needs permission to manage team members; Administrator has it).','Select the team member.','Find the OAuth sessions table.','Click a session\'s overflow menu and select Revoke access, or select Revoke all.'],
  scope:'Revocation applies only to the account or organization and environment (live mode or a sandbox) you are viewing. Revoke in BOTH the sandbox and live views when retiring this console.',
  agentApiKeys:'For agent API keys: expire the key in the Dashboard (API keys, Agent badge) and unset the environment variable locally. Stripe MCP stops accepting full-access secret keys and restricted keys without the Agent tag in December 2026; migrate by 2026-11-30.',
  teamWide:'Administrators can enable or disable MCP access for the whole team in the Dashboard, configured separately for live mode and sandboxes.'
};
const stores=(config,env)=>PROFILES.map(p=>createTokenStore({file:config.profiles[p].auth.tokenFile,keyEnv:config.profiles[p].auth.tokenKeyEnv,env,profile:p}));
export function listSessions(config,env=process.env){
  return stores(config,env).map(s=>({...s.describe(),authMethod:config.profiles[s.profile].auth.method,apiKeyEnv:config.profiles[s.profile].auth.apiKeyEnv,apiKeyEnvSet:!!env[config.profiles[s.profile].auth.apiKeyEnv]}));
}
export function revokeLocal(config,profile,env=process.env){
  if(!PROFILES.includes(profile))throw Object.assign(new Error('profile must be sandbox or live'),{code:'INVALID_PROFILE'});
  const s=stores(config,env).find(x=>x.profile===profile);
  return {profile,deleted:s.revoke(),stripeSide:STRIPE_REVOKE_RUNBOOK};
}
