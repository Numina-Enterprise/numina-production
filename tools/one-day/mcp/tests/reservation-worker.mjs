import {parentPort,workerData} from 'node:worker_threads';
import {ReservationStore} from '../reservation-store.mjs';
const store=new ReservationStore(workerData.path,workerData.policy);
try{parentPort.postMessage(await store.commit(workerData.input));}finally{store.close();}
