import {controlError} from '../control.js';
import {amountText,requireDecimals,requirePositiveAmount} from './amounts.js';

// Integer ledger of recorded base units. It does not claim external solvency or add across decimal variants.
const COMPONENT=/^[a-z0-9][a-z0-9-]{0,63}$/;

export function createSolvencyLedger(){
  return Object.freeze({
    schema:'numina.treasury.solvency-ledger.v1',
    module:'solvency-ledger',
    entries:Object.freeze([]),
    externallySolvent:false,
    executionPerformed:false
  });
}

export function postSolvencyEntry(ledger,entry){
  if(!ledger||ledger.schema!=='numina.treasury.solvency-ledger.v1'||ledger.executionPerformed!==false)controlError('SOLVENCY_LEDGER_INVALID',409);
  if(!entry||typeof entry.id!=='string'||!COMPONENT.test(entry.id)||typeof entry.component!=='string'||!COMPONENT.test(entry.component))controlError('INVALID_SOLVENCY_ENTRY',400);
  if(entry.direction!=='asset'&&entry.direction!=='liability')controlError('INVALID_SOLVENCY_ENTRY',400);
  if(ledger.entries.some(item=>item.id===entry.id))controlError('DUPLICATE_SOLVENCY_ENTRY',409);
  const decimals=requireDecimals(entry.decimals);
  const baseUnits=requirePositiveAmount(entry.baseUnits,'INVALID_AMOUNT');
  const posted=Object.freeze({id:entry.id,component:entry.component,decimals,direction:entry.direction,baseUnits:amountText(baseUnits)});
  return Object.freeze({
    ...ledger,
    entries:Object.freeze([...ledger.entries,posted]),
    externallySolvent:false,
    executionPerformed:false
  });
}

export function solvencyResidual(ledger,decimals){
  requireDecimals(decimals);
  let assets=0n,liabilities=0n;
  for(const entry of ledger.entries){
    if(entry.decimals!==decimals)continue;
    const amount=BigInt(entry.baseUnits);
    if(entry.direction==='asset')assets+=amount;
    else liabilities+=amount;
  }
  return Object.freeze({
    decimals,
    assets:amountText(assets),
    liabilities:amountText(liabilities),
    residual:amountText(assets>=liabilities?assets-liabilities:liabilities-assets),
    residualSign:assets>=liabilities?'non-negative':'deficit',
    externallySolvent:false,
    executionPerformed:false
  });
}

export function combinedSolvency(ledger){
  const decimals=new Set(ledger.entries.map(entry=>entry.decimals));
  if(decimals.size>1)controlError('DECIMAL_VARIANTS_NOT_ADDITIVE',409);
  const only=[...decimals][0]??0;
  return solvencyResidual(ledger,only);
}
