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
    .replace(/ı/g, 'i')
    .toLowerCase()
    .trim();
}

function cleanText(text) {
  if (!text) return '';
  let t = normalizeTurkish(text);
  t = t.replace(/\n/g, ' ').replace(/\r/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t.replace(/[.,;:]+$/, '');
}

function checkAuthorMatch(citationAuthors, foundAuthors) {
  if (!citationAuthors?.length || !foundAuthors?.length) return true;

  const citLastnames = [];
  for (const auth of citationAuthors) {
    const clean = normalizeTurkish(auth);
    const parts = clean.split(' ').filter(p => p.length > 2 && !['ve', 'and', 'et', 'al'].includes(p.toLowerCase()));
    if (parts.length) citLastnames.push(parts[parts.length - 1]);
  }

  const foundLastnames = [];
  for (const auth of foundAuthors) {
    let name = '';
    if (typeof auth === 'object') {
      name = auth.display_name || auth.family || auth.name || '';
    } else {
      name = String(auth);
    }
    const clean = normalizeTurkish(name);
    const parts = clean.split(' ');
    if (parts.length) foundLastnames.push(parts[parts.length - 1]);
  }

  for (const c of citLastnames) {
    for (const f of foundLastnames) {
      if (ratio(c, f) > 85) return true;
    }
  }
  return false;
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

async function checkCrossrefTitle(citationData) {
  const title = citationData?.title || '';
  if (title.length < 10) return null;

  const cleanTitle = cleanText(title);
  try {
    const { data } = await axios.get('https://api.crossref.org/works', {
      params: { 'query.bibliographic': title, rows: 3 },
      headers: { 'User-Agent': USER_AGENT },
      timeout: REQ_TIMEOUT
    });

    const items = data?.message?.items || [];

    for (const item of items) {
      const foundTitle = item.title?.[0] || '';
      const score = ratio(cleanTitle, cleanText(foundTitle));
      if (score < 85) continue;

      const foundAuthors = item.author || [];
      const authorOk = checkAuthorMatch(citationData.authors || [], foundAuthors);

      const foundJournal = item['container-title']?.[0] || '';
      const citationJournal = citationData.journal || '';
      let journalOk = true;
      if (citationJournal && foundJournal) {
        journalOk = ratio(normalizeTurkish(citationJournal), normalizeTurkish(foundJournal)) >= 70;
      }

      const foundYear = item.published?.['date-parts']?.[0]?.[0];
      const citationYear = citationData.year;
      let yearOk = true;
      if (citationYear && foundYear) {
        yearOk = Math.abs(parseInt(citationYear, 10) - foundYear) <= 2;
      }

      if (authorOk && journalOk && yearOk) {
        return {
          source: 'CrossRef',
          is_verified: true,
          url: item.URL,
          score,
          found_metadata: {
            title: foundTitle,
            journal: foundJournal,
            year: foundYear,
            authors: foundAuthors.slice(0, 3).map(a => `${a.given || ''} ${a.family || ''}`.trim())
          }
        };
      }

      const reasons = [];
      if (!authorOk) reasons.push('Yazar uyuşmazlığı');
      if (!journalOk) reasons.push('Dergi uyuşmazlığı');
      if (!yearOk) reasons.push('Yıl uyuşmazlığı');

      return {
        source: 'CrossRef (Metadata Uyuşmazlığı)',
        is_verified: false,
        note: `Benzer başlık (%${score}) bulundu ancak: ${reasons.join(', ')}`,
        found_metadata: { title: foundTitle, journal: foundJournal, year: foundYear }
      };
    }

    for (const item of items) {
      const foundTitle = item.title?.[0] || '';
      const score = ratio(cleanTitle, cleanText(foundTitle));
      if (score < 75) continue;

      const foundAuthors = item.author || [];
      const authorOk = checkAuthorMatch(citationData.authors || [], foundAuthors);
      const foundJournal = item['container-title']?.[0] || '';
      const citationJournal = citationData.journal || '';
      let journalOk = true;
      if (citationJournal && foundJournal) {
        journalOk = ratio(normalizeTurkish(citationJournal), normalizeTurkish(foundJournal)) >= 70;
      }
      const foundYear = item.published?.['date-parts']?.[0]?.[0];
      const citationYear = citationData.year;
      let yearOk = true;
      if (citationYear && foundYear) {
        yearOk = Math.abs(parseInt(citationYear, 10) - foundYear) <= 2;
      }
      if (authorOk && journalOk && yearOk) {
        return {
          source: 'CrossRef',
          is_verified: true,
          url: item.URL,
          score,
          found_metadata: { title: foundTitle, journal: foundJournal, year: foundYear }
        };
      }
    }
  } catch {
    return null;
  }
  return null;
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
