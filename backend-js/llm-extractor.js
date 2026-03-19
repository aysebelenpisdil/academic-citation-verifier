import { GoogleGenerativeAI } from '@google/generative-ai';

function validateCitationStructure(citation) {
  const title = citation?.title ? String(citation.title).trim() : '';
  return title.length >= 10;
}

function cleanCitationData(citation) {
  const cleaned = {
    title: String(citation?.title || '').trim(),
    authors: citation?.authors ?? [],
    year: citation?.year ? String(citation.year).trim() : null,
    journal: citation?.journal ? String(citation.journal).trim() : null,
    doi: citation?.doi ? String(citation.doi).trim() : null,
    raw_text: String(citation?.raw_text || '').trim()
  };

  if (typeof cleaned.authors === 'string') {
    if (cleaned.authors.includes(',')) {
      cleaned.authors = cleaned.authors.split(',').map(a => a.trim());
    } else {
      cleaned.authors = [cleaned.authors];
    }
  }

  if (cleaned.year) {
    const match = cleaned.year.match(/\d{4}/);
    cleaned.year = match ? match[0] : null;
  }

  return cleaned;
}

export async function extractCitationsWithGemini(textChunk, apiKey) {
  const key = apiKey || process.env.GOOGLE_GEMINI_API_KEY;

  if (!key) {
    console.warn('[LLM] GOOGLE_GEMINI_API_KEY eksik');
    return [];
  }

  const cleaned = (textChunk || '').replace(/<[^>]+>/g, '');

  if (!cleaned || cleaned.trim().length < 50) {
    console.warn('[WARNING] Metin çok kısa, Gemini analizi yapılmayacak.');
    return [];
  }

  try {
    const modelId = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    console.log('[INFO] Gemini API ile atıf ayıklanıyor...', { model: modelId });
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({
      model: modelId,
      generationConfig: { responseMimeType: 'application/json' }
    });

    const prompt = `
GÖREVİN:
Aşağıdaki metindeki TÜM akademik atıfları (bibliyografik girişleri) ayıkla ve yapılandır.

YAPILACAKLAR:
1. Her bibliyografik künye (yazar, yıl, başlık, dergi bilgisi içeren satırlar) bir atıftır - TÜMÜNÜ çıkar.
2. Her atıf için: Başlık, Yazarlar, Yıl, Dergi Adı, DOI (varsa) bilgilerini çıkar.
3. Altında "Geçerlidir", "Ulaşılamadı", "Sahte" gibi yorumlar olabilir - bunları YOKSAY, sadece künye bilgisini al.
4. Yorumları ve durum notlarını atıf olarak çıkarma.

YAPILMAYACAKLAR:
1. "KAYNAKLAR" veya "VERİLEN KAYNAKLAR İNCELEMESİ" gibi başlıkları atıf olarak ALMA.
2. "Geçerlidir", "İlgili makaleye ulaşılamadı", "Sahte" gibi durum cümleleri atıf DEĞİL.
3. Çift yıldız (**/***/****) işaretleri veya numaralar atıf değil, sadece işaretleyiciler.
4. Minimum 10 karakterden kısa başlıkları alma.

ÖRNEK ÇIKTI:
[
  {
    "title": "Tam Makale Başlığı",
    "authors": ["Yazar 1", "Yazar 2"],
    "year": "2023",
    "journal": "Dergi Adı",
    "doi": null,
    "raw_text": "Ham atıf metni"
  }
]

Sadece geçerli bir JSON array döndür. Başka metin yazma.

METİN:
${cleaned}
`;

    const result = await model.generateContent(prompt);

    const response = result.response;
    if (!response?.text) {
      console.warn('[WARNING] Gemini boş yanıt döndürdü.');
      return [];
    }

    let responseText = response.text().trim();
    if (responseText.startsWith('```')) {
      responseText = responseText.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    let citations = JSON.parse(responseText);
    if (!Array.isArray(citations)) {
      citations = [citations];
    }

    const validated = [];
    for (const c of citations) {
      if (!c || typeof c !== 'object') continue;
      const cleanedItem = cleanCitationData(c);
      if (validateCitationStructure(cleanedItem)) {
        validated.push(cleanedItem);
      }
    }

    return validated;
  } catch (e) {
    console.warn('[LLM]', e.message);
    return [];
  }
}
