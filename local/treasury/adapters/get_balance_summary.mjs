// GENERATED from local/treasury/registry.json by local/treasury/generate-adapters.mjs. Do not edit by hand.
// Treasury: Displays an interactive balance summary across the Stripe balance and Treasury accounts
// status: Public preview | access: read | moves money: no | Stripe human confirmation: false
// source: https://docs.stripe.com/treasury/agents#supported-tools
import {makeAdapter} from '../adapter-core.mjs';
export default makeAdapter("get_balance_summary");
