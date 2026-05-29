const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;
const BASIC_USER = process.env.BASIC_USER || 'sf_user';
const BASIC_PASS = process.env.BASIC_PASS || 'sf_pass';

function fetchNominatim(address) {
  return new Promise((resolve, reject) => {
    const encoded = encodeURIComponent(address);
    const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&addressdetails=1&limit=1`;
    const options = {
      headers: { 'User-Agent': 'BTP-SuccessFactors-AddressSplitter' }
    };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // Basic Auth check
  const authHeader = req.headers['authorization'] || '';
  if (authHeader) {
    const base64 = authHeader.replace('Basic ', '');
    const decoded = Buffer.from(base64, 'base64').toString('utf-8');
    const [user, pass] = decoded.split(':');
    if (user !== BASIC_USER || pass !== BASIC_PASS) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Address API"' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
  }

  if (req.method === 'POST' && req.url === '/sap/bc/http/sap/Z_API_ADDRESS_SPLIT') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        // Handle empty body
        if (!body || body.trim() === '') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ street: '', house_number: '', zip_code: '', city: '' }));
          return;
        }

        const parsed = JSON.parse(body);

        // Handle missing or empty address — return empty result instead of 400
        if (!parsed.address || parsed.address.trim() === '') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ street: '', house_number: '', zip_code: '', city: '' }));
          return;
        }

        const results = await fetchNominatim(parsed.address);

        if (!results || results.length === 0) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ street: '', house_number: '', zip_code: '', city: '' }));
          return;
        }

        const addr = results[0].address || {};
        const output = {
          street:       addr.road        || addr.pedestrian || addr.footway || '',
          house_number: addr.house_number || '',
          zip_code:     addr.postcode    || '',
          city:         addr.city        || addr.town || addr.village || addr.municipality || ''
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(output));

      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });

  } else if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok' }));

  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, () => console.log(`Address splitter API running on port ${PORT}`));
