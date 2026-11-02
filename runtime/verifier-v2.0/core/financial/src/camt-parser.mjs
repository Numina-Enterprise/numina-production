import { XMLParser } from 'fast-xml-parser';
import { parseMonetaryToUnits } from './money.mjs';

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, trimValues: true, parseTagValue: false });
const array = (value) => value === undefined ? [] : Array.isArray(value) ? value : [value];
const text = (value) => typeof value === 'object' && value !== null ? value['#text'] : value;
const dateText = (value) => typeof value === 'object' && value !== null ? value.Dt || value.DtTm : value;

function amount(value) {
  const raw = text(value);
  if (typeof raw !== 'string') throw new Error('CAMT_AMOUNT_REQUIRED');
  return raw;
}

export function parseCamt053(xml) {
  if (typeof xml !== 'string' || !xml.trim()) throw new Error('CAMT_XML_REQUIRED');
  const document = parser.parse(xml);
  const statement = document.Document?.BkToCstmrStmt?.Stmt;
  if (!statement) throw new Error('CAMT053_STATEMENT_NOT_FOUND');
  const balances = array(statement.Bal);
  const opening = balances.find((balance) => text(balance.Tp?.CdOrPrtry?.Cd) === 'OPBD' || text(balance.Tp?.CdOrPrtry?.Cd) === 'PRCD');
  const closing = balances.find((balance) => text(balance.Tp?.CdOrPrtry?.Cd) === 'CLBD' || text(balance.Tp?.CdOrPrtry?.Cd) === 'CLAV');
  if (!opening || !closing) throw new Error('CAMT053_BALANCES_REQUIRED');
  const entries = array(statement.Ntry).map((entry, index) => {
    const entryId = text(entry.NtryRef) || `NTRY-${index + 1}`;
    const indicator = text(entry.CdtDbtInd);
    if (indicator !== 'CRDT' && indicator !== 'DBIT') throw new Error('CAMT053_INDICATOR_INVALID');
    return {
      entryId,
      bookingDate: dateText(entry.BookgDt),
      amount: amount(entry.Amt),
      creditDebitIndicator: indicator,
      paymentRail: text(entry.BkTxCd?.Domn?.Fmly?.SubFmlyCd) || 'UNKNOWN',
      reference: text(entry.AddtlNtryInf) || null,
    };
  });
  parseMonetaryToUnits(amount(opening.Amt));
  parseMonetaryToUnits(amount(closing.Amt));
  return {
    statementId: text(statement.Id),
    accountId: text(statement.Acct?.Id?.IBAN || statement.Acct?.Id?.Othr?.Id),
    openingBalance: amount(opening.Amt),
    closingBalance: amount(closing.Amt),
    entries,
  };
}
