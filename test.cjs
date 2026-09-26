const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8');
const key = env.split('\n').find(l => l.startsWith('BATCHDATA_API_KEY=')).split('=')[1].trim();

fetch('https://api.batchdata.com/api/v1/property/search', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + key,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    searchCriteria: {
      'address.street': { "equals": '19527 E LAKEWAY DR' },
      'address.city': { "equals": 'BATON ROUGE' },
      'address.state': { "equals": 'LA' }
    }
  })
}).then(r => r.json()).then(x => console.log(JSON.stringify(x, null, 2))).catch(console.error);
