// Serverless function to retrieve global plants from Supabase
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

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase configuration (SUPABASE_URL, SUPABASE_ANON_KEY) is missing.' });
  }

  try {
    const url = `${supabaseUrl}/rest/v1/global_settings?key=eq.plants&select=value`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `Supabase Error: ${errText}` });
    }

    const data = await response.json();
    
    if (!data || data.length === 0) {
      return res.status(200).json({ plants: [] });
    }

    // Since 'value' is a jsonb column, PostgREST returns it as a parsed JSON array/object directly
    const plants = data[0].value;
    return res.status(200).json({ plants: plants || [] });
  } catch (error) {
    console.error('Get plants error:', error);
    return res.status(500).json({ error: error.message });
  }
};
