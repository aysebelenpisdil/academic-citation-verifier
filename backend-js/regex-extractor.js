function cleanText(t) {
  if (!t) return '';
  return String(t).replace(/\s+/g, ' ').trim();
}

function extractDoi(str) {
  const match = /10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/i.exec(str);
  return match ? match[0].replace(/[.,;)]+$/, '') : null;
}

function parseCitationLine(line) {
  const cleanLine = cleanText(line);
  if (cleanLine.length < 15) return null;

  // Remove leading numbers or markers like "1.", "[1]", "1-", etc.
  const contentLine = cleanLine.replace(/^(\[\d+\]|\d+[\.\)]|\(\d+\))\s*/, '').trim();
  if (contentLine.length < 15) return null;

  // Search for year (19xx or 20xx)
  const yearMatch = /\b(19\d{2}|20\d{2})\b/.exec(contentLine);
  const year = yearMatch ? yearMatch[1] : null;

  const doi = extractDoi(contentLine);

  let authors = [];
  let title = '';
  let journal = '';

  // Try standard APA format: Author1, A., & Author2, B. (Year). Title. Journal...
  const apaMatch = /^([^()]+?)\s*\(\s*(19\d{2}|20\d{2})\s*\)\s*[\.:]?\s*([^\.]+)\.?(.*)$/i.exec(contentLine);
  if (apaMatch) {
    const rawAuthors = apaMatch[1].trim();
    title = cleanText(apaMatch[3]);
    const rest = cleanText(apaMatch[4]);
    journal = rest || '';

    // Split authors
    if (rawAuthors.includes('&')) {
      authors = rawAuthors.split(/&|,/).map(a => cleanText(a)).filter(a => a.length > 1);
    } else if (rawAuthors.includes(',')) {
      authors = rawAuthors.split(',').map(a => cleanText(a)).filter(a => a.length > 1);
    } else {
      authors = [rawAuthors];
    }
  } else {
    // Generic fallback: Split by period
    const parts = contentLine.split(/\.\s+/);
    if (parts.length >= 2) {
      const first = parts[0].trim();
      const second = parts[1].trim();

      if (year && first.includes(year)) {
        authors = [first.replace(/\(19\d{2}|20\d{2}\)/g, '').trim()];
        title = second;
      } else {
        authors = [first];
        title = second;
      }
      if (parts.length >= 3) {
        journal = parts.slice(2).join('. ');
      }
    } else {
      title = contentLine;
    }
  }

  // Ensure title is clean and valid
  title = title.replace(/^["'“`]+|["'”`]+$/g, '').trim();
  if (title.length < 8) {
    title = contentLine;
  }

  // Clean authors list
  authors = authors
    .map(a => a.replace(/et\s+al\.?/i, '').replace(/[\(\)]/g, '').trim())
    .filter(a => a.length >= 2 && !/^(19|20)\d{2}$/.test(a));

  return {
    title,
    authors: authors.length ? authors : ['Bilinmeyen Yazar'],
    year: year || null,
    journal: journal || null,
    doi: doi || null,
    raw_text: contentLine
  };
}

export function extractCitationsWithRegex(text) {
  if (!text || typeof text !== 'string') return [];

  // Normalize line endings
  const normalized = text.replace(/\r\n/g, '\n');

  // Split either by double newlines or single line breaks
  let blocks = normalized.split(/\n{2,}/);

  if (blocks.length < 3) {
    blocks = normalized.split('\n');
  }

  const citations = [];
  const seenTitles = new Set();

  for (const rawBlock of blocks) {
    const trimmed = cleanText(rawBlock);
    if (!trimmed || trimmed.length < 20) continue;

    // Skip section header lines
    if (/^(KAYNAKLAR|KAYNAKÇA|REFERENCES|BIBLIOGRAPHY|LİTERATÜR)(\s*:.*)?$/i.test(trimmed)) {
      continue;
    }

    const parsed = parseCitationLine(trimmed);
    if (parsed && parsed.title && parsed.title.length >= 8) {
      const lowerTitle = parsed.title.toLowerCase();
      if (!seenTitles.has(lowerTitle)) {
        seenTitles.add(lowerTitle);
        citations.push(parsed);
      }
    }
  }

  return citations;
}
