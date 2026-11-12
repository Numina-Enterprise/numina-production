import {controlError} from '../control.js';
import {amountText,requirePositiveAmount} from './amounts.js';

// Reference copy: numina-smart-contracts/contracts/NuminaRevenueSplitter.sol
// SHA-256 685d081ff1b4485a112eeb926f4e0edff71b419879b655d8b7ceb31a8d22f000 (2122 bytes).
// The reference receive() calls distributeRevenue(), which forwards with transfer.
// Weights are 70/20/10. Integer-division remainder is assigned to protocol.
export const REVENUE_SPLITTER_REFERENCE=Object.freeze({
  label:'reference-original',
  path:'numina-smart-contracts/contracts/NuminaRevenueSplitter.sol',
  sha256:'685d081ff1b4485a112eeb926f4e0edff71b419879b655d8b7ceb31a8d22f000',
  bytes:2122,
  reserveBps:7000,stakingBps:2000,protocolBps:1000,totalBps:10000,
  knownIssues:Object.freeze([
    'receive() immediately calls distributeRevenue()',
    'distributeRevenue() forwards native value with transfer',
    '70/20/10 integer division; remainder is assigned to protocol'
  ])
});

const RESERVE_BPS=7000n,STAKING_BPS=2000n,PROTOCOL_BPS=1000n,TOTAL_BPS=10000n;

export function splitRevenueAmount(amount){
  const total=requirePositiveAmount(amount,'ZERO_REVENUE');
  const reserve=(total*RESERVE_BPS)/TOTAL_BPS;
  const staking=(total*STAKING_BPS)/TOTAL_BPS;
  const protocol=total-reserve-staking;
  if(reserve+staking+protocol!==total)controlError('SPLIT_NOT_CONSERVED',409);
  if(RESERVE_BPS+STAKING_BPS+PROTOCOL_BPS!==TOTAL_BPS)controlError('BPS_NOT_CONSERVED',409);
  return Object.freeze({
    amount:amountText(total),
    reserve:amountText(reserve),
    staking:amountText(staking),
    protocol:amountText(protocol)
  });
}

// Preparation only. Inbound value is accounted and is not forwarded.
export function prepareRevenueDistribution(amount){
  const shares=splitRevenueAmount(amount);
  return Object.freeze({
    schema:'numina.treasury.revenue-splitter.preparation.v1',
    module:'revenue-splitter',
    status:'PREPARED',
    reference:REVENUE_SPLITTER_REFERENCE.path,
    executionPerformed:false,
    valueForwarded:false,
    submissionPerformed:false,
    shares
  });
}

export function executeRevenueDistribution(){
  controlError('REVENUE_DISTRIBUTION_EXECUTION_NOT_WIRED',409);
}
