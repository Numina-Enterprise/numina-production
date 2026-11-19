import { AutonomousSwarmDispatcher, CLUSTER_STATE_ROOT, SPRINT_GID, OTTER_RAFT_SINGULARITY_MOTTO } from '../src/swarm-dispatcher.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Output deployment ledger directory
const ledgerDir = fileURLToPath(new URL('../deployments', import.meta.url));
if (!fs.existsSync(ledgerDir)) {
  fs.mkdirSync(ledgerDir, { recursive: true });
}

console.log('================================================================================');
console.log('NUMINA AUTONOMOUS SWARM: UNVERIFIED DIVISION PREPARATION');
console.log(`Cluster State Root: ${CLUSTER_STATE_ROOT}`);
console.log(`Sprint GID:         ${SPRINT_GID}`);
console.log(`Singularity Motto:  ${OTTER_RAFT_SINGULARITY_MOTTO}`);
console.log('================================================================================');

const dispatcher = new AutonomousSwarmDispatcher();

export async function deploySwarm() {
  const deploymentCycle = await dispatcher.runParallelSwarmCycle();
  const deploymentRecord = {
    deploymentId: `dep-${Date.now()}`,
    preparedAt: new Date().toISOString(),
    deploymentVerified: false,
    milestone: 'Milestone 2',
    singularityProtocol: OTTER_RAFT_SINGULARITY_MOTTO,
    clusterStateRoot: CLUSTER_STATE_ROOT,
    sprintGid: SPRINT_GID,
    divisionsCount: deploymentCycle.results.length,
    divisionsExecuted: deploymentCycle.divisionsExecuted,
    divisions: deploymentCycle.results.map(r => ({
      divisionId: r.divisionId,
      room: r.room,
      task: r.task,
      status: r.status,
      proofDigest: r.proofDigest,
      executionReceipt: r.executionReceipt
    }))
  };

  const recordPath = path.join(ledgerDir, `swarm-deployment-${deploymentRecord.deploymentId}.json`);
  fs.writeFileSync(recordPath, JSON.stringify(deploymentRecord, null, 2), 'utf-8');

  console.log(`\n[UNVERIFIED] ${deploymentRecord.divisionsCount} division records prepared; ${deploymentRecord.divisionsExecuted} verified executed`);
  console.log(`Deployment ledger archived: ${recordPath}\n`);

  for (const div of deploymentRecord.divisions) {
    console.log(`[UNVERIFIED] ${div.divisionId.padEnd(30)} -> Room: ${div.room.padEnd(32)} | Proof: ${div.proofDigest ?? 'NONE'}`);
  }

  console.log('\n================================================================================');
  console.log('NO WORKER EXECUTION OR DEPLOYMENT VERIFIED');
  console.log('================================================================================');
  return deploymentRecord;
}

if (process.argv[1]?.endsWith('deploy-divisions.mjs')) {
  deploySwarm().catch(err => {
    console.error('[DEPLOYMENT_ERROR]', err);
    process.exit(1);
  });
}
