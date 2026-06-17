// Serverless function to save global plants to Vercel KV
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let plants;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    plants = body.plants;
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON request body.' });
  }

  if (!plants || !Array.isArray(plants)) {
    return res.status(400).json({ error: 'Invalid plants array.' });
  }

  const kvUrl = process.env.KV_REST_API_URL || process.env.STORAGE_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.STORAGE_REST_API_TOKEN;

  if (!kvUrl || !kvToken) {
    return res.status(500).json({ error: 'Vercel KV is not connected.' });
  }

  try {
    const response = await fetch(kvUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${kvToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['SET', 'global:plants', JSON.stringify(plants)])
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `Vercel KV Error: ${errText}` });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Save plants error:', error);
    return res.status(500).json({ error: error.message });
  }
};
