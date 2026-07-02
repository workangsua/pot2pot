// Serverless function to proxy Gemini 3.1 Flash Image calls and hide API Key
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
    // Use the newly listed Google AI Studio free tier model supporting native image generation: gemini-3.1-flash-image
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent?key=${apiKey}`;
    
    // Construct the 3D clay plant generation prompt
    const prompt = `Minimalist 3D render of a cute ${species} plant in a simple smooth matte beige ceramic pot. Stylized, smooth matte plastic/clay textures, clean shading, rounded shapes, pure solid white background, isolated, soft lighting, 3D asset style.`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: {
            aspectRatio: "1:1",
            imageSize: "1K"
          }
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `Gemini API (Gemini 3.1 Image) error: ${errText}` });
    }

    const data = await response.json();
    
    if (!data.candidates || data.candidates.length === 0 || !data.candidates[0].content || !data.candidates[0].content.parts || data.candidates[0].content.parts.length === 0) {
      return res.status(500).json({ error: 'No image parts returned from Gemini API (Gemini 3.1 Image).' });
    }

    const base64Image = data.candidates[0].content.parts[0].inlineData.data;
    return res.status(200).json({ image: base64Image });
  } catch (error) {
    console.error('Gemini image serverless function error:', error);
    return res.status(500).json({ error: error.message });
  }
};
