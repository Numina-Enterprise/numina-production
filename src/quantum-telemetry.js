// Copyright © 2026 SK Consulting LLC. Numina™. See OWNERSHIP.md.
import {NUMINA_QUANTUM_LIMITS} from './quantum-backend.js';
import {TELEMETRY_BOUNDS_MS, TELEMETRY_VERSION} from './telemetry.js';

// Admission and observation share one process-local counter. No circuit or owner data is retained.
export function createQuantumWorkloadTelemetry({now=()=>Date.now(),clock=()=>performance.now(),emit=value=>console.log(JSON.stringify(value))}={}) {
  const started=now(),instanceId=crypto.randomUUID(),buckets=new Map();
  let active=0,rateMinute=-1,rateCount=0,loggingFailures=0;
  function minuteAt(time) {
    const minute=Math.floor(time/60000);
    if(minute!==rateMinute){rateMinute=minute;rateCount=0;}
    for(const key of buckets.keys())if(key<minute-4||key>minute)buckets.delete(key);
    return minute;
  }
  function bucket(time) {
    const minute=minuteAt(time);
    if(!buckets.has(minute))buckets.set(minute,{admitted:0,completed:0,succeeded:0,failed:0,invalid:0,
      concurrencyLimited:0,rateLimited:0,peakActive:0,qubits:0,gates:0,shots:0,computeMs:0,
      histogram:Array(TELEMETRY_BOUNDS_MS.length+1).fill(0)});
    return buckets.get(minute);
  }
  function event(outcome,durationMs,work,log,time) {
    if(!log)return;
    try {emit({schema:'numina.quantum-metric.v1',operation:'measure',outcome,version:TELEMETRY_VERSION,
      instanceId,eventId:crypto.randomUUID(),observedAt:new Date(time).toISOString(),
      provider:'numina-statevector',kind:'classical_simulator',durationMs,activeJobs:active,
      ...(work?{qubits:work.qubits,gates:work.gates,shots:work.shots,computeDurationMs:work.durationMs}:{})});}
    catch{loggingFailures++;}
  }
  return {
    begin({log=true}={}) {
      const time=now(),row=bucket(time);
      const reason=active>=NUMINA_QUANTUM_LIMITS.concurrentPerProcess?'concurrency_limited'
        :rateCount>=NUMINA_QUANTUM_LIMITS.requestsPerMinutePerProcess?'rate_limited':null;
      if(reason) {
        row[reason==='concurrency_limited'?'concurrencyLimited':'rateLimited']++;
        event(reason,0,null,log,time);
        return {admitted:false,reason,retryAfterSeconds:reason==='concurrency_limited'?1:Math.max(1,Math.ceil((60000-time%60000)/1000))};
      }
      active++;rateCount++;row.admitted++;row.peakActive=Math.max(row.peakActive,active);
      const start=clock();let finished=false;
      return {admitted:true,finish(outcome,result) {
        if(finished)return;
        finished=true;
        const peakBeforeFinish=active;
        active=Math.max(0,active-1);
        const time=now(),row=bucket(time),elapsed=clock()-start;
        const durationMs=Number.isFinite(elapsed)?Math.max(0,elapsed):0;
        let safeOutcome=['succeeded','invalid_request','service_unavailable'].includes(outcome)?outcome:'service_unavailable';
        const validWork=result&&Number.isInteger(result.qubits)&&result.qubits>=1&&result.qubits<=NUMINA_QUANTUM_LIMITS.qubits
          &&Number.isInteger(result.gates)&&result.gates>=0&&result.gates<=NUMINA_QUANTUM_LIMITS.gates
          &&Number.isInteger(result.shots)&&result.shots>=1&&result.shots<=NUMINA_QUANTUM_LIMITS.shots
          &&Number.isFinite(result.durationMs)&&result.durationMs>=0;
        if(safeOutcome==='succeeded'&&!validWork)safeOutcome='service_unavailable';
        row.completed++;row.peakActive=Math.max(row.peakActive,peakBeforeFinish);
        if(safeOutcome==='succeeded') {
          row.succeeded++;row.qubits+=result.qubits;row.gates+=result.gates;row.shots+=result.shots;row.computeMs+=result.durationMs;
          const bound=TELEMETRY_BOUNDS_MS.findIndex(limit=>result.durationMs<=limit);
          row.histogram[bound<0?TELEMETRY_BOUNDS_MS.length:bound]++;
        } else if(safeOutcome==='invalid_request')row.invalid++;
        else row.failed++;
        event(safeOutcome,durationMs,safeOutcome==='succeeded'?result:null,log,time);
      }};
    },
    snapshot() {
      const time=now(),minute=minuteAt(time);
      const sum={admitted:0,completed:0,succeeded:0,failed:0,invalid:0,concurrencyLimited:0,rateLimited:0,qubits:0,gates:0,shots:0,computeMs:0};
      let peakActive=active;const histogram=Array(TELEMETRY_BOUNDS_MS.length+1).fill(0);
      for(const row of buckets.values()) {
        for(const key of Object.keys(sum))sum[key]+=row[key];
        peakActive=Math.max(peakActive,row.peakActive);
        row.histogram.forEach((value,index)=>{histogram[index]+=value;});
      }
      const windowStart=Math.max(started,(minute-4)*60000),seconds=Math.max(1,(time-windowStart)/1000);
      let cumulative=0,p95Index=-1;
      if(sum.succeeded)p95Index=histogram.findIndex(value=>{cumulative+=value;return cumulative>=Math.ceil(sum.succeeded*.95);});
      const overflow=p95Index===TELEMETRY_BOUNDS_MS.length;
      const p95=p95Index<0||overflow?null:TELEMETRY_BOUNDS_MS[p95Index];
      const completedWork=sum.succeeded+sum.failed;
      const demand=completedWork+sum.concurrencyLimited+sum.rateLimited;
      const minimumSamples=20,signals=[];
      if(demand>=minimumSamples) {
        if(sum.failed/Math.max(1,completedWork)>=.01)signals.push('investigate_quantum_failures');
        if(sum.concurrencyLimited/demand>=.05)signals.push('review_stateless_compute_capacity');
        if(sum.rateLimited/demand>=.05)signals.push('review_quantum_request_rate_policy');
      }
      if(sum.succeeded>=minimumSamples&&(overflow||p95>1000))signals.push('investigate_quantum_compute_latency');
      return {schema:'numina.quantum-workload.v1',version:TELEMETRY_VERSION,instanceId,
        observedAt:new Date(time).toISOString(),scope:'current_process_only',persistence:'ephemeral',
        activeJobs:active,peakActiveJobs:peakActive,admittedThisMinute:rateCount,loggingFailures,
        limits:NUMINA_QUANTUM_LIMITS,
        window:{start:new Date(windowStart).toISOString(),end:new Date(time).toISOString(),
          admitted:sum.admitted,completed:sum.completed,succeeded:sum.succeeded,failed:sum.failed,invalidRequests:sum.invalid,
          concurrencyLimited:sum.concurrencyLimited,rateLimited:sum.rateLimited,successfulJobsPerSecond:sum.succeeded/seconds,
          completedQubits:sum.qubits,completedGates:sum.gates,completedShots:sum.shots,shotsPerSecond:sum.shots/seconds,
          failureRate:completedWork?sum.failed/completedWork:null,
          averageComputeMs:sum.succeeded?sum.computeMs/sum.succeeded:null,p95ComputeUpperBoundMs:p95,p95AboveLargestBucket:overflow,
          computeHistogram:{boundsMs:[...TELEMETRY_BOUNDS_MS,null],counts:histogram,cumulative:false}},
        capacity:{status:demand<minimumSamples?'insufficient_data':signals.length?'attention':'within_configured_thresholds',
          signals,minimumSamples,errorRateThreshold:.01,limitedRateThreshold:.05,p95TargetMs:1000,
          automaticScalingEnabled:false,fleetAggregationRequired:true,hardwareExecution:false,treasuryWrites:false}};
    }
  };
}
export const numinaQuantumWorkload=createQuantumWorkloadTelemetry();
