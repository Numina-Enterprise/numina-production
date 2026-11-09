// GENERATED from local/treasury/registry.json by local/treasury/generate-adapters.mjs. Do not edit by hand.
// Treasury: Sets up a recipient account for sending money from a Treasury account
// status: Public preview | access: write | moves money: no | Stripe human confirmation: false
// source: https://docs.stripe.com/treasury/agents#supported-tools
import {makeAdapter} from '../adapter-core.mjs';
export default makeAdapter("setup_recipient");
