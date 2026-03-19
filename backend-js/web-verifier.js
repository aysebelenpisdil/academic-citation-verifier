import { googleSearch } from './google-search.js';
import { ratio, partial_ratio } from 'fuzzball';
import { scrapeMetadata } from './web-scrapers.js';

const CANDIDATE_SCORE_THRESHOLD = 80;
const MAX_RESULTS_PER_QUERY = 5;

function normalizeTurkish(text) {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
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
  for (const c of citLastnames) {
    for (const f of foundLastnames) {
      if (ratio(c, f) > 85) return true;
    }
  }
  return false;
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

export async function verifyViaWeb(citationData) {
  const data = typeof citationData === 'string'
    ? { title: citationData, authors: [] }
    : citationData || {};

  const title = data.title || '';
  if (!title || title.length < 15) return null;

  const cleanTitle = title.replace(/["']/g, '');
  let authorPrefix = '';
  const authorsList = data.authors || [];
  if (authorsList.length) {
    const soyadlar = authorsList.slice(0, 2).map(a => {
      const parts = a.replace(/,/g, ' ').split(' ').filter(p => p.length > 2 && !['ve', 'and', 'et', 'al'].includes(p.toLowerCase()));
      return parts.length ? parts[parts.length - 1] : null;
    }).filter(Boolean);
    if (soyadlar.length) authorPrefix = soyadlar.join(' ') + ' ';
  }
  const queryPrefix = `${authorPrefix}${cleanTitle.slice(0, 70)}`.trim();
  const titleOnlyQuery = cleanTitle.slice(0, 70).trim();

  const trustedDomains = [
    'edu.tr', 'org.tr', 'gov.tr', 'dergipark', 'acikerisim', 'thesis',
    'academia.edu', 'researchgate.net', 'yok.gov.tr', 'tez.yok.gov.tr',
    'dspace', 'springer.com', 'ieee.org', 'sciencedirect.com', 'mdpi.com', 'tezara.org'
  ];

  const searchQueries = [
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

  try {
    const allResults = [];
    for (let i = 0; i < searchQueries.length; i++) {
      try {
        const results = await googleSearch(searchQueries[i], MAX_RESULTS_PER_QUERY);
        if (results.length) allResults.push(...results);
      } catch {}
    }

    if (!allResults.length) return null;

    const seenUrls = new Set();
    const candidates = [];

    for (const res of allResults) {
      const foundTitle = res.title || '';
      const foundUrl = res.url || '';
      const snippet = res.description || '';

      if (!foundUrl || seenUrls.has(foundUrl)) continue;
      const titleScore = partial_ratio(title.toLowerCase(), foundTitle.toLowerCase());
      const snippetScore = partial_ratio(title.toLowerCase(), (snippet || '').toLowerCase());
      const finalScore = Math.max(titleScore, snippetScore);

      const isTrusted = trustedDomains.some(d => foundUrl.includes(d));
      if (!isTrusted && finalScore < 95) continue;
      if (finalScore < CANDIDATE_SCORE_THRESHOLD) continue;

      seenUrls.add(foundUrl);
      const preferArticle = isDergiparkArticleUrl(foundUrl) ? 1 : (isDergiparkDownloadUrl(foundUrl) ? 0 : 0.5);
      candidates.push({
        url: foundUrl,
        found_title: foundTitle,
        score: finalScore,
        prefer_article: preferArticle,
        is_trusted: isTrusted
      });
    }

    candidates.sort((a, b) => (b.score - a.score) || (b.prefer_article - a.prefer_article));

    if (!candidates.length) return null;

    const citationAuthors = data.authors || [];
    const citationJournal = data.journal || '';
    const citationYear = data.year;
    let lastMismatch = null;

    for (const cand of candidates) {
      let urlToUse = cand.url;
      if (isDergiparkDownloadUrl(urlToUse)) {
        const resolved = await resolveDergiparkArticleUrl(urlToUse, cleanTitle);
        if (resolved) urlToUse = resolved;
        else continue;
      }

      const scraped = await scrapeMetadata(urlToUse);
      if (!scraped) continue;

      const foundAuthors = scraped.authors || [];
      const foundJournal = scraped.journal || '';
      const foundYear = scraped.year;

      if (citationAuthors.length && !foundAuthors.length) {
        lastMismatch = {
          source: `Web (Metadata Eksik - ${scraped.source})`,
          is_verified: false,
          url: cand.url,
          score: cand.score,
          note: 'Başlık eşleşti ancak yazar bilgisi web sayfasından çıkarılamadı. Manuel kontrol gerekli.',
          found_metadata: { title: scraped.title, authors: [], year: foundYear, journal: foundJournal }
        };
        continue;
      }
      const authorOk = checkAuthorMatch(citationAuthors, foundAuthors);

      let journalOk = true;
      let journalScore = 0;
      if (citationJournal && !foundJournal) {
        lastMismatch = {
          source: `Web (Metadata Eksik - ${scraped.source})`,
          is_verified: false,
          url: cand.url,
          score: cand.score,
          note: 'Başlık eşleşti ancak dergi bilgisi web sayfasından çıkarılamadı. Manuel kontrol gerekli.',
          found_metadata: { title: scraped.title, authors: foundAuthors.slice(0, 5), year: foundYear, journal: null }
        };
        continue;
      }
      if (citationJournal && foundJournal) {
        journalScore = ratio(normalizeTurkish(citationJournal), normalizeTurkish(foundJournal));
        journalOk = journalScore >= 70;
      }

      let yearOk = true;
      let yearDiff = null;
      if (citationYear && !foundYear) {
        lastMismatch = {
          source: `Web (Metadata Eksik - ${scraped.source})`,
          is_verified: false,
          url: cand.url,
          score: cand.score,
          note: 'Başlık eşleşti ancak yıl bilgisi web sayfasından çıkarılamadı. Manuel kontrol gerekli.',
          found_metadata: { title: scraped.title, authors: foundAuthors.slice(0, 5), year: null, journal: foundJournal }
        };
        continue;
      }
      if (citationYear && foundYear) {
        yearDiff = Math.abs(parseInt(citationYear, 10) - parseInt(foundYear, 10));
        yearOk = yearDiff <= 2;
      }

      if (authorOk && journalOk && yearOk) {
        return {
          source: cand.is_trusted ? 'Web (Akademik Kaynak)' : 'Web (Genel Kaynak)',
          is_verified: true,
          url: cand.url,
          score: cand.score,
          found_title: cand.found_title,
          note: 'Akademik veritabanında bulunamadı ancak güvenilir web kaynağında doğrulandı.',
          found_metadata: {
            title: scraped.title,
            authors: foundAuthors.slice(0, 5),
            year: foundYear,
            journal: foundJournal
          }
        };
      }

      lastMismatch = {
        source: `Web (Metadata Uyuşmazlığı - ${scraped.source})`,
        is_verified: false,
        url: cand.url,
        score: cand.score,
        note: 'İlgili makale bu yazarlara ve bu dergiye ait değil.',
        found_metadata: {
          title: scraped.title,
          authors: foundAuthors.slice(0, 5),
          year: foundYear,
          journal: foundJournal
        }
      };
    }

    return lastMismatch || null;
  } catch (e) {
    console.warn('[WEB-VERIFIER]', e.message);
    return null;
  }
}
