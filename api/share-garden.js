// Serverless function to store garden data in Vercel KV and return a unique sharing ID
module.exports = async (req, res) => {
  // Set CORS Headers to allow client-side browser access
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  // Parse request body
  let plants;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    plants = body.plants;
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON request body.' });
  }

  if (!plants || !Array.isArray(plants)) {
    return res.status(400).json({ error: 'Missing or invalid "plants" array in request body.' });
  }

  // Check for Vercel KV environment variables
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) {
    return res.status(500).json({
      error: 'Vercel KV is not connected. Please go to your Vercel Project Dashboard -> Storage -> select KV -> connect it to this project.'
    });
  }

  // Generate unique 6-character random alphanumeric ID
  const generateId = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 6; id += chars[Math.floor(Math.random() * chars.length)], i++);
    return id;
  };

  const id = generateId();
  const key = `garden:${id}`;
  const value = JSON.stringify(plants);

  try {
    // Send command to Vercel KV (Upstash Redis REST API)
    // EX 2592000 sets key expiration to 30 days
    const response = await fetch(kvUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${kvToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['SET', key, value, 'EX', '2592000'])
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `Vercel KV Error: ${errText}` });
    }

    return res.status(200).json({ id });
  } catch (error) {
    console.error('Share endpoint error:', error);
    return res.status(500).json({ error: error.message });
  }
};
