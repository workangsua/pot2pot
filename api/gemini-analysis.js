// Serverless function to proxy Gemini 1.5 Flash API calls and hide API Key
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

  const { image, mode } = req.body;
  if (!image) {
    return res.status(400).json({ error: 'Image data (base64) is required in the body' });
  }

  // Retrieve Gemini API key from environment variable first, then fallback to header
  const apiKey = process.env.GEMINI_API_KEY || req.headers['x-gemini-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'Gemini API Key is missing. Please configure GEMINI_API_KEY on Vercel Environment Variables or pass it in headers.' });
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    
    let prompt;
    if (mode === 'bbox') {
      prompt = "Identify the plant and its pot (including the foliage/succulent and the container/pot). Return a JSON object with:\n" +
               "\"box_2d\": [ymin, xmin, ymax, xmax],\n" +
               "\"polygon\": [[y1, x1], [y2, x2], ..., [yn, xn]] (a list of 20 to 45 points outlining the boundary of the plant and pot in clockwise order, normalized to 0-1000 where 0 is top/left and 1000 is bottom/right).\n" +
               "Be extremely precise to ONLY include the plant and pot, excluding any surrounding background, hands, floor, or phone frames/screens. Do not include any markdown formatting or other text, return ONLY the raw JSON.";
    } else {
      prompt = "이 식물 사진을 분석하여 다음 JSON 구조로만 정확하게 응답해주세요. 다른 부연 설명이나 마크다운 백틱(```json)을 절대 포함하지 마십시오.\n" +
               "{\n" +
               "  \"species\": \"식물의 정확한 종류/품종 국문명 (예: 몬스테라 델리시오사, 아레카야자 등)\",\n" +
               "  \"nickname\": \"식물의 생김새나 특징에 어울리는 귀여운 4글자 이내의 한글 별명 추천 (예: 초록이, 선선이, 몬몬이 등)\",\n" +
               "  \"waterInterval\": 식물의 품종별 권장 물주기 주기 (1에서 30 사이의 정수 일수)\n" +
               "}";
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "image/png",
                data: image
              }
            }
          ]
        }],
        generationConfig: {
          responseMimeType: "application/json"
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `Gemini API error: ${errText}` });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('Gemini serverless function error:', error);
    return res.status(500).json({ error: error.message });
  }
};
