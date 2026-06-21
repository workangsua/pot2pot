// Serverless function to save global plants to Supabase
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

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase configuration (SUPABASE_URL, SUPABASE_ANON_KEY) is missing.' });
  }

  try {
    const url = `${supabaseUrl}/rest/v1/global_settings`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({ key: 'plants', value: plants, updated_at: new Date().toISOString() })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `Supabase Error: ${errText}` });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Save plants error:', error);
    return res.status(500).json({ error: error.message });
  }
};
