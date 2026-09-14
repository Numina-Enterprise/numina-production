import {createQuantumAdapter} from '../src/quantum.js';
const quantum = createQuantumAdapter(); // No driver, credentials or paid submission.
const prepared = await quantum.prepare({
  id: 'bell-example-1', Principal: 'example-principal', Authority: 'host-authorization-required',
  Objective: 'Prepare a two-qubit Bell circuit',
  Intent: {qubits: 2, shots: 1000, gates: [{gate: 'H', target: 0}, {gate: 'CX', control: 0, target: 1}], measure: [0, 1]}
});
console.log(JSON.stringify({capabilities: quantum.capabilities(), prepared}, null, 2));
