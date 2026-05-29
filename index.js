const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;
const BASIC_USER = process.env.BASIC_USER || 'sf_user';
const BASIC_PASS = process.env.BASIC_PASS || 'sf_pass';

function fetchNominatim(address) {
  return new Promise((resolve, reject) => {
    const encoded = encodeURIComponent(address);
    const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&addressdetails=1&limit=1`;
    const options = { headers: { 'User-Agent': 'BTP-SuccessFactors-AddressSplitter' } };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

const countryToISO3 = {
  'united states': 'USA', 'us': 'USA', 'usa': 'USA', 'united states of america': 'USA',
  'united kingdom': 'GBR', 'uk': 'GBR', 'germany': 'DEU', 'france': 'FRA',
  'netherlands': 'NLD', 'belgium': 'BEL', 'spain': 'ESP', 'italy': 'ITA',
  'canada': 'CAN', 'australia': 'AUS', 'india': 'IND', 'china': 'CHN',
  'japan': 'JPN', 'brazil': 'BRA', 'mexico': 'MEX', 'sweden': 'SWE',
  'norway': 'NOR', 'denmark': 'DNK', 'finland': 'FIN', 'switzerland': 'CHE',
  'austria': 'AUT', 'poland': 'POL', 'portugal': 'PRT', 'ireland': 'IRL'
};

function getISO3Country(countryName, fallback) {
  if (!countryName) return fallback || 'USA';
  return countryToISO3[countryName.toLowerCase().trim()] || fallback || 'USA';
}

// Try to parse body as JSON, handling XML or invalid content gracefully
function safeParseJSON(body) {
  try {
    return JSON.parse(body);
  } catch (e) {
    // Try to extract key fields from XML-like content using regex
    const result = {};
    const addressMatch = body.match(/"address"\s*:\s*"([^"]+)"/);
    const countryMatch = body.match(/"country"\s*:\s*"([^"]+)"/);
    const addressTypeMatch = body.match(/"addressType"\s*:\s*"([^"]+)"/);
    const personIdMatch = body.match(/"personIdExternal"\s*:\s*"([^"]+)"/);
    const startDateMatch = body.match(/"startDate"\s*:\s*"([^"]+)"/);
    const startDateMatch2 = body.match(/"startDate"\s*:\s*(/Date\([0-9]+\)/)/);
    if (addressMatch) result.address = addressMatch[1];
    if (countryMatch) result.country = countryMatch[1];
    if (addressTypeMatch) result.addressType = addressTypeMatch[1];
    if (personIdMatch) result.personIdExternal = personIdMatch[1];
    const startDateMatch = body.match(/"startDate"\s*:\s*"([^"]+)"/);
    if (startDateMatch) result.startDate = startDateMatch[1];
    return result;
  }
}

const server = http.createServer(async (req, res) => {
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
        const parsed = safeParseJSON(body || '{}');
        const inputCountry = parsed.country || 'USA';
        const addressType = parsed.addressType || 'home';
        const personIdExternal = parsed.personIdExternal || '';
        const startDate = parsed.startDate || '';

        if (!parsed.address || parsed.address.trim() === '') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ street: '', house_number: '', zip_code: '', city: '', country: inputCountry, addressType, personIdExternal, startDate }));
          return;
        }

        const results = await fetchNominatim(parsed.address);

        if (!results || results.length === 0) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ street: '', house_number: '', zip_code: '', city: '', country: inputCountry, addressType, personIdExternal, startDate }));
          return;
        }

        const addr = results[0].address || {};
        const output = {
          street:           addr.road || addr.pedestrian || addr.footway || '',
          house_number:     addr.house_number || '',
          zip_code:         addr.postcode || '',
          city:             addr.city || addr.town || addr.village || addr.municipality || '',
          country:          getISO3Country(addr.country || '', inputCountry),
          addressType:      addressType,
          personIdExternal: personIdExternal,
          startDate:        startDate
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
