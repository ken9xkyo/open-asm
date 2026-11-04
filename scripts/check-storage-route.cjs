// Generate a short-lived URL with the deployed signer, then check the host
// proxy without printing credentials or the signed query string.
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');

async function sign() {
  const { ConfigService } = require('/app/node_modules/@nestjs/config');
  const { RustFsClient } = require('/app/dist/modules/storage/rustfs.client');
  const { StorageService } = require('/app/dist/modules/storage/storage.service');
  const config = new ConfigService();
  const client = new RustFsClient(config);
  try {
    const storage = new StorageService(client, config, undefined);
    const { url } = await storage.getClientUrlForPath(
      process.env.STORAGE_CHECK_PATH,
      { expiresIn: 120 },
    );
    process.stdout.write(JSON.stringify({ url }));
  } finally {
    client.getClient().destroy();
    client.getPresignClient().destroy();
  }
}

function request(origin, path) {
  return new Promise((resolve, reject) => {
    const target = new URL(path, origin);
    // Resolve to this host: exercise its TLS vhost without depending on DNS
    // or sending the short-lived signature to another server.
    const transport = target.protocol === 'https:' ? https : http;
    const req = transport.get(target, {
      lookup: (_host, options, callback) => options.all
        ? callback(null, [{ address: '127.0.0.1', family: 4 }])
        : callback(null, '127.0.0.1', 4),
      timeout: 10000,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        type: res.headers['content-type'] ?? '',
        body: Buffer.concat(chunks),
      }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
  });
}

async function check() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const { url } = JSON.parse(input);
  const direct = await request('http://localhost:3000', url);
  const proxy = await request('https://asm.vtccloud.vn', url);
  for (const [name, result] of [['console', direct], ['HTTPS proxy', proxy]]) {
    console.log(`${name}: HTTP ${result.status}, ${result.type}, ${result.body.length} bytes`);
    assert.equal(result.status, 200, `${name}: screenshot must be accessible`);
    assert.match(result.type, /^image\//, `${name}: expected an image`);
    assert.ok(result.body.length > 0, `${name}: empty image`);
  }
  assert.deepEqual(proxy.body, direct.body, 'Proxy must preserve image bytes');
  const unsigned = await request('https://asm.vtccloud.vn', url.split('?')[0]);
  assert.equal(unsigned.status, 403, 'Unsigned screenshot must remain private');
  const health = await request('https://asm.vtccloud.vn', '/api/health');
  assert.equal(health.status, 200, 'API must remain accessible');
  const presign = await request('https://asm.vtccloud.vn', '/api/storage/presign/download');
  assert.equal(presign.status, 401, 'Presign endpoint must retain API authentication');
  console.log('PASS: identical image, unsigned access denied, API and presign routing intact');
}

(process.argv.includes('--check') ? check() : sign()).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
