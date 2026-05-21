import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { spawn } from 'child_process';

dotenv.config({ path: '.env.local' });
dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key';
const token = jwt.sign({
  email: 'test@company.com',
  name: '陳小明 (Ming Chen)',
  dept: 'MK (行銷企劃部)',
  roles: ['ROLE:EMPLOYEE']
}, JWT_SECRET);

async function runTests() {
  console.log("Starting backend UBN API validation tests...\n");

  const testCases = [
    '23307406', // TSMC (should hit local fallback dictionary)
    '23223007', // Foxconn (should hit local fallback dictionary)
    '99999999', // Random 8-digit UBN (should generate procedurally)
  ];

  for (const taxId of testCases) {
    const url = `http://localhost:3000/api/company/${taxId}`;
    console.log(`Querying ${taxId}...`);
    try {
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      console.log(`Status: ${res.status}`);
      const data = await res.json();
      console.log(`Response:`, JSON.stringify(data, null, 2));
      console.log(`-----------------------------------`);
    } catch (err) {
      console.error(`Error querying ${taxId}:`, err.message);
    }
  }
}

// Start dev server in non-interactive background process
const server = spawn('npx', ['tsx', 'server.ts'], {
  stdio: 'ignore', // Ignore stdout/stderr to keep test output clean
  shell: true
});

console.log("Starting dev server in background, waiting 4 seconds to initialize...");

// Wait 4 seconds for server to start, then run tests
setTimeout(async () => {
  try {
    await runTests();
  } catch (e) {
    console.error("Test execution failed:", e);
  } finally {
    console.log("Shutting down dev server...");
    // Kill the spawned process tree
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', server.pid.toString(), '/f', '/t']);
    } else {
      server.kill();
    }
    setTimeout(() => process.exit(0), 1000);
  }
}, 4000);
