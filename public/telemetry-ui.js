// Copyright © 2026 SK Consulting LLC. Numina™. See OWNERSHIP.md.
import {requestJson, createViewScope} from './http-client.js';
const metricScope = createViewScope();
const summary = document.querySelector('#telemetry-status'), values = document.querySelector('#telemetry-values');
const button = document.querySelector('#telemetry-refresh');
function clearTelemetry() { metricScope.reset(); values?.replaceChildren(); if(summary)summary.textContent='Owner access is required to view runtime metrics.'; if(button)button.disabled=false; }
async function refreshTelemetry() {
  metricScope.reset(); const generation = metricScope.generation; values.replaceChildren(); button.disabled=true;
  summary.textContent='Reading the current runtime instance…';
  try {
    const result = await requestJson('/api/ops/v1/telemetry', {signal:metricScope.signal, timeoutMs:8000});
    if(!metricScope.isCurrent(generation))return;
    if(result.schema!=='numina.telemetry.v1'||result.scope!=='current_process_only')throw Error('Unsupported metrics');
    const w=result.window, number=value=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString(undefined,{maximumFractionDigits:2}):'No observations';
    const fields=[
      ['Requests in window',number(w.requests)],['Requests per second',number(w.requestsPerSecond)],
      ['Active requests',number(result.activeRequests)],['Server errors',number(w.serverErrors)],
      ['Rate-limited requests',number(w.rateLimited)],
      ['p95 response time',w.p95AboveLargestBucket?'> 60,000 ms':w.p95UpperBoundMs===null?'No observations':'≤ '+number(w.p95UpperBoundMs)+' ms'],
      ['Capacity signals',result.capacity.status==='insufficient_data'?'Collect at least 100 requests':result.capacity.signals.length?result.capacity.signals.map(x=>x.replaceAll('_',' ')).join(' · '):'Within configured thresholds'],
      ['Quantum backend',result.quantum?.connected?'Numina simulator connected · classical compute':'Simulator disabled or unavailable']
    ];
    const quantum=result.quantum?.workload;
    if(quantum?.schema==='numina.quantum-workload.v1'&&quantum.scope==='current_process_only') {
      const q=quantum.window;
      fields.push(
        ['Active quantum jobs',number(quantum.activeJobs)+' / '+number(quantum.limits.concurrentPerProcess)],
        ['Quantum jobs admitted this minute',number(quantum.admittedThisMinute)+' / '+number(quantum.limits.requestsPerMinutePerProcess)],
        ['Completed quantum jobs',number(q.succeeded)+' succeeded · '+number(q.failed)+' failed'],
        ['Quantum concurrency rejections',number(q.concurrencyLimited)],
        ['Quantum rate-limit rejections',number(q.rateLimited)],
        ['Completed simulator shots',number(q.completedShots)+' · '+number(q.shotsPerSecond)+' per second'],
        ['p95 quantum compute time',q.p95AboveLargestBucket?'> 60,000 ms':q.p95ComputeUpperBoundMs===null?'No observations':'≤ '+number(q.p95ComputeUpperBoundMs)+' ms'],
        ['Quantum capacity signals',quantum.capacity.status==='insufficient_data'?'Collect at least 20 workload observations':quantum.capacity.signals.length?quantum.capacity.signals.map(x=>x.replaceAll('_',' ')).join(' · '):'Within configured thresholds']
      );
    } else fields.push(['Quantum workload metrics','Not available from this deployment']);
    const ibm=result.quantum?.ibm;
    fields.push(['IBM QPU access',ibm?.configured?'Credentials configured; connection requires an authenticated provider read':ibm?.configurationError?'Configuration needs attention':'Not configured in this deployment']);
    for(const [label,value]of fields){const term=document.createElement('dt'),detail=document.createElement('dd');term.textContent=label;detail.textContent=value;values.append(term,detail);}
    summary.textContent='Observed '+new Date(result.observedAt).toLocaleString()+'. Current runtime instance only; fleet totals require aggregated provider logs.';
  } catch(error) {
    if(!metricScope.isCurrent(generation))return;
    values.replaceChildren();summary.textContent=[401,403].includes(error.status)?'Sign in as the owner to view runtime metrics.':'Telemetry is unavailable from this deployment.';
  } finally {if(metricScope.isCurrent(generation))button.disabled=false;}
}
if(button){button.addEventListener('click',refreshTelemetry);document.addEventListener('numina-owner-access-lost',clearTelemetry);window.addEventListener('pagehide',clearTelemetry);}
