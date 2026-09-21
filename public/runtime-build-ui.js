// A dated, verified build record is distinct from current application capabilities.
// This reader never handles account credentials, private balances or transactions.
export const LINUX_RUNTIME_PROOF = Object.freeze({
  run: 34725802271, attempt: 1,
  source: '2b0be57996c70e8fda49199d1d649fe3faf0e0d3',
  builder: 'cda9bf7702d909ed1d8e16c338a91e283c1bce53',
  directory: '/downloads/provenance/runtime-34725802271/',
  reviewSha256: 'f5efc7099246e69abd21cec436f199b54aa0d26dd422db6ed74842315a76911f',
  inventorySha256: '33c2517226539296eb40b7a24caeceb845ddf5a98c2589f359f141b555ff1fc9',
});
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const short = value => typeof value === 'string' && value.length > 0 && value.length <= 180;
const capabilities = ['quote', 'mint', 'transfer', 'settlement', 'redemption'];

async function readRecord(path, signal, expectedHash = null) {
  const response = await fetch(path, {
    method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok || response.redirected || !response.body) throw Error('Record unavailable');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (signal.aborted || size > 262144) { await reader.cancel(); throw Error('Record unavailable'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  if (signal.aborted) throw Error('Record unavailable');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (expectedHash) {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      value => value.toString(16).padStart(2, '0')).join('');
    if (hash !== expectedHash) throw Error('Record identity mismatch');
  }
  const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!object(data)) throw Error('Record unavailable');
  return data;
}

function assessBuild(review, inventory) {
  const policy = LINUX_RUNTIME_PROOF;
  if (review.schema !== 'numina.nusd.runtime-release-review.v1'
    || review.decision !== 'builder_signed_artifacts_verified_image_built_not_deployed'
    || review.intendedSource?.repository !== 'skott34-dot/numina-production'
    || review.intendedSource?.commit !== policy.source
    || review.intendedBuilder?.commit !== policy.builder
    || review.run?.id !== policy.run || review.run?.attempt !== policy.attempt
    || review.run?.conclusion !== 'success' || review.mismatches?.length !== 0
    || !Array.isArray(review.subjects) || review.subjects.length !== 3
    || review.scope?.builderSignedArtifactsVerified !== true
    || review.scope?.linuxAmd64ImageBuilt !== true
    || review.scope?.productionHostDeploymentVerified !== false
    || review.scope?.slsaBuildLevelClaimed !== null
    || inventory.schema !== 'numina.nusd.hosted-runtime-build.v1'
    || inventory.source?.commit !== policy.source || inventory.run?.id !== policy.run
    || inventory.run?.attempt !== policy.attempt || inventory.image?.os !== 'linux'
    || inventory.image?.architecture !== 'amd64' || inventory.buildScope?.dockerBuildExecuted !== true
    || inventory.buildScope?.applicationEntrypointExecuted !== false
    || inventory.buildScope?.contractBroadcast !== false
    || inventory.buildScope?.mintOrTransferPerformed !== false) throw Error('Build evidence mismatch');
  for (const subject of review.subjects) {
    if (subject.subjectDigestMatches !== true || subject.ghExitCodeFromCompletionRecord !== 0
      || !object(subject.identityComparisons)
      || !Object.values(subject.identityComparisons).every(value => value === true)) throw Error('Verification record mismatch');
  }
  return {
    state: 'Linux image built · three signed artifacts verified',
    detail: 'Recorded GitHub CLI verification matched the source archive, Linux image archive and inventory to the pinned builder and source revisions.',
    recorded: 'Build completed 12 September 2026 at 23:35 UTC · run 34725802271, attempt 1.',
    source: policy.source, builder: policy.builder,
    image: inventory.image.configDigest,
  };
}

export function contractSourcePresentation(record) {
  if(record?.status==='DEPLOYED_VERIFIED'){
    const contracts=record.contracts,issuance=record.issuance;
    if(record.schema!=='numina.nusd.contract-record.v1'||record.url!=='/api/nusd/v1/contracts'||record.native_treasury!=='/api/control/v1/treasury'||
      !Array.isArray(contracts)||contracts.map(contract=>contract.name).join(',')!=='NuminaUSD,NuminaSettlement,NuminaUSDCConversion,NuminaUSDRedemption'||
      record.financial_execution?.issuance!==true||record.financial_execution?.transfer!==true||!['nusd_settlement','usd_redemption','usdc_conversion','external_deposits'].every(name=>record.financial_execution[name]===false)||
      issuance?.decimals!==18||issuance.constructorMint!==true||issuance.externallyBackedClaim!==false||
      !/^(0|[1-9][0-9]{0,77})$/.test(issuance.amountNusd)||!/^\d+$/.test(issuance.baseUnits)||
      BigInt(issuance.amountNusd)*10n**18n!==BigInt(issuance.baseUnits)||!Number.isFinite(Date.parse(issuance.verifiedAt))||
      issuance.record!=='/downloads/nusd/deployment-verification.json')throw Error('Contract source record unavailable');
    for(let i=0;i<contracts.length;i++){
      const contract=contracts[i],deployment=contract.deployment;
      if(contract.verification?.source_hash_matches_artifact!==true||!short(contract.compiler?.version)||contract.compiler.settings?.evmVersion!=='london')throw Error('Contract source record unavailable');
      if(i<2){
        if(!['DEPLOYED_VERIFIED_ACTIVE','DEPLOYED_VERIFIED'].includes(contract.status)||contract.verification.chain_receipt_verified!==true||
          deployment?.status!=='verified'||deployment.lifecycle!=='FINAL'||deployment.submission_performed!==true||deployment.expected_chain_id!=='962421430'||
          !/^0x[0-9a-fA-F]{40}$/.test(deployment.contract_address)||!/^0x[0-9a-fA-F]{64}$/.test(deployment.transaction_hash)||
          deployment.receipt?.status!=='0x1'||deployment.receipt.record!=='runtime/nusd/deployment-receipt.json')throw Error('Contract source record unavailable');
      }else{
        // Native activation is an internal operational record, not a chain receipt
        // or evidence that the bank or USDC destination accepted a transaction.
        if(contract.verification.chain_receipt_verified!==false||deployment?.submission_performed!==false||
          deployment.contract_address!==null||deployment.transaction_hash!==null||deployment.receipt!==null)throw Error('Contract source record unavailable');
        if(deployment.status==='native_active'){
          const unit=i===2?'USDC':'USD',nativeId=i===2?'numina:nusd-usdc:conversion:v1':'numina:nusd-usd:redemption:v1';
          if(contract.status!=='ACTIVE_SIGNED_1_TO_1_VERIFIED'||deployment.lifecycle!=='ACTIVE'||
            contract.verification.native_activation_verified!==true||contract.verification.signed_1_to_1_backing_verified!==true||
            deployment.verification_scope!=='NUMINA_NATIVE_TREASURY'||deployment.external_provider_verified!==false||
            deployment.native_contract_id!==nativeId||deployment.native_attestation_id!==record.native_activation?.backing_attestation_id||
            deployment.ratio!=='1:1'||deployment.backing_verified!==true||deployment.native_unit!==unit||
            !/^(0|[1-9][0-9]{0,77})$/.test(deployment.native_value)||deployment.native_value!==deployment.nusd_equivalent||
            deployment.chain_contract_address_recorded!==false||deployment.chain_transaction_hash_recorded!==false)throw Error('Contract source record unavailable');
        }else if(deployment.status!=='not_verified'||contract.verification.native_activation_verified===true)throw Error('Contract source record unavailable');
      }
      for(const [key,extension]of [['source','sol'],['artifact','json']]){
        const file=contract[key];
        if(file?.url!=='/downloads/contracts/'+contract.name+'.'+extension||!/^([a-f0-9]{64})$/.test(file.sha256||'')||!Number.isSafeInteger(file.bytes)||file.bytes<1)throw Error('Contract source record unavailable');
      }
    }
    if(issuance.transactionHash!==contracts[0].deployment.transaction_hash)throw Error('Contract source record unavailable');
    return {source:'NUSD token and settlement deployed · issuance receipt-verified · 18 decimals',
      'source-scope':'Recorded constructor issuance: '+issuance.amountNusd+' NUSD. Verified at '+issuance.verifiedAt+'.'+
        (contracts.some(contract=>contract.deployment.status==='native_active')?' Conversion and redemption are ACTIVE in the NUMINA native model; their chain deployment and external provider execution remain unverified.':'')+
        ' Current transfer availability is ACTIVE; external reserves, conversion and redemption remain separately evidenced.'};
  }
  if(record?.schema!=='numina.nusd.contract-record.v1'||record.status!=='compiled_not_deployed'||
    record.url!=='/api/nusd/v1/contracts'||record.native_treasury!=='/api/control/v1/treasury'||
    !Array.isArray(record.contracts)||record.contracts.length!==4||
    record.contracts.map(contract=>contract.name).join(',')!=='NuminaUSD,NuminaSettlement,NuminaUSDCConversion,NuminaUSDRedemption'||
    !object(record.financial_execution)||
    !['issuance','transfer','nusd_settlement','usd_redemption','usdc_conversion','external_deposits']
      .every(name=>record.financial_execution[name]===false))throw Error('Contract source record unavailable');
  for(const contract of record.contracts){
    if(contract.status!=='compiled_not_deployed'||contract.verification?.source_hash_matches_artifact!==true||
      contract.verification?.chain_receipt_verified!==false||contract.deployment?.status!=='not_verified'||
      contract.deployment.contract_address!==null||contract.deployment.transaction_hash!==null||contract.deployment.receipt!==null||
      !short(contract.compiler?.version)||contract.compiler.settings?.evmVersion!=='london')throw Error('Contract source record unavailable');
    for(const [key,extension]of [['source','sol'],['artifact','json']]){
      const file=contract[key];
      if(file?.url!==`/downloads/contracts/${contract.name}.${extension}`||!/^([a-f0-9]{64})$/.test(file.sha256||'')||
        !Number.isSafeInteger(file.bytes)||file.bytes<1)throw Error('Contract source record unavailable');
    }
  }
  return {source:'NUSD token, settlement and 1:1 conversion source compiled · deployment unverified',
    'source-scope':'Contract source implements issuance, token settlement, 1:1 exchange using deposited USDC, and USD redemption escrow with separate bank-outcome attestations. Deployment, funding, live conversion and external deposits remain unverified.'};
}

export function assessFinancialStatus(data) {
  if (data.schema !== 'numina.nusd.status.v1' || data.asset?.symbol !== 'NUSD'
    || !object(data.capabilities) || !capabilities.every(name => typeof data.capabilities[name] === 'boolean')
    || !(data.asset.contract === null || /^0x[0-9a-fA-F]{40}$/.test(data.asset.contract || ''))
    || !short(data.asset_verification?.status) || !short(data.treasury_backing?.status)
    || !short(data.service_pricing?.status)) throw Error('Financial status unavailable');
  const source=data.contract_record===undefined
    ?{source:'Contract source record unavailable','source-scope':''}
    :contractSourcePresentation(data.contract_record);
  const mint=data.mint_workflow;
  const token=data.contract_record?.contracts?.find(contract=>contract.name==='NuminaUSD');
  if(mint!==undefined&&(mint?.schema!=='numina.nusd.mint-workflow.v1'||
    !['FINAL_MINTED_18D'].includes(mint.status)||
    mint.contract?.authorizationFunction!=='authorizeIssuance'||mint.contract?.mintFunction!=='mintAuthorized'||
    mint.contract?.sourceSha256!==token?.source?.sha256||mint.contract?.artifactSha256!==token?.artifact?.sha256||
    !['authorizeIssuance','mintAuthorized'].every(name=>token?.implemented_operations?.issuance?.includes(name))||
    mint.preparation?.signing!==false||mint.preparation?.broadcast!==false||
    mint.recipientEvidence?.readOnly!==true||mint.recipientEvidence?.providerAcceptanceInferred!==false||
    mint.recipientEvidence?.mintCompletionInferred!==false))throw Error('Mint workflow unavailable');
  if(mint?.status==='FINAL_MINTED_18D'&&(mint.contract?.decimals!==18||mint.execution?.chainReceiptVerified!==true||
    mint.execution.completedMintVerified!==true||mint.execution.contractAddress!==token?.deployment?.contract_address||
    mint.execution.contractAddress!==data.asset.contract||mint.execution.transactionHash!==token?.deployment?.transaction_hash||
    mint.execution.receipt?.status!=='0x1'))throw Error('Mint workflow unavailable');
  return {
    state: 'Current application status received',
    contract: data.asset.contract === null ? (data.contract_record?'No deployed address reported · compiled contract sources available':'No contract address reported') : data.asset.contract,
    identity: data.contract_record?.status==='DEPLOYED_VERIFIED'?'Issued NUSD · deployed contract verified · 18 decimals':data.asset_verification.status.replaceAll('_', ' '),
    activation: data.operator_activation?.status==='active_verified'?'Active · chain activity verified · transfers enabled':'No verified activation state received',
    purchase: data.operator_activation?.purchaseAvailability==='operator_confirmed'?'Available per operator confirmation · checkout connection not verified':'No token purchase declaration received',
    backing: data.treasury_backing.status.replaceAll('_', ' '),
    pricing: data.service_pricing.status.replaceAll('_', ' '),
    ...Object.fromEntries(capabilities.map(name => [name,
      data.capabilities[name] ? 'Enabled by application' : 'Not enabled by application'])),
    ...(mint&&!data.capabilities.mint?{mint:mint.status==='FINAL_MINTED_18D'?'Constructor issuance FINAL · 1,500T NUSD · 18 decimals · no additional mint requested':'Mint state unavailable'}:{}),
    ...source,
    checked: 'Status response fetched ' + new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC') + '.'+
      (data.contract_record?.issuance?' Current NUSD status reports transfers enabled; the finalized constructor receipt remains separately bound at '+data.contract_record.issuance.verifiedAt+'.':''),
  };
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const panels = [...document.querySelectorAll('[data-linux-runtime-panel], [data-nusd-status-panel]')];
  const hasBuildPanel = panels.some(panel => panel.hasAttribute('data-linux-runtime-panel'));
  if (panels.length) {
    let generation = 0, controller;
    const set = (attribute, value) => panels.forEach(panel => {
      panel.querySelectorAll('[' + attribute + ']').forEach(element => { element.textContent = value; });
    });
    const proof = value => Object.entries(value).forEach(([key, text]) => set('data-linux-build-' + key, text));
    const financial = value => Object.entries(value).forEach(([key, text]) => set('data-linux-financial-' + key, text));
    function clear(message) {
      proof({ state: message, detail: 'Open the dated build records below to inspect the evidence.', recorded: '', source: 'Unavailable', builder: 'Unavailable', image: 'Unavailable' });
      financial(Object.fromEntries(['state', 'contract', 'identity', 'activation', 'purchase', 'backing', 'pricing', 'source', 'source-scope', ...capabilities]
        .map(key => [key, key === 'state' ? 'Current application status unknown' : 'Unknown'])));
      financial({ checked: '' });
    }
    async function refresh() {
      controller?.abort();
      const current = ++generation;
      controller = new AbortController();
      const active = controller;
      clear('Loading verified build record…');
      const timed = task => {
        const group = new AbortController();
        let timer, onAbort;
        const deadline = new Promise((_, reject) => {
          onAbort = () => { group.abort(); reject(Error('Read cancelled')); };
          if (active.signal.aborted) { onAbort(); return; }
          active.signal.addEventListener('abort', onAbort, { once: true });
          timer = setTimeout(() => { group.abort(); reject(Error('Read deadline exceeded')); }, 12000);
        });
        return Promise.race([deadline, task(group.signal)]).finally(() => {
          // Cancels a pending sibling proof read after either member fails.
          // Current financial status has a separate controller and deadline.
          group.abort();
          clearTimeout(timer);
          active.signal.removeEventListener('abort', onAbort);
        });
      };
      const currentView = () => current === generation && !active.signal.aborted;
      const readBuild = hasBuildPanel ? timed(signal => Promise.all([
        readRecord(LINUX_RUNTIME_PROOF.directory + 'release-review.json', signal, LINUX_RUNTIME_PROOF.reviewSha256),
        readRecord(LINUX_RUNTIME_PROOF.directory + 'numina-nusd-runtime-inventory.json', signal, LINUX_RUNTIME_PROOF.inventorySha256),
      ])).then(([review, inventory]) => {
        const view = assessBuild(review, inventory);
        if (currentView()) proof(view);
      }).catch(() => {
        if (current === generation) proof({ state: 'Build verification record unavailable',
          detail: 'The dated record could not be loaded or did not match its reviewed fingerprint. Open the evidence links to inspect it.' });
      }) : Promise.resolve();
      const readStatus = timed(signal => readRecord('/api/nusd/v1/status', signal)).then(data => {
        const view = assessFinancialStatus(data);
        if (currentView()) financial(view);
      }).catch(() => {
        if (current === generation) financial({ state: 'Current application status unavailable',
          checked: 'No current status response was accepted. Use Refresh or open the status API.' });
      });
      await Promise.all([readBuild, readStatus]);
    }
    document.querySelectorAll('[data-refresh-linux-runtime], [data-refresh-nusd-status], [data-refresh-release]')
      .forEach(button => button.addEventListener('click', () => void refresh()));
    window.addEventListener('pagehide', () => { generation++; controller?.abort(); clear('Refresh to load the build record'); });
    window.addEventListener('pageshow', event => { if (event.persisted) void refresh(); });
    void refresh();
  }
}
