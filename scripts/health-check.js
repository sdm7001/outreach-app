'use strict';

const http = require('http');

const PORT = process.env.PORT || 3848;
const url = `http://localhost:${PORT}/health`;

const req = http.get(url, (res) => {
  let body = '';
  res.on('data', chunk => { body += chunk; });
  res.on('end', () => {
    try {
      const data = JSON.parse(body);
      if (data.status === 'ok' || data.status === 'degraded') {
        console.log(`[health] ${data.status.toUpperCase()} — uptime: ${Math.round(data.uptime)}s`);
        process.exit(data.status === 'ok' ? 0 : 1);
      } else {
        console.error('[health] Unexpected response:', body);
        process.exit(1);
      }
    } catch {
      console.error('[health] Invalid JSON response:', body);
      process.exit(1);
    }
  });
});

req.setTimeout(5000, () => {
  console.error(`[health] TIMEOUT — server at ${url} did not respond within 5s`);
  req.destroy();
  process.exit(1);
});

req.on('error', (err) => {
  console.error(`[health] ERROR — ${err.message}`);
  process.exit(1);
});
