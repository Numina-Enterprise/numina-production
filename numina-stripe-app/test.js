// Basic verification test for numina-stripe-app configuration
const fs = require('fs');
const path = require('path');

const manifestPath = path.join(__dirname, 'stripe-app.json');
if (!fs.existsSync(manifestPath)) {
  console.error("FAIL: stripe-app.json missing");
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.id !== 'com.numinalabs.treasury') {
  console.error(`FAIL: Unexpected app id: ${manifest.id}`);
  process.exit(1);
}

if (!manifest.ui_extension || !manifest.ui_extension.views || manifest.ui_extension.views.length === 0) {
  console.error("FAIL: Missing ui_extension views");
  process.exit(1);
}

console.log("PASS: numina-stripe-app manifest valid");
console.log(`App ID: ${manifest.id}`);
console.log(`Version: ${manifest.version}`);
console.log(`Views registered: ${manifest.ui_extension.views.map(v => v.viewport).join(', ')}`);
