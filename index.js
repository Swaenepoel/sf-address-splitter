const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;
const BASIC_USER = process.env.BASIC_USER || 'sf_user';
const BASIC_PASS = process.env.BASIC_PASS || 'sf_pass';

function fetchNominatim(address) {
  return new Promise((resolve, reject) => {
    const encoded = encodeURIComponent(address);
    const url = 'https://nominatim.openstreetmap.org/search?q=' + encoded + '&format=json&addressdetails=1&limit=1';
    const options = { headers: { 'User-Agent': 'BTP-SuccessFactors-AddressSplitter' } };
    https.get(url, options, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

var countryToISO3 = {
  'united states': 'USA', 'us': 'USA', 'usa': 'USA',
  'united states of america': 'USA', 'united kingdom': 'GBR',
  'uk': 'GBR', 'germany': 'DEU', 'france': 'FRA',
  'netherlands': 'NLD', 'belgium': 'BEL', 'spain': 'ESP',
  'italy': 'ITA', 'canada': 'CAN', 'australia': 'AUS',
  'india': 'IND', 'china': 'CHN', 'japan': 'JPN',
  'brazil': 'BRA', 'mexico': 'MEX', 'sweden': 'SWE',
  'norway': 'NOR', 'denmark': 'DNK', 'finland': 'FIN',
  'switzerland': 'CHE', 'austria': 'AUT', 'poland': 'POL',
  'portugal': 'PRT', 'ireland': 'IRL'
};

function getISO3Country(name, fallback) {
  if (!name) return fallback || 'USA';
  return countryToISO3[name.toLowerCase().trim()] || fallback || 'USA';
}

function extractField(body, fieldName) {
  var idx = body.indexOf('"' + fieldName + '"');
  if (idx === -1) return '';
  var rest = body.substring(idx + fieldName.length + 2);
  var colon = rest.indexOf(':');
  if (colon === -1) return '';
  rest = rest.substring(colon + 1).trim();
  if (rest[0] === '"') {
    var end = rest.indexOf('"', 1);
    return end === -1 ? '' : rest.substring(1, end);
  }
  return '';
}

function safeParseJSON(body) {
  try {
    return JSON.parse(body);
  } catch(e) {
    return {
      address: extractField(body, 'address'),
      country: extractField(body, 'country'),
      addressType: extractField(body, 'addressType'),
      personIdExternal: extractField(body, 'personIdExternal'),
      startDate: extractField(body, 'startDate')
    };
  }
}

var server = http.createServer(function(req, res) {
  var authHeader = req.headers['authorization'] || '';
  if (authHeader) {
    var base64 = authHeader.replace('Basic ', '');
    var decoded = Buffer.from(base64, 'base64').toString('utf-8');
    var parts = decoded.split(':');
    var user = parts[0];
    var pass = parts.slice(1).join(':');
    if (user !== BASIC_USER || pass !== BASIC_PASS) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Address API"' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
  }

  if (req.method === 'POST' && req.url === '/sap/bc/http/sap/Z_API_ADDRESS_SPLIT') {
    var body = '';
    req.on('data', function(chunk) { body += chunk; });
    req.on('end', function() {
      var parsed = safeParseJSON(body || '{}');
      var inputCountry = parsed.country || 'USA';
      var addressType = parsed.addressType || 'home';
      var personIdExternal = parsed.personIdExternal || '';
      var startDate = parsed.startDate || '';

      if (!parsed.address || parsed.address.trim() === '') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ street: '', house_number: '', zip_code: '', city: '', country: inputCountry, addressType: addressType, personIdExternal: personIdExternal, startDate: startDate }));
        return;
      }

      fetchNominatim(parsed.address).then(function(results) {
        if (!results || results.length === 0) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ street: '', house_number: '', zip_code: '', city: '', country: inputCountry, addressType: addressType, personIdExternal: personIdExternal, startDate: startDate }));
          return;
        }
        var addr = results[0].address || {};
        var output = {
          street: addr.road || addr.pedestrian || addr.footway || '',
          house_number: addr.house_number || '',
          zip_code: addr.postcode || '',
          city: addr.city || addr.town || addr.village || addr.municipality || '',
          country: getISO3Country(addr.country || '', inputCountry),
          addressType: addressType,
          personIdExternal: personIdExternal,
          startDate: startDate
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(output));
      }).catch(function(e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      });
    });

  } else if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok' }));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, function() {
  console.log('Address splitter API running on port ' + PORT);
});
