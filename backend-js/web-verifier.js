import { googleSearch } from './google-search.js';
import { ratio, partial_ratio } from 'fuzzball';
import { scrapeMetadata } from './web-scrapers.js';

const CANDIDATE_SCORE_THRESHOLD = 80;
const MAX_RESULTS_PER_QUERY = 5;

function normalizeTurkish(text) {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replaceAll('ı', 'i')
    .toLowerCase()
    .trim();
}

function checkAuthorMatch(citationAuthors, foundAuthors) {
  if (!citationAuthors?.length || !foundAuthors?.length) return true;
  const citLastnames = citationAuthors.map(a => {
    const clean = normalizeTurkish(a);
    const parts = clean.split(' ').filter(p => p.length > 2 && !['ve', 'and', 'et', 'al'].includes(p.toLowerCase()));
    return parts.length ? parts[parts.length - 1] : null;
  }).filter(Boolean);
  const foundLastnames = foundAuthors.map(a => {
    const clean = normalizeTurkish(String(a));
    const parts = clean.split(' ');
    return parts.length ? parts[parts.length - 1] : null;
  }).filter(Boolean);
  return citLastnames.some(c => foundLastnames.some(f => ratio(c, f) > 85));
}

function isDergiparkDownloadUrl(url) {
  return url?.toLowerCase().includes('dergipark.org.tr') && url?.toLowerCase().includes('download/article-file');
}
function isDergiparkArticleUrl(url) {
  return url?.toLowerCase().includes('dergipark.org.tr') && url?.includes('/pub/') && url?.includes('/article/');
}

async function resolveDergiparkArticleUrl(downloadUrl, cleanTitle) {
  try {
    const query = `site:dergipark.org.tr ${cleanTitle.slice(0, 60)}`;
    const results = await googleSearch(query, 5);
    for (const r of results) {
      const href = r.url || '';
      if (isDergiparkArticleUrl(href)) return href;
    }
  } catch {}
  return null;
}

function buildQueryPrefix(data, cleanTitle) {
  const authorsList = data.authors || [];
  if (!authorsList.length) return cleanTitle.slice(0, 70).trim();
  const soyadlar = authorsList.slice(0, 2).map(a => {
    const parts = a.replaceAll(',', ' ').split(' ').filter(p => p.length > 2 && !['ve', 'and', 'et', 'al'].includes(p.toLowerCase()));
    return parts.length ? parts[parts.length - 1] : null;
  }).filter(Boolean);
  const authorPrefix = soyadlar.length ? soyadlar.join(' ') + ' ' : '';
  return `${authorPrefix}${cleanTitle.slice(0, 70)}`.trim();
}

function buildSearchQueries(queryPrefix, titleOnlyQuery) {
  return [
    `${titleOnlyQuery} site:dergipark.org.tr`,
    `${queryPrefix} site:dergipark.org.tr`,
    `${titleOnlyQuery} site:tezara.org`,
    `${queryPrefix} site:tezara.org`,
    `${queryPrefix} site:mdpi.com`,
    `${queryPrefix} site:researchgate.net`,
    `${queryPrefix} (site:acikerisim.aksaray.edu.tr OR site:acikerisim.aku.edu.tr OR site:acikerisim.afyon.edu.tr)`,
    `${queryPrefix} (site:sciencedirect.com OR site:springer.com)`,
    `${queryPrefix} site:ieee.org`,
    queryPrefix.slice(0, 100),
    titleOnlyQuery.slice(0, 100)
  ];
}

async function collectAllResults(searchQueries, maxResults) {
  const allResults = [];
  for (const query of searchQueries) {
    try {
      const results = await googleSearch(query, maxResults);
      if (results.length) allResults.push(...results);
    } catch {}
  }
  return allResults;
}

function buildCandidates(allResults, title, trustedDomains) {
  const seenUrls = new Set();
  const candidates = [];
  for (const res of allResults) {
    const foundUrl = res.url || '';
    if (!foundUrl || seenUrls.has(foundUrl)) continue;
    const titleScore = partial_ratio(title.toLowerCase(), (res.title || '').toLowerCase());
    const snippetScore = partial_ratio(title.toLowerCase(), (res.description || '').toLowerCase());
    const finalScore = Math.max(titleScore, snippetScore);
    const isTrusted = trustedDomains.some(d => foundUrl.includes(d));
    if (!isTrusted && finalScore < 95) continue;
    if (finalScore < CANDIDATE_SCORE_THRESHOLD) continue;
    seenUrls.add(foundUrl);
    let preferArticle;
    if (isDergiparkArticleUrl(foundUrl)) preferArticle = 1;
    else if (isDergiparkDownloadUrl(foundUrl)) preferArticle = 0;
    else preferArticle = 0.5;
    candidates.push({ url: foundUrl, found_title: res.title || '', score: finalScore, prefer_article: preferArticle, is_trusted: isTrusted });
  }
  candidates.sort((a, b) => (b.score - a.score) || (b.prefer_article - a.prefer_article));
  return candidates;
}

function buildWebMismatch(scraped, cand, note, partialMeta) {
  return {
    mismatch: {
      source: `Web (Metadata Eksik - ${scraped.source})`,
      is_verified: false,
      url: cand.url,
      score: cand.score,
      note,
      found_metadata: { title: scraped.title, ...partialMeta }
    }
  };
}

function checkMetadataMatch(scraped, cand, citationData) {
  const foundAuthors = scraped.authors || [];
  const foundJournal = scraped.journal || '';
  const foundYear = scraped.year;
  const { authors: citationAuthors = [], journal: citationJournal = '', year: citationYear } = citationData;

  if (citationAuthors.length && !foundAuthors.length) {
    return buildWebMismatch(scraped, cand, 'Başlık eşleşti ancak yazar bilgisi web sayfasından çıkarılamadı. Manuel kontrol gerekli.', { authors: [], year: foundYear, journal: foundJournal });
  }
  const authorOk = checkAuthorMatch(citationAuthors, foundAuthors);

  if (citationJournal && !foundJournal) {
    return buildWebMismatch(scraped, cand, 'Başlık eşleşti ancak dergi bilgisi web sayfasından çıkarılamadı. Manuel kontrol gerekli.', { authors: foundAuthors.slice(0, 5), year: foundYear, journal: null });
  }
  const journalOk = !citationJournal || ratio(normalizeTurkish(citationJournal), normalizeTurkish(foundJournal)) >= 70;

  if (citationYear && !foundYear) {
    return buildWebMismatch(scraped, cand, 'Başlık eşleşti ancak yıl bilgisi web sayfasından çıkarılamadı. Manuel kontrol gerekli.', { authors: foundAuthors.slice(0, 5), year: null, journal: foundJournal });
  }
  let yearOk = true;
  if (citationYear && foundYear) {
    yearOk = Math.abs(Number.parseInt(citationYear, 10) - Number.parseInt(foundYear, 10)) <= 2;
  }

  if (authorOk && journalOk && yearOk) {
    return {
      result: {
        source: cand.is_trusted ? 'Web (Akademik Kaynak)' : 'Web (Genel Kaynak)',
        is_verified: true,
        url: cand.url,
        score: cand.score,
        found_title: cand.found_title,
        note: 'Akademik veritabanında bulunamadı ancak güvenilir web kaynağında doğrulandı.',
        found_metadata: { title: scraped.title, authors: foundAuthors.slice(0, 5), year: foundYear, journal: foundJournal }
      }
    };
  }

  return {
    mismatch: {
      source: `Web (Metadata Uyuşmazlığı - ${scraped.source})`,
      is_verified: false,
      url: cand.url,
      score: cand.score,
      note: 'İlgili makale bu yazarlara ve bu dergiye ait değil.',
      found_metadata: { title: scraped.title, authors: foundAuthors.slice(0, 5), year: foundYear, journal: foundJournal }
    }
  };
}

async function checkCandidateMatch(cand, citationData, cleanTitle) {
  let urlToUse = cand.url;
  if (isDergiparkDownloadUrl(urlToUse)) {
    const resolved = await resolveDergiparkArticleUrl(urlToUse, cleanTitle);
    if (resolved) urlToUse = resolved;
    else return { skip: true };
  }
  const scraped = await scrapeMetadata(urlToUse);
  if (!scraped) return { skip: true };
  return checkMetadataMatch(scraped, cand, citationData);
}

export async function verifyViaWeb(citationData) {
  const data = typeof citationData === 'string'
    ? { title: citationData, authors: [] }
    : citationData || {};

  const title = data.title || '';
  if (!title || title.length < 15) return null;

  const cleanTitle = title.replace(/["']/g, '');
  const queryPrefix = buildQueryPrefix(data, cleanTitle);
  const titleOnlyQuery = cleanTitle.slice(0, 70).trim();
  const searchQueries = buildSearchQueries(queryPrefix, titleOnlyQuery);

  const trustedDomains = [
    'edu.tr', 'org.tr', 'gov.tr', 'dergipark', 'acikerisim', 'thesis',
    'academia.edu', 'researchgate.net', 'yok.gov.tr', 'tez.yok.gov.tr',
    'dspace', 'springer.com', 'ieee.org', 'sciencedirect.com', 'mdpi.com', 'tezara.org'
  ];

  try {
    const allResults = await collectAllResults(searchQueries, MAX_RESULTS_PER_QUERY);
    if (!allResults.length) return null;

    const candidates = buildCandidates(allResults, title, trustedDomains);
    if (!candidates.length) return null;

    let lastMismatch = null;
    for (const cand of candidates) {
      const checked = await checkCandidateMatch(cand, data, cleanTitle);
      if (checked.skip) continue;
      if (checked.result) return checked.result;
      if (checked.mismatch) lastMismatch = checked.mismatch;
    }
    return lastMismatch || null;
  } catch (e) {
    console.warn('[WEB-VERIFIER]', e.message);
    return null;
  }
}
