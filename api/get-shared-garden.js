// Serverless function to retrieve shared garden data from Vercel KV
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

  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ error: 'Missing "id" query parameter.' });
  }

  // Check for Vercel KV environment variables
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) {
    return res.status(500).json({
      error: 'Vercel KV is not connected. Please go to your Vercel Project Dashboard -> Storage -> select KV -> connect it to this project.'
    });
  }

  const key = `garden:${id}`;

  try {
    // Send command to Vercel KV (Upstash Redis REST API)
    const response = await fetch(kvUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${kvToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['GET', key])
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `Vercel KV Error: ${errText}` });
    }

    const data = await response.json();
    const result = data.result;

    if (!result) {
      return res.status(404).json({ error: '공유된 마이팟을 찾을 수 없거나 공유 기간(30일)이 만료되었습니다.' });
    }

    // Parse the inner plants JSON
    const plants = JSON.parse(result);
    return res.status(200).json({ plants });
  } catch (error) {
    console.error('Get share endpoint error:', error);
    return res.status(500).json({ error: error.message });
  }
};
