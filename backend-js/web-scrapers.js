import axios from 'axios';
import * as cheerio from 'cheerio';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
const REQ_TIMEOUT = 10000;

function cleanText(text) {
  if (!text) return '';
  return text.replaceAll('\n', ' ').replaceAll('\r', ' ').replaceAll('\t', ' ').replace(/\s+/g, ' ').trim();
}

function findIeeeAuthors($) {
  const authors = [];
  $('meta[name="citation_author"]').each((_, el) => {
    const c = cleanText($(el).attr('content'));
    if (c) authors.push(c);
  });
  if (authors.length) return authors;
  $('a[href*="/author/"]').each((_, el) => {
    const n = cleanText($(el).text());
    if (n && n.length > 3) authors.push(n);
  });
  if (authors.length) return authors;
  const jsonLd = $('script[type="application/ld+json"]').first().html();
  if (jsonLd) {
    try {
      const d = JSON.parse(jsonLd);
      const alist = d?.author;
      if (Array.isArray(alist)) return alist.map(a => a?.name).filter(Boolean);
      if (alist?.name) return [alist.name];
    } catch {}
  }
  return authors;
}

function findIeeeYear($) {
  const dateMeta = $('meta[name="citation_publication_date"]').attr('content') || $('meta[name="citation_year"]').attr('content');
  if (dateMeta) {
    const m = dateMeta.match(/\d{4}/);
    if (m) return Number.parseInt(m[0], 10);
  }
  const dm = $('.doc-abstract-pubdate').text().match(/\d{4}/);
  if (dm) return Number.parseInt(dm[0], 10);
  let year = null;
  $('meta').each((_, el) => {
    const ym = ($(el).attr('content') || '').match(/\b(19|20)\d{2}\b/);
    if (ym) year = Number.parseInt(ym[0], 10);
    return !year;
  });
  return year;
}

async function scrapeIeee(url) {
  const resolvedUrl = url.includes('/abstract/document/')
    ? url.replace('/abstract/document/', '/document/')
    : url;
  try {
    const { data } = await axios.get(resolvedUrl, { headers: { 'User-Agent': USER_AGENT }, timeout: REQ_TIMEOUT, responseType: 'text' });
    const $ = cheerio.load(data);
    const title = $('h1.document-title').text().trim() || $('meta[property="og:title"]').attr('content') || '';
    const journal = cleanText($('meta[name="citation_conference_title"]').attr('content')) ||
      cleanText($('meta[name="citation_journal_title"]').attr('content')) ||
      cleanText($('a.stats-document-abstract-publishedIn').text()) ||
      cleanText($('meta[name="citation_publisher"]').attr('content'));
    return {
      title: cleanText(title) || null,
      authors: findIeeeAuthors($).slice(0, 10),
      year: findIeeeYear($),
      journal: journal || null,
      source: 'IEEE Xplore'
    };
  } catch {
    return null;
  }
}

async function scrapeSciencedirect(url) {
  try {
    const { data } = await axios.get(url, { headers: { 'User-Agent': USER_AGENT }, timeout: REQ_TIMEOUT, responseType: 'text' });
    const $ = cheerio.load(data);

    const title = cleanText($('span.title-text').text()) || cleanText($('meta[name="citation_title"]').attr('content')) || '';
    const authors = [];
    $('meta[name="citation_author"]').each((_, el) => {
      const c = cleanText($(el).attr('content'));
      if (c) authors.push(c);
    });
    let year = null;
    const dateStr = $('meta[name="citation_publication_date"]').attr('content') || '';
    const ym = dateStr.match(/\d{4}/);
    if (ym) year = Number.parseInt(ym[0], 10);
    const journal = cleanText($('meta[name="citation_journal_title"]').attr('content')) || null;

    return {
      title: title || null,
      authors: authors.slice(0, 10),
      year,
      journal,
      source: 'ScienceDirect'
    };
  } catch {
    return null;
  }
}

async function scrapeDergipark(url) {
  try {
    const { data, headers } = await axios.get(url, { headers: { 'User-Agent': USER_AGENT }, timeout: REQ_TIMEOUT, responseType: 'text', maxRedirects: 5 });
    const ct = (headers['content-type'] || '').toLowerCase();
    if (ct.includes('application/pdf') || (typeof data === 'string' && data.startsWith('%PDF'))) return null;

    const $ = cheerio.load(data);
    const title = cleanText($('h1.article-title').text()) || cleanText($('meta[name="citation_title"]').attr('content')) || '';
    const authors = [];
    $('meta[name="citation_author"]').each((_, el) => {
      const c = cleanText($(el).attr('content'));
      if (c) authors.push(c);
    });
    if (!authors.length) {
      $('.article-authors a').each((_, el) => {
        const n = cleanText($(el).text());
        if (n && n.length > 3) authors.push(n);
      });
    }
    let year = null;
    const dateStr = $('meta[name="citation_publication_date"]').attr('content') || '';
    const ym = dateStr.match(/\d{4}/);
    if (ym) year = Number.parseInt(ym[0], 10);
    const journal = cleanText($('meta[name="citation_journal_title"]').attr('content')) || null;

    return {
      title: title || null,
      authors: authors.slice(0, 10),
      year,
      journal,
      source: 'DergiPark'
    };
  } catch {
    return null;
  }
}

function findTezaraAuthor(text) {
  for (const line of text.split('\n')) {
    const m = line.match(/^\d*\.?\s*Yazar\s*:\s*(.+)/i);
    if (m) {
      const name = cleanText(m[1]);
      if (name && name.length > 2) return [name];
    }
  }
  const mm = text.match(/Yazar\s*:\s*([^\n]+)/i);
  return mm ? [cleanText(mm[1])] : [];
}

async function scrapeTezara(url) {
  try {
    const { data } = await axios.get(url, { headers: { 'User-Agent': USER_AGENT }, timeout: REQ_TIMEOUT, responseType: 'text' });
    const $ = cheerio.load(data);
    const text = $('body').text();

    let title = cleanText($('meta[property="og:title"]').attr('content')) || cleanText($('h1').first().text()) || '';
    if (title?.includes('|')) title = title.split('|')[0].trim();

    const authors = findTezaraAuthor(text);

    let year = null;
    const yearM = text.match(/(?:Yıl|Yil)\s*:\s*(\d{4})/i);
    if (yearM) year = Number.parseInt(yearM[1], 10);

    const univM = text.match(/Üniversite\s*:\s*([^\n]+)/i);
    const enstM = text.match(/Enstitü\s*:\s*([^\n]+)/i);
    const parts = [];
    if (univM) parts.push(cleanText(univM[1]));
    if (enstM) parts.push(cleanText(enstM[1]));
    const journal = parts.length ? parts.join(', ') : null;

    return {
      title: title || null,
      authors: authors.slice(0, 10),
      year,
      journal,
      source: 'Tezara'
    };
  } catch {
    return null;
  }
}

async function scrapeGeneric(url) {
  try {
    const { data } = await axios.get(url, { headers: { 'User-Agent': USER_AGENT }, timeout: REQ_TIMEOUT, responseType: 'text' });
    const $ = cheerio.load(data);

    const title = cleanText($('meta[name="citation_title"]').attr('content')) ||
      cleanText($('meta[property="og:title"]').attr('content')) ||
      cleanText($('meta[name="dc.title"]').attr('content')) || '';

    const authors = [];
    $('meta[name="citation_author"], meta[name="dc.creator"]').each((_, el) => {
      const c = cleanText($(el).attr('content'));
      if (c) authors.push(c);
    });

    let year = null;
    const dateStr = $('meta[name="citation_publication_date"]').attr('content') ||
      $('meta[name="citation_year"]').attr('content') ||
      $('meta[name="dc.date"]').attr('content') || '';
    const ym = dateStr.match(/\d{4}/);
    if (ym) year = Number.parseInt(ym[0], 10);

    const journal = cleanText($('meta[name="citation_journal_title"]').attr('content')) ||
      cleanText($('meta[name="citation_conference_title"]').attr('content')) ||
      cleanText($('meta[name="dc.source"]').attr('content')) || null;

    let source = 'Web Source';
    if (url.includes('springer.com')) source = 'Springer';
    else if (url.includes('mdpi.com')) source = 'MDPI';
    else if (url.includes('researchgate.net')) source = 'ResearchGate';
    else if (url.includes('academia.edu')) source = 'Academia.edu';

    return {
      title: title || null,
      authors: authors.slice(0, 10),
      year,
      journal,
      source
    };
  } catch {
    return null;
  }
}

export async function scrapeMetadata(url) {
  if (!url?.trim()) return null;
  const u = url.toLowerCase();

  if (u.includes('ieee.org')) return scrapeIeee(url);
  if (u.includes('sciencedirect.com')) return scrapeSciencedirect(url);
  if (u.includes('dergipark.org.tr')) return scrapeDergipark(url);
  if (u.includes('tezara.org')) return scrapeTezara(url);
  return scrapeGeneric(url);
}
