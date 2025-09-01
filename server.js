const express = require('express');
const fetch = require('node-fetch');
const https = require('https');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;
const FILTER = false;

// In-memory cache for local development
class DataCache {
  constructor(cacheDuration = 5) {
    this.data = null;
    this.timestamp = 0;
    this.cacheDuration = cacheDuration * 1000;
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

const cache = new DataCache(5);
const ORIGINAL_URL = 'https://www.sistemas.dftrans.df.gov.br/service/gps/operacoes';

const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

async function getData() {
  // For local development, use in-memory cache
  if (cache.isValid()) {
    console.log('Cache hit (local memory)');
    return cache.get();
  }

  try {
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

    cache.set(processedData);
    
    return processedData;
  } catch (error) {
    console.error('Error fetching data:', error);
    if (cache.data) {
      console.log('Returning stale cache due to error');
      return cache.get();
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

// Serve static files directly from public folder at root
app.use(express.static(path.join(__dirname, 'public')));

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

// Start server for local development
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});