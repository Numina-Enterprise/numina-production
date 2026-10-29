'use strict';

const crypto=require('crypto');
const {sign}=require('./numina');

function sorted(v){if(Array.isArray(v))return v.map(sorted);if(v&&typeof v==='object'){const o={};for(const k of Object.keys(v).sort())o[k]=sorted(v[k]);return o;}return v;}
function digest(v){return crypto.createHash('sha256').update(JSON.stringify(sorted(v))).digest('hex');}
function required(v,name){if(v===undefined||v===null||v==='')throw new Error(`EXTERNAL_CONFIRMATION_${name}_REQUIRED`);return v;}

function confirmExternalEvent({expected,providerResponse,provider}){
  required(provider,'PROVIDER');required(expected,'EXPECTED');required(providerResponse,'PROVIDER_RESPONSE');
  const eventId=required(providerResponse.event_id||providerResponse.transaction_id||providerResponse.tx_hash,'EVENT_ID');
  const status=String(required(providerResponse.status,'STATUS')).toUpperCase();
  const providerTimestamp=required(providerResponse.provider_timestamp||providerResponse.timestamp,'PROVIDER_TIMESTAMP');
  const ledgerReference=required(providerResponse.block_reference||providerResponse.ledger_reference||providerResponse.block_number,'LEDGER_REFERENCE');
  const comparisons={
    event_id:!expected.event_id||String(eventId)===String(expected.event_id),
    amount:expected.amount===undefined||String(providerResponse.amount)===String(expected.amount),
    asset:expected.asset===undefined||String(providerResponse.asset).toUpperCase()===String(expected.asset).toUpperCase(),
    destination:expected.destination===undefined||String(providerResponse.destination).toLowerCase()===String(expected.destination).toLowerCase(),
    status:['CONFIRMED','SETTLED','FINALIZED','SUCCESS','COMPLETED'].includes(status)
  };
  const matches=Object.values(comparisons).every(Boolean);
  const verification={
    schema:'numina.external-confirmation.v1',provider:String(provider),event_id:String(eventId),provider_status:status,
    provider_timestamp:String(providerTimestamp),ledger_reference:String(ledgerReference),comparisons,
    raw_external_response_sha256:digest(providerResponse),verification_status:matches?'EXTERNALLY_CONFIRMED':'MISMATCH'
  };
  const receipt=sign(verification,'NUMINA_EXTERNAL_CONFIRMATION');
  if(JSON.stringify(receipt.payload)!==JSON.stringify(verification))throw new Error('NUMINA_EXTERNAL_CONFIRMATION_PAYLOAD_MISMATCH');
  return {verification,receipt};
}

module.exports={confirmExternalEvent};
