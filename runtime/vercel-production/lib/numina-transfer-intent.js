'use strict';

const NUMINA_TRANSFER_INTENT=Object.freeze({
  schema:'numina.transfer-intent.v1',
  root:'NUMINA',
  source:'NUMINA_MINT_TREASURY_SOURCE',
  asset:'NUSD',
  mint:'1500T',
  burn:'0',
  transfers:Object.freeze([
    Object.freeze({amount:'500T',destination:'BOA_DESIGNATED_NUMINA_ADDRESS'}),
    Object.freeze({amount:'500T',destination:'STRIPE_DESIGNATED_NUMINA_ADDRESS'}),
    Object.freeze({amount:'500T',destination:'NUMINA_TREASURY_ADDRESS'})
  ]),
  totalTransferred:'1500T',
  remainder:'0',
  execution:Object.freeze({atomic:true,requiresSigner:true,requiresCommitReceipt:true,requiresReadBack:true,requiresVerification:true})
});

module.exports={NUMINA_TRANSFER_INTENT};
