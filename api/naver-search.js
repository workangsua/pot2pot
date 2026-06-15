// Serverless function to proxy Naver Encyclopedia Search API calls and bypass CORS
module.exports = async (req, res) => {
  // Set CORS Headers to allow client-side browser access
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-naver-client-id, x-naver-client-secret'
  );

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { query } = req.query;
  if (!query) {
    return res.status(400).json({ error: 'Query parameter is required' });
  }

  // Retrieve Naver Client credentials from environment variables first, then fallback to headers
  const clientId = process.env.NAVER_CLIENT_ID || req.headers['x-naver-client-id'];
  const clientSecret = process.env.NAVER_CLIENT_SECRET || req.headers['x-naver-client-secret'];

  if (!clientId || !clientSecret) {
    return res.status(401).json({ error: 'Naver API Client ID and Client Secret are missing. Please configure them on Vercel Environment Variables or pass them in headers.' });
  }

  try {
    // Call Naver Encyclopedia Search API
    const url = `https://openapi.naver.com/v1/search/encyc.json?query=${encodeURIComponent(query)}&display=1`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `Naver open API error: ${errText}` });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('Serverless function error:', error);
    return res.status(500).json({ error: error.message });
  }
};
