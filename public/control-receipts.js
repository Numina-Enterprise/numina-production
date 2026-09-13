const RECEIPT_ID='internal-record-receipt';
const INTERNAL_ADAPTER='internal.record.v1';
const sha256=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const text=value=>typeof value==='string'&&value.length>0;
const element=(tag,value)=>{const node=document.createElement(tag);node.textContent=value;return node;};

export function clearControlReceipt(container){container.querySelector('#'+RECEIPT_ID)?.remove();}

export function renderControlReceipt(container,snapshot,request){
  clearControlReceipt(container);
  if(!['complete','authority-scoped'].includes(snapshot?.projection)||!Number.isSafeInteger(snapshot.revision)||
    !request||request.execution?.state!=='committed'||request.execution.recordId!==request.id||
    request.route!==INTERNAL_ADAPTER||request.verifiedOutcome?.scope!==INTERNAL_ADAPTER||
    request.verifiedOutcome.externalExecution!==false||!text(request.verifiedOutcome.evidenceId)||
    !Array.isArray(request.evidence)||!request.evidence.includes(request.verifiedOutcome.evidenceId)||
    !Array.isArray(snapshot.state?.evidence)||!Array.isArray(snapshot.state?.records))return;

  const nodes=snapshot.state.evidence.filter(node=>node?.id===request.verifiedOutcome.evidenceId);
  const records=snapshot.state.records.filter(record=>record?.requestId===request.id);
  if(nodes.length!==1||records.length!==1)return;
  const node=nodes[0],record=records[0];
  if(node.kind!=='execution'||node.requestId!==request.id||node.adapter!==INTERNAL_ADAPTER||
    node.adapterVersion!==1||node.outcome!=='INTERNAL_RECORD_COMMITTED'||!text(node.actor)||
    !Number.isSafeInteger(node.sequence)||node.sequence<1||node.sequence>snapshot.revision||
    !Number.isSafeInteger(node.at)||node.at<=0||record.at!==node.at||record.evidenceId!==node.id||
    record.resource!==request.wants?.resource||record.payload!==request.wants?.payload||
    !sha256(node.inputHash)||!sha256(node.hash))return;
  const committedAt=new Date(node.at*1000);
  if(!Number.isFinite(committedAt.getTime()))return;

  const receipt=element('details','');receipt.id=RECEIPT_ID;receipt.open=true;
  receipt.append(element('summary','Internal record receipt'));
  const fields=element('dl','');
  for(const [label,value] of [
    ['Request ID',request.id],['Record ID',request.execution.recordId],
    ['Execution evidence ID',node.id],['Commit revision',String(node.sequence)],
    ['Committed at (UTC)',committedAt.toISOString()],['Committed by',node.actor],
    ['Adapter',node.adapter+' · version '+node.adapterVersion],
    ['Recorded input SHA-256',node.inputHash],['Execution evidence SHA-256',node.hash],
    ['Current snapshot revision',String(snapshot.revision)]
  ])fields.append(element('dt',label),element('dd',value));
  receipt.append(fields);
  const note=element('p','Stored evidence of an internal record commit. This is not a blockchain transaction or bank receipt. The execution evidence hash is not a transaction or journal event hash.');
  note.className='helper';receipt.append(note);
  container.querySelector('.decision')?.after(receipt);
}
