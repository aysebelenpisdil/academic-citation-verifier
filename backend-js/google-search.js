import axios from 'axios';

const API_URL = 'https://www.googleapis.com/customsearch/v1';
const REQ_TIMEOUT = 10000;

export async function googleSearch(query, maxResults = 5) {
  const apiKey = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_CX;

  if (!apiKey || !cx) {
    console.warn('[GOOGLE-SEARCH] GOOGLE_CSE_API_KEY veya GOOGLE_CSE_CX eksik');
    return [];
  }

  try {
    const { data } = await axios.get(API_URL, {
      params: {
        key: apiKey,
        cx,
        q: query,
        num: Math.min(10, Math.max(1, maxResults))
      },
      timeout: REQ_TIMEOUT
    });

    const items = data?.items || [];
    return items.map(item => ({
      title: item.title || '',
      url: item.link || '',
      description: item.snippet || ''
    }));
  } catch (e) {
    console.warn('[GOOGLE-SEARCH]', e.response?.data?.error?.message || e.message);
    return [];
  }
}
