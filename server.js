const express = require('express');
const fetch = require('node-fetch');
const https = require('https');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;
const FILTER = false;

// Cache implementation - server-side cache shared by all clients
class DataCache {
  constructor(cacheDuration = 5) {
    this.data = null;
    this.timestamp = 0;
    this.cacheDuration = cacheDuration * 1000; // Convert to milliseconds
  }

  isValid() {
    return this.data !== null && (Date.now() - this.timestamp) < this.cacheDuration;
  }

  get() {
    return this.data;
  }

  set(data) {
    this.data = data;
    this.timestamp = Date.now();
  }
}

// Create cache instance - this is shared by ALL requests
const cache = new DataCache(5);

// API URL
const ORIGINAL_URL = 'https://www.sistemas.dftrans.df.gov.br/service/gps/operacoes';

// Create an HTTPS agent that ignores SSL certificate errors (like Python's verify=False)
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

async function getData() {
  // Check if cache is valid - if yes, return cached data to ALL clients
  if (cache.isValid()) {
    return cache.get();
  }

  try {
    console.log(`Requesting on ${ORIGINAL_URL}`);
    
    // Only fetch from external API when cache is expired
    const response = await fetch(ORIGINAL_URL, {
      method: 'GET',
      agent: httpsAgent
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const body = await response.json();
    
    // Process the data (equivalent to pandas operations)
    let processedData = [];
    
    // Iterate through each operator
    for (const operadora of body) {
      if (operadora.veiculos && Array.isArray(operadora.veiculos)) {
        const vehicles = operadora.veiculos.map(vehicle => processData(vehicle));
        processedData = processedData.concat(vehicles);
      }
    }

    // Filter out invalid entries (null values)
    processedData = processedData.filter(item => item !== null);

    // Apply line filters if enabled
    if (FILTER) {
      processedData = applyFilters(processedData);
    }

    // Update cache - this cached data will be served to ALL clients for the next 5 seconds
    cache.set(processedData);
    
    return processedData;
  } catch (error) {
    console.error('Error fetching data:', error);
    // If there's an error and we have cached data, return it even if expired
    if (cache.data) {
      console.log('Error fetching new data, returning stale cache');
      return cache.get();
    }
    throw error;
  }
}

function processData(vehicle) {
  // Skip if no location data
  if (!vehicle.localizacao) {
    return null;
  }

  const { latitude, longitude } = vehicle.localizacao;
  
  // Skip if coordinates are missing or invalid (empty strings)
  if (!latitude || !longitude || latitude === '' || longitude === '') {
    return null;
  }

  // Convert to float and validate
  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);
  
  if (isNaN(lat) || isNaN(lng)) {
    return null;
  }

  // Return processed vehicle data (matching Python structure)
  return {
    GPS_Latitude: lat,
    GPS_Longitude: lng,
    numero: vehicle.numero || '',
    linha: vehicle.linha || '',
    direcao: vehicle.direcao || 0,
    // Include all other fields from the vehicle
    ...Object.keys(vehicle).reduce((acc, key) => {
      if (!['localizacao', 'latitude', 'longitude'].includes(key)) {
        acc[key] = vehicle[key];
      }
      return acc;
    }, {})
  };
}

function applyFilters(data) {
  const allowedLines = [
    '0.195', '147.5', '147.6', '180.1', '180.2', 
    '181.2', '181.4', '8002', '106.2', '0.147', 
    '2207', '2209'
  ];
  
  return data.filter(vehicle => allowedLines.includes(vehicle.linha));
}

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files
app.use('/static', express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/data', async (req, res) => {
  try {
    const data = await getData();
    res.json(data);
  } catch (error) {
    console.error('Error in /data endpoint:', error);
    res.status(500).json({ error: 'Failed to fetch bus data' });
  }
});

app.get('/teste', (req, res) => {
  res.json({ success: true });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});