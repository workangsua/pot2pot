// Serverless function to proxy Imagen 3 API calls and hide API Key
module.exports = async (req, res) => {
  // Set CORS Headers to allow client-side browser access
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-gemini-key'
  );

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const { species } = req.body;
  if (!species) {
    return res.status(400).json({ error: 'Plant species name is required' });
  }

  // Retrieve Gemini API key from environment variable first, then fallback to header
  const apiKey = process.env.GEMINI_API_KEY || req.headers['x-gemini-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'Gemini API Key is missing. Please configure GEMINI_API_KEY on Vercel Environment Variables or pass it in headers.' });
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`;
    
    // Construct the 3D clay plant generation prompt
    const prompt = `Minimalist 3D render of a cute ${species} plant in a simple smooth matte beige ceramic pot. Stylized, smooth matte plastic/clay textures, clean shading, rounded shapes, pure solid white background, isolated, soft lighting, 3D asset style.`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        instances: [
          { prompt: prompt }
        ],
        parameters: {
          sampleCount: 1,
          outputMimeType: "image/png",
          aspectRatio: "1:1"
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `Gemini API (Imagen) error: ${errText}` });
    }

    const data = await response.json();
    
    if (!data.predictions || data.predictions.length === 0) {
      return res.status(500).json({ error: 'No predictions returned from Gemini API (Imagen).' });
    }

    const base64Image = data.predictions[0].bytesBase64Encoded;
    return res.status(200).json({ image: base64Image });
  } catch (error) {
    console.error('Gemini image serverless function error:', error);
    return res.status(500).json({ error: error.message });
  }
};
