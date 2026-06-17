// Serverless function to retrieve global plants from Vercel KV
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
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
      body: JSON.stringify(['GET', 'global:plants'])
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `Vercel KV Error: ${errText}` });
    }

    const data = await response.json();
    const result = data.result;

    if (!result) {
      return res.status(200).json({ plants: [] });
    }

    const plants = JSON.parse(result);
    return res.status(200).json({ plants });
  } catch (error) {
    console.error('Get plants error:', error);
    return res.status(500).json({ error: error.message });
  }
};
