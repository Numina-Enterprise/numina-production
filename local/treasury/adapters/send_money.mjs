// GENERATED from local/treasury/registry.json by local/treasury/generate-adapters.mjs. Do not edit by hand.
// Treasury: Sends money from a Treasury account to a recipient
// status: Public preview | access: write | moves money: yes | Stripe human confirmation: true
// source: https://docs.stripe.com/treasury/agents#supported-tools
import {makeAdapter} from '../adapter-core.mjs';
export default makeAdapter("send_money");
