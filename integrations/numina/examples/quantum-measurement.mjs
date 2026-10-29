import {measureNuminaCircuit} from '../src/quantum-backend.js';
import {optimizeQuantumJob} from '../src/quantum.js';
const input={id:'numina-local-bell-1',Principal:'local-example',Authority:'local-computation',Objective:'Measure a Bell circuit using classical simulation',Intent:{qubits:2,shots:4096,gates:[{gate:'X',target:0},{gate:'X',target:0},{gate:'H',target:0},{gate:'CX',control:0,target:1}],measure:[0,1]}};
const optimized=await optimizeQuantumJob(input,'numina-local-bell-optimized-1');
const {schema,...request}=optimized.job.request;
const measurement=await measureNuminaCircuit(request);
console.log(JSON.stringify({schema:'numina.local-compute-run.v1',execution:'local_classical_simulator',optimization:{originalGateCount:optimized.originalGateCount,optimizedGateCount:optimized.optimizedGateCount,removedGates:optimized.removedGates,hardwareSpeedupMeasured:false},measurement},null,2));
