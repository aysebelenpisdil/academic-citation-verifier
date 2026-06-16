import axios from 'axios';
import { ratio } from 'fuzzball';

const OPENALEX_API = 'https://api.openalex.org/works';
const USER_AGENT = process.env.OPENALEX_MAILTO || 'tubitak-citation-verifier/2.0 (mailto:your@email.com)';
const REQ_TIMEOUT = 10000;

function normalizeTurkish(text) {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replaceAll('ı', 'i')
    .toLowerCase()
    .trim();
}

function cleanText(text) {
  if (!text) return '';
  let t = normalizeTurkish(text);
  t = t.replaceAll('\n', ' ').replaceAll('\r', ' ');
  t = t.replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '');
  return t;
}

function checkAuthorMatch(citationAuthors, foundAuthors) {
  if (!citationAuthors?.length || !foundAuthors?.length) return true;

  const citLastnames = citationAuthors.map(a => {
    const clean = normalizeTurkish(a);
    const parts = clean.split(' ').filter(p => p.length > 2 && !['ve', 'and', 'et', 'al'].includes(p.toLowerCase()));
    return parts.length ? parts[parts.length - 1] : null;
  }).filter(Boolean);

  const foundLastnames = foundAuthors.map(a => {
    const clean = normalizeTurkish(typeof a === 'string' ? a : (a.display_name || a.name || ''));
    const parts = clean.split(' ');
    return parts.length ? parts[parts.length - 1] : null;
  }).filter(Boolean);

  for (const c of citLastnames) {
    for (const f of foundLastnames) {
      if (ratio(c, f) > 85) return true;
    }
  }
  return false;
}

function evaluateOpenAlexWork(work, citationData) {
  const foundTitle = work.title || '';
  if (!foundTitle) return null;

  const titleScore = ratio(cleanText(citationData.title), cleanText(foundTitle));
  if (titleScore < 90) return null;

  const foundAuthors = (work.authorships || []).map(a => a.author?.display_name).filter(Boolean);
  const authorOk = checkAuthorMatch(citationData.authors || [], foundAuthors);

  const foundJournal = (work.primary_location?.source || {}).display_name || '';
  const citationJournal = citationData.journal || '';
  const journalOk = !citationJournal || !foundJournal || ratio(cleanText(citationJournal), cleanText(foundJournal)) >= 75;

  const foundYear = work.publication_year;
  const citationYear = citationData.year;
  let yearDiff = null;
  let yearOk = true;
  if (citationYear && foundYear) {
    yearDiff = Math.abs(Number.parseInt(citationYear, 10) - foundYear);
    yearOk = yearDiff <= 2;
  }

  if (authorOk && journalOk && yearOk) {
    const doi = work.doi || '';
    const openAccess = work.open_access || {};
    return {
      source: 'OpenAlex',
      is_verified: true,
      url: doi || work.id || '',
      score: titleScore,
      found_metadata: {
        title: foundTitle, journal: foundJournal, year: foundYear,
        authors: foundAuthors.slice(0, 5),
        open_access: openAccess.is_oa, oa_url: openAccess.oa_url || null, doi
      }
    };
  }

  const reasons = [];
  if (!authorOk) reasons.push('Yazar uyuşmazlığı');
  if (!journalOk) reasons.push('Dergi uyuşmazlığı');
  if (!yearOk) reasons.push(`Yıl uyuşmazlığı (fark: ${yearDiff} yıl)`);

  return {
    source: 'OpenAlex (Metadata Uyuşmazlığı)',
    is_verified: false,
    note: `Benzer başlık (%${titleScore}) bulundu ancak: ${reasons.join(', ')}`,
    found_metadata: { title: foundTitle, journal: foundJournal, year: foundYear, authors: foundAuthors.slice(0, 5) }
  };
}

export async function checkOpenalex(citationData) {
  const title = citationData?.title || '';
  if (title.length < 10) return null;

  try {
    const { data } = await axios.get(OPENALEX_API, {
      params: { search: title, per_page: 5, mailto: USER_AGENT },
      headers: { 'User-Agent': USER_AGENT },
      timeout: REQ_TIMEOUT
    });

    for (const work of data?.results || []) {
      const result = evaluateOpenAlexWork(work, citationData);
      if (result) return result;
    }
    return null;
  } catch (e) {
    console.warn('[OPENALEX]', e.message);
    return null;
  }
}
