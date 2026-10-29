import tls from 'tls';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simple .env parser to avoid any third-party dependencies
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

loadEnv();

const SMTP_HOST = process.env.PORKBUN_SMTP_HOST || 'smtp.porkbun.com';
const SMTP_PORT = parseInt(process.env.PORKBUN_SMTP_PORT || '465', 10);
const SENDER_EMAIL = process.env.PORKBUN_EMAIL || 'skott34@numinalabs.xyz';
const SENDER_PASSWORD = process.env.PORKBUN_PASSWORD;
const RECIPIENT_EMAIL = process.argv[2] || process.env.RECIPIENT_EMAIL || 'cloudstartupsupport@google.com';
const EMAIL_SUBJECT = process.env.EMAIL_SUBJECT || 'Numina Labs Enterprise Certification & Production State Verification';

if (!SENDER_PASSWORD) {
  console.error('\x1b[31m[ERROR]\x1b[0m PORKBUN_PASSWORD is not set.');
  console.error('Please run with:');
  console.error('  $env:PORKBUN_PASSWORD="your-password"; node send_porkbun_email.mjs');
  process.exit(1);
}

const emailBody = `From: "Samuel J. Kott (Numina Labs)" <${SENDER_EMAIL}>
To: ${RECIPIENT_EMAIL}
Subject: ${EMAIL_SUBJECT}
MIME-Version: 1.0
Content-Type: text/plain; charset=UTF-8

Dear Google Team,

I am writing on behalf of Numina Labs regarding our enterprise production architecture and platform integration.

We have officially finalized and ratified our enterprise sovereign cluster state (Cluster State Root: 726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd) under Sprint GID 1219183110870936.

Key Ratified Highlights:
- Production Web Origin: https://numinalabs.xyz (Strict HSTS & CSP enforced)
- Stripe Treasury Application (com.numinalabs.treasury v0.1.0)
- Google Cloud Project Alignment: project-0317d6c9-e943-409e-83f (us-central1-a)
- 1:1 Institutional Reserve Solvency across Tokenized RWAs (BUIDL, BENJI, USDY)
- 169/169 Comprehensive System Test Suite Pass Rate

We look forward to proceeding with our scheduled enterprise deployment workflows. Please let us know if additional verified audit proofs or technical disclosures are required from our side.

Sincerely,

Samuel J. Kott
Founder & Authority Lead | Numina Labs
skott34@numinalabs.xyz
https://numinalabs.xyz
`;

console.log('==========================================================');
console.log(' NUMINA PORKBUN SMTP DISPATCHER (ZERO-DEPENDENCY)');
console.log('==========================================================');
console.log(`Target:    ${SMTP_HOST}:${SMTP_PORT}`);
console.log(`From:      ${SENDER_EMAIL}`);
console.log(`To:        ${RECIPIENT_EMAIL}`);
console.log(`Subject:   ${EMAIL_SUBJECT}`);
console.log('----------------------------------------------------------');

function sendMail() {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(SMTP_PORT, SMTP_HOST, { minVersion: 'TLSv1.2' }, () => {
      console.log('[*] Connected via TLS to Porkbun SMTP.');
    });

    socket.setEncoding('utf8');

    let stage = 0;
    let buffer = '';

    const authB64User = Buffer.from(SENDER_EMAIL).toString('base64');
    const authB64Pass = Buffer.from(SENDER_PASSWORD).toString('base64');

    socket.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\r\n');
      buffer = lines.pop(); // keep last incomplete chunk

      for (const line of lines) {
        if (!line) continue;
        console.log(`S: ${line}`);
        const code = parseInt(line.substring(0, 3), 10);

        if (code >= 400) {
          socket.end();
          return reject(new Error(`SMTP Error [${code}]: ${line}`));
        }

        // Only act on final response lines (line without hyphen after code)
        if (line.charAt(3) === '-') continue;

        if (stage === 0 && code === 220) {
          stage = 1;
          const cmd = 'EHLO numinalabs.xyz\r\n';
          console.log(`C: EHLO numinalabs.xyz`);
          socket.write(cmd);
        } else if (stage === 1 && code === 250) {
          stage = 2;
          console.log(`C: AUTH LOGIN`);
          socket.write('AUTH LOGIN\r\n');
        } else if (stage === 2 && code === 334) {
          stage = 3;
          console.log(`C: [Base64 Username]`);
          socket.write(authB64User + '\r\n');
        } else if (stage === 3 && code === 334) {
          stage = 4;
          console.log(`C: [Base64 Password]`);
          socket.write(authB64Pass + '\r\n');
        } else if (stage === 4 && code === 235) {
          stage = 5;
          console.log(`C: MAIL FROM:<${SENDER_EMAIL}>`);
          socket.write(`MAIL FROM:<${SENDER_EMAIL}>\r\n`);
        } else if (stage === 5 && code === 250) {
          stage = 6;
          console.log(`C: RCPT TO:<${RECIPIENT_EMAIL}>`);
          socket.write(`RCPT TO:<${RECIPIENT_EMAIL}>\r\n`);
        } else if (stage === 6 && code === 250) {
          stage = 7;
          console.log(`C: DATA`);
          socket.write('DATA\r\n');
        } else if (stage === 7 && code === 354) {
          stage = 8;
          console.log(`C: [Sending Email Payload]`);
          socket.write(emailBody.replace(/\n/g, '\r\n') + '\r\n.\r\n');
        } else if (stage === 8 && code === 250) {
          stage = 9;
          console.log(`C: QUIT`);
          socket.write('QUIT\r\n');
        } else if (stage === 9 && (code === 221 || code === 250)) {
          console.log('\x1b[32m[SUCCESS]\x1b[0m Email sent cleanly and connection closed.');
          socket.end();
          return resolve();
        }
      }
    });

    socket.on('error', (err) => {
      reject(err);
    });

    socket.on('end', () => {
      if (stage >= 8) resolve();
    });
  });
}

sendMail().catch((err) => {
  console.error('\x1b[31m[FAILED]\x1b[0m', err.message);
  process.exit(1);
});
