import axios from 'axios';
import { ratio } from 'fuzzball';
import { verifyViaWeb } from './web-verifier.js';
import { checkOpenalex } from './openalex-verifier.js';

const USER_AGENT = 'tubitak-citation-verifier/2.0 (+https://example.com)';
const REQ_TIMEOUT = 5000;

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
  t = t.replace(/\s+/g, ' ').trim();
  return t.replace(/[.,;:]+$/, '');
}

function isSignificantPart(p) {
  return p.length > 2 && !['ve', 'and', 'et', 'al'].includes(p.toLowerCase());
}

function extractLastname(auth) {
  const name = typeof auth === 'object' ? (auth.display_name || auth.family || auth.name || '') : String(auth);
  const parts = normalizeTurkish(name).split(' ');
  return parts.length ? parts[parts.length - 1] : null;
}

function hasMatchingLastname(citLastnames, foundLastnames) {
  return citLastnames.some(c => foundLastnames.some(f => ratio(c, f) > 85));
}

function checkAuthorMatch(citationAuthors, foundAuthors) {
  if (!citationAuthors?.length || !foundAuthors?.length) return true;

  const citLastnames = citationAuthors.map(auth => {
    const parts = normalizeTurkish(auth).split(' ').filter(isSignificantPart);
    return parts.length ? parts[parts.length - 1] : null;
  }).filter(Boolean);

  if (!citLastnames.length) return true;
  const foundLastnames = foundAuthors.map(extractLastname).filter(Boolean);
  return hasMatchingLastname(citLastnames, foundLastnames);
}

async function checkCrossrefDoi(doi) {
  if (!doi?.trim()) return null;
  try {
    const url = `https://api.crossref.org/works/${doi.trim()}`;
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: REQ_TIMEOUT
    });
    const item = data?.message || {};
    return {
      source: 'CrossRef (DOI)',
      is_verified: true,
      url: item.URL || `https://doi.org/${doi}`,
      score: 100
    };
  } catch {
    return null;
  }
}

const CROSSREF_TITLE_THRESHOLD = 82;

// Başlık = var olma sinyali, yazar = gerçek/sahte ayırt edici sinyal.
// Yıl ve dergi yumuşak sinyallerdir (preprint/konferans/yeniden yayın farkı), kesin red değil.
function scoreCrossrefItem(item, cleanTitle, citationData) {
  const foundTitle = item.title?.[0] || '';
  const score = ratio(cleanTitle, cleanText(foundTitle));
  const foundAuthors = item.author || [];
  const authorOk = checkAuthorMatch(citationData.authors || [], foundAuthors);
  const foundJournal = item['container-title']?.[0] || '';
  const citationJournal = citationData.journal || '';
  const journalSoftOk = !citationJournal || !foundJournal || ratio(normalizeTurkish(citationJournal), normalizeTurkish(foundJournal)) >= 70;
  const foundYear = item.published?.['date-parts']?.[0]?.[0];
  const citationYear = citationData.year;
  const yearDiff = (citationYear && foundYear) ? Math.abs(Number.parseInt(citationYear, 10) - foundYear) : null;
  return { score, foundTitle, foundAuthors, foundJournal, foundYear, authorOk, journalSoftOk, yearDiff };
}

function buildCrossrefMismatch(ev) {
  return {
    source: 'CrossRef (Yazar Uyuşmazlığı)',
    is_verified: false,
    score: ev.score,
    note: `Aynı başlıkta makale bulundu (%${ev.score}) ancak yazarlar atıftaki yazarlarla eşleşmiyor.`,
    found_metadata: { title: ev.foundTitle, journal: ev.foundJournal, year: ev.foundYear }
  };
}

function buildCrossrefVerified(item, ev) {
  const meta = {
    title: ev.foundTitle, journal: ev.foundJournal, year: ev.foundYear,
    authors: ev.foundAuthors.slice(0, 3).map(a => `${a.given || ''} ${a.family || ''}`.trim())
  };
  const notes = [];
  if (!ev.journalSoftOk) notes.push('dergi adı farklı');
  if (ev.yearDiff !== null && ev.yearDiff > 2) notes.push(`yıl farkı ${ev.yearDiff} (preprint/yeniden yayın olabilir)`);
  const res = { source: 'CrossRef', is_verified: true, url: item.URL, score: ev.score, found_metadata: meta };
  if (notes.length) res.note = `Doğrulandı. Bilgi: ${notes.join(', ')}.`;
  return res;
}

async function checkCrossrefTitle(citationData) {
  const title = citationData?.title || '';
  if (title.length < 10) return null;
  const cleanTitle = cleanText(title);

  try {
    const { data } = await axios.get('https://api.crossref.org/works', {
      params: { 'query.bibliographic': title, rows: 5 },
      headers: { 'User-Agent': USER_AGENT },
      timeout: REQ_TIMEOUT
    });
    const items = data?.message?.items || [];

    const candidates = items
      .map(item => ({ item, ev: scoreCrossrefItem(item, cleanTitle, citationData) }))
      .filter(c => c.ev.score >= CROSSREF_TITLE_THRESHOLD);
    if (!candidates.length) return null;

    const authorMatches = candidates.filter(c => c.ev.authorOk);
    if (authorMatches.length) {
      authorMatches.sort((a, b) => b.ev.score - a.ev.score);
      return buildCrossrefVerified(authorMatches[0].item, authorMatches[0].ev);
    }

    candidates.sort((a, b) => b.ev.score - a.ev.score);
    return buildCrossrefMismatch(candidates[0].ev);
  } catch {
    return null;
  }
}

export async function verifyCitation(citationData) {
  const data = typeof citationData === 'string'
    ? { title: citationData, authors: [] }
    : citationData || {};

  const doiRes = await checkCrossrefDoi(data.doi);
  if (doiRes?.is_verified) return doiRes;

  const crossrefRes = await checkCrossrefTitle(data);
  if (crossrefRes?.is_verified) return crossrefRes;

  const openalexRes = await checkOpenalex(data);
  if (openalexRes?.is_verified) return openalexRes;

  const webRes = await verifyViaWeb(data);
  if (webRes) return webRes;

  return {
    is_verified: false,
    status: 'Not Found',
    note: 'Akademik veritabanlarında ve web arşivlerinde bulunamadı.'
  };
}
