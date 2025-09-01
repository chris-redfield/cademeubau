const express = require('express');
const fetch = require('node-fetch');
const https = require('https');
const { createClient } = require('redis');

const app = express();
const FILTER = false;
const CACHE_DURATION = 5; // seconds

const ORIGINAL_URL = 'https://www.sistemas.dftrans.df.gov.br/service/gps/operacoes';

const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

// Initialize Redis client
let redis;

async function initRedis() {
  if (!redis) {
    redis = await createClient({
      url: process.env.KV_URL || process.env.REDIS_URL
    }).on('error', err => console.log('Redis Client Error', err))
    .connect();
  }
  return redis;
}

async function getData() {
  try {
    // Initialize Redis connection
    const client = await initRedis();
    
    // Try to get cached data from Redis
    const cachedData = await client.get('bus_data');
    
    if (cachedData) {
      console.log('Cache hit from Redis KV');
      return JSON.parse(cachedData);
    }
    
    console.log('Cache miss, fetching from API');
    console.log(`Requesting on ${ORIGINAL_URL}`);
    
    const response = await fetch(ORIGINAL_URL, {
      method: 'GET',
      agent: httpsAgent
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const body = await response.json();
    
    let processedData = [];
    
    for (const operadora of body) {
      if (operadora.veiculos && Array.isArray(operadora.veiculos)) {
        const vehicles = operadora.veiculos.map(vehicle => processData(vehicle));
        processedData = processedData.concat(vehicles);
      }
    }

    processedData = processedData.filter(item => item !== null);

    if (FILTER) {
      processedData = applyFilters(processedData);
    }

    // Store in Redis with 5 second expiration
    await client.setEx('bus_data', CACHE_DURATION, JSON.stringify(processedData));
    
    return processedData;
  } catch (error) {
    console.error('Error:', error);
    
    // Try to return stale cache if available
    try {
      const client = await initRedis();
      const staleData = await client.get('bus_data');
      if (staleData) {
        console.log('Returning stale cache due to error');
        return JSON.parse(staleData);
      }
    } catch (cacheError) {
      console.error('Cache error:', cacheError);
    }
    
    throw error;
  }
}

function processData(vehicle) {
  if (!vehicle.localizacao) {
    return null;
  }

  const { latitude, longitude } = vehicle.localizacao;
  
  if (!latitude || !longitude || latitude === '' || longitude === '') {
    return null;
  }

  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);
  
  if (isNaN(lat) || isNaN(lng)) {
    return null;
  }

  return {
    GPS_Latitude: lat,
    GPS_Longitude: lng,
    numero: vehicle.numero || '',
    linha: vehicle.linha || '',
    direcao: vehicle.direcao || 0,
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
app.use(express.json());

// Enable CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Serve static files directly from public folder at root
app.use(express.static('public'));

// Routes
app.get('/', (req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

app.get('/data', async (req, res) => {
  try {
    const data = await getData();
    res.json(data);
  } catch (error) {
    console.error('Error in /data endpoint:', error?.message || error);
    if (error?.stack) {
      console.error(error.stack);
    }
    res.status(500).json({ error: 'Failed to fetch bus data' });
  }
});

app.get('/teste', (req, res) => {
  res.json({ success: true });
});

// Export for Vercel
module.exports = app;

// For local development
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}