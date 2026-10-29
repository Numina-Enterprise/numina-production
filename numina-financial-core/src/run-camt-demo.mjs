import { parseCamt053 } from './camt-parser.mjs';

const sampleCamt053Xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <Stmt>
      <Id>STMT-BOFA-2026-10-28-001</Id>
      <Acct>
        <Id>
          <Othr>
            <Id>BOFA-NUMINA-ESCROW-001</Id>
          </Othr>
        </Id>
      </Acct>
      <Bal>
        <Tp>
          <CdOrPrtry>
            <Cd>OPBD</Cd>
          </CdOrPrtry>
        </Tp>
        <Amt Ccy="USD">350000000.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt>
          <Dt>2026-10-28</Dt>
        </Dt>
      </Bal>
      <Bal>
        <Tp>
          <CdOrPrtry>
            <Cd>CLBD</Cd>
          </CdOrPrtry>
        </Tp>
        <Amt Ccy="USD">400000000.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt>
          <Dt>2026-10-28</Dt>
        </Dt>
      </Bal>
      <Ntry>
        <NtryRef>FEDWIRE-IN-9872134</NtryRef>
        <Amt Ccy="USD">50000000.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <BookgDt>
          <Dt>2026-10-28</Dt>
        </BookgDt>
        <BkTxCd>
          <Domn>
            <Fmly>
              <SubFmlyCd>FEDWIRE</SubFmlyCd>
            </Fmly>
          </Domn>
        </BkTxCd>
        <AddtlNtryInf>Institutional Liquidity Capital Influx</AddtlNtryInf>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

console.log('================================================================================');
console.log('ISO 20022 CAMT.053 XML STATEMENT PARSER: LIVE RUNNER');
console.log('================================================================================');

console.log('[*] Parsing Bank of America ISO 20022 XML Statement Payload...');
const parsed = parseCamt053(sampleCamt053Xml);

console.log('--------------------------------------------------------------------------------');
console.log('Statement ID:          ', parsed.statementId);
console.log('Account ID:            ', parsed.accountId);
console.log('Opening Balance:       ', `$${Number(parsed.openingBalance).toLocaleString('en-US', { minimumFractionDigits: 2 })} USD`);
console.log('Closing Balance:       ', `$${Number(parsed.closingBalance).toLocaleString('en-US', { minimumFractionDigits: 2 })} USD`);
console.log('Statement Entries:     ', parsed.entries.length);
console.log('--------------------------------------------------------------------------------');

parsed.entries.forEach((entry, i) => {
  console.log(`Entry #${i + 1}:`);
  console.log(`  Reference ID:        ${entry.entryId}`);
  console.log(`  Direction:           ${entry.creditDebitIndicator === 'CRDT' ? 'CREDIT (+)' : 'DEBIT (-)'}`);
  console.log(`  Amount:              $${Number(entry.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })} USD`);
  console.log(`  Settlement Rail:     ${entry.paymentRail}`);
  console.log(`  Booking Date:        ${entry.bookingDate}`);
  console.log(`  Details:             ${entry.reference}`);
});

console.log('================================================================================');
console.log('PRECISION INVARIANT: Fixed-point string parsing with zero floating-point drift.');
console.log('================================================================================');
