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

  if (!citLastnames.length) return true;
  for (const c of citLastnames) {
    for (const f of foundLastnames) {
      if (ratio(c, f) > 85) return true;
    }
  }
  return false;
}

const TITLE_MATCH_THRESHOLD = 82;

// Başlık, makalenin var olma sinyali; yazar ise gerçek/sahte ayırt edici asıl sinyaldir.
// Yıl ve dergi, preprint/konferans/yeniden yayın farklılıkları nedeniyle KESİN red kriteri
// olarak kullanılmaz; yalnızca bilgilendirici not olarak raporlanır.
function evaluateOpenAlexWork(work, citationData) {
  const foundTitle = work.title || '';
  if (!foundTitle) return null;

  const titleScore = ratio(cleanText(citationData.title), cleanText(foundTitle));
  if (titleScore < TITLE_MATCH_THRESHOLD) return null;

  const foundAuthors = (work.authorships || []).map(a => a.author?.display_name).filter(Boolean);
  const authorOk = checkAuthorMatch(citationData.authors || [], foundAuthors);

  const foundJournal = work.primary_location?.source?.display_name || '';
  const foundYear = work.publication_year;

  // Yumuşak sinyaller: yalnızca bilgilendirme amaçlı, doğrulamayı engellemez.
  const citationJournal = citationData.journal || '';
  const journalSoftOk = !citationJournal || !foundJournal || ratio(cleanText(citationJournal), cleanText(foundJournal)) >= 60;
  const citationYear = citationData.year;
  let yearDiff = null;
  if (citationYear && foundYear) yearDiff = Math.abs(Number.parseInt(citationYear, 10) - foundYear);

  const doi = work.doi || '';
  const openAccess = work.open_access || {};
  const baseMeta = {
    title: foundTitle, journal: foundJournal, year: foundYear,
    authors: foundAuthors.slice(0, 5),
    open_access: openAccess.is_oa, oa_url: openAccess.oa_url || null, doi
  };

  return {
    titleScore, authorOk, journalSoftOk, yearDiff,
    verified: {
      source: 'OpenAlex',
      is_verified: true,
      url: doi || work.id || '',
      score: titleScore,
      found_metadata: baseMeta
    },
    mismatch: {
      source: 'OpenAlex (Yazar Uyuşmazlığı)',
      is_verified: false,
      score: titleScore,
      note: `Aynı başlıkta makale bulundu (%${titleScore}) ancak yazarlar atıftaki yazarlarla eşleşmiyor.`,
      found_metadata: baseMeta
    }
  };
}

export async function checkOpenalex(citationData) {
  const title = citationData?.title || '';
  if (title.length < 10) return null;

  try {
    const { data } = await axios.get(OPENALEX_API, {
      params: { search: title, per_page: 10, mailto: USER_AGENT },
      headers: { 'User-Agent': USER_AGENT },
      timeout: REQ_TIMEOUT
    });

    // Tüm başlık-eşleşen adayları topla; ilk uyuşmazlıkta durma.
    const candidates = [];
    for (const work of data?.results || []) {
      const ev = evaluateOpenAlexWork(work, citationData);
      if (ev) candidates.push(ev);
    }
    if (!candidates.length) return null;

    // Yazarı eşleşen adayı tercih et (gerçek makale); en yüksek başlık skoruyla.
    const authorMatches = candidates.filter(c => c.authorOk);
    if (authorMatches.length) {
      authorMatches.sort((a, b) => b.titleScore - a.titleScore);
      const best = authorMatches[0];
      const notes = [];
      if (!best.journalSoftOk) notes.push('dergi adı farklı');
      if (best.yearDiff !== null && best.yearDiff > 2) notes.push(`yıl farkı ${best.yearDiff} (preprint/yeniden yayın olabilir)`);
      if (notes.length) best.verified.note = `Doğrulandı. Bilgi: ${notes.join(', ')}.`;
      return best.verified;
    }

    // Başlık eşleşiyor ama hiçbir adayda yazar eşleşmiyor: muhtemel uyuşmazlık.
    candidates.sort((a, b) => b.titleScore - a.titleScore);
    return candidates[0].mismatch;
  } catch (e) {
    console.warn('[OPENALEX]', e.message);
    return null;
  }
}
