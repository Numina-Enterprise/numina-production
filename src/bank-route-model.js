export function privateBankRouteConfiguration(env){
    const account=env.NUMINA_BOFA_SAVINGS_ACCOUNT||'',routing=env.NUMINA_BOFA_ACH_ROUTING_NUMBER||'';
    const syntax=/^[0-9]{5,17}$/.test(account)&&/^[0-9]{9}$/.test(routing);
    const digits=syntax?[...routing].map(Number):[];
    const checksum=syntax&&(3*(digits[0]+digits[3]+digits[6])+7*(digits[1]+digits[4]+digits[7])+digits[2]+digits[5]+digits[8])%10===0&&!/^0+$/.test(routing);
    return {schema:'numina.treasury.bank-route.v1',identity:'NUMINA',providerLabel:'Bank of America',accountType:'savings',rail:'ACH',
      configurationStatus:checksum?'owner_provided_unverified':'not_configured',accountLast4:checksum?account.slice(-4):null,routingNumberStored:checksum,
      evidenceType:'owner_provided_configuration',ownerDeclaration:{ownershipVerified:true,achDebitAuthorized:true,evidenceType:'owner_statement',providerVerified:false},ownershipVerified:false,bankConnectionVerified:false,providerBalance:null,
      achSubmissionEnabled:false,submissionPerformed:false,receipt:null};
}
