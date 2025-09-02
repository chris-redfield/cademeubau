// index.js
const express = require('express');
const { createClient } = require('redis');
const { Agent } = require('undici'); // ✅ Undici dispatcher

const app = express();
const FILTER = false;
const CACHE_DURATION = 10; // seconds

const ORIGINAL_URL = 'https://www.sistemas.dftrans.df.gov.br/service/gps/operacoes';

// ✅ Undici dispatcher
const dispatcher = new Agent({
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  connections: 128,
  pipelining: 1
});

// ---- helper with logging
async function fetchJSON(url, options = {}) {
  const started = Date.now();
  try {
    console.log(`[FETCH] → ${url}`);
    const res = await fetch(url, {
      method: 'GET',
      dispatcher,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; VercelFetch/1.0; +vercel.app)',
        ...(options.headers || {})
      },
      ...options
    });
    const dur = Date.now() - started;
    console.log(`[FETCH] ← ${res.status} ${res.statusText} (${dur}ms)`);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Upstream error ${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
    }
    return await res.json();
  } catch (err) {
    const dur = Date.now() - started;
    console.error(`[FETCH] ✖ Failed after ${dur}ms:`, err?.message || err);
    throw err;
  }
}

// ----------------- Redis init -----------------
let redis;
async function initRedis() {
  if (!redis) {
    redis = await createClient({
      url: process.env.KV_URL || process.env.REDIS_URL
    })
      .on('error', err => console.log('Redis Client Error', err))
      .connect();
  }
  return redis;
}

// ----------------- Data fetch -----------------
async function getData() {
  try {
    const client = await initRedis();

    const cachedData = await client.get('bus_data');
    if (cachedData) {
      console.log('[CACHE] hit');
      return JSON.parse(cachedData);
    }

    console.log('[CACHE] miss, fetching from API');
    const body = await fetchJSON(ORIGINAL_URL);

    let processedData = [];
    for (const operadora of body) {
      if (operadora.veiculos && Array.isArray(operadora.veiculos)) {
        const vehicles = operadora.veiculos.map(vehicle => processData(vehicle));
        processedData = processedData.concat(vehicles);
      }
    }

    processedData = processedData.filter(item => item !== null);
    if (FILTER) processedData = applyFilters(processedData);

    await client.setEx('bus_data', CACHE_DURATION, JSON.stringify(processedData));
    return processedData;
  } catch (error) {
    console.error('[DATA] Error in getData:', error?.message || error);

    try {
      const client = await initRedis();
      const stale = await client.get('bus_data');
      if (stale) {
        console.log('[CACHE] returning stale data due to error');
        return JSON.parse(stale);
      }
    } catch (cacheError) {
      console.error('[CACHE] fallback error:', cacheError?.message || cacheError);
    }
    throw error;
  }
}

function processData(vehicle) {
  if (!vehicle.localizacao) return null;
  const { latitude, longitude } = vehicle.localizacao;
  if (!latitude || !longitude || latitude === '' || longitude === '') return null;

  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;

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
  return data.filter(v => allowedLines.includes(v.linha));
}

// --------------- Middleware & Routes ----------
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});
app.use(express.static('public'));

app.get('/', (req, res) => res.sendFile('index.html', { root: 'public' }));
app.get('/data', async (req, res) => {
  try {
    const data = await getData();
    res.json(data);
  } catch (error) {
    console.error('[ROUTE] Error in /data:', error?.message || error);
    res.status(502).json({ error: 'Failed to fetch bus data' });
  }
});
app.get('/teste', (req, res) => res.json({ success: true }));

// Export for Vercel
module.exports = app;

// Local dev
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Running on http://0.0.0.0:${PORT}`);
  });
}
