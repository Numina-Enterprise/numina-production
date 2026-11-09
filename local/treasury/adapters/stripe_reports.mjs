// GENERATED from local/treasury/registry.json by local/treasury/generate-adapters.mjs. Do not edit by hand.
// Analytics: Searches financial report types and creates report runs (balance, payouts, activity, tax, Revenue Recognition) that produce CSV files
// status: Unconfirmed: named only in a search-index snapshot of docs.stripe.com/data/analyze-with-ai; absent from the current /mcp tools table. Adapter activates only if tools/list returns it. | access: write | moves money: no | Stripe human confirmation: false
// source: https://docs.stripe.com/data/analyze-with-ai
import {makeAdapter} from '../adapter-core.mjs';
export default makeAdapter("stripe_reports");
