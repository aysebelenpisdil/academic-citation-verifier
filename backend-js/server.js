import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { extractCitationsWithGemini } from './llm-extractor.js';
import { verifyCitation } from './verifier.js';

const app = express();
app.disable('x-powered-by');
const allowedOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
app.use(cors({ origin: allowedOrigin, credentials: true }));
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const MAX_PARALLEL_VERIFY = 3;

async function extractTextFromPdf(buffer) {
  try {
    const data = await pdfParse(buffer);
    return data?.text || '';
  } catch {
    return '';
  }
}

async function extractTextFromDocx(buffer) {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result?.value || '';
  } catch {
    return '';
  }
}

async function extractText(req) {
  if (!req.file?.originalname) {
    return { text: req.body?.text ? String(req.body.text) : '' };
  }
  const content = req.file.buffer;
  if (content.length > MAX_FILE_SIZE) return { error: 'SIZE_LIMIT' };
  if (req.file.originalname.toLowerCase().endsWith('.pdf')) return { text: await extractTextFromPdf(content) };
  if (req.file.originalname.toLowerCase().endsWith('.docx')) return { text: await extractTextFromDocx(content) };
  return { text: '' };
}

function buildExtractionLogs(sorted) {
  let success = 0;
  const logs = [];
  for (const [i, cite, ver] of sorted) {
    if (ver?.is_verified) success++;
    logs.push({
      id: i,
      raw_input: cite.raw_text || 'Ham metin yok',
      extracted_title: cite.title || 'Çıkarılamadı',
      extracted_authors: cite.authors || [],
      method_used: 'Yapay Zeka (Gemini)',
      verification_status: ver?.is_verified ? 'BAŞARILI' : 'BAŞARISIZ',
      verification_source: ver?.source || 'N/A'
    });
  }
  return { success, logs };
}

async function verifyInBatches(parsed, concurrency = 3) {
  const indexed = parsed.map((c, i) => [i + 1, c]);
  const results = [];
  for (let i = 0; i < indexed.length; i += concurrency) {
    const chunk = indexed.slice(i, i + concurrency);
    const batch = await Promise.all(chunk.map(async ([idx, cite]) => {
      const ver = await verifyCitation(cite);
      cite.verification = ver;
      return [idx, cite, ver];
    }));
    results.push(...batch);
  }
  return results.sort((a, b) => a[0] - b[0]);
}

app.post('/analyze', upload.single('file'), async (req, res) => {
  try {
    const apiKey = req.body?.api_key || process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) return res.status(400).json({ detail: 'API key gerekli' });

    const sourceName = req.file?.originalname || 'Manuel Metin';
    const extracted = await extractText(req);
    if (extracted.error) return res.status(400).json({ detail: 'Dosya boyutu 15MB sınırını aşıyor.' });

    const rawText = extracted.text;
    if (!rawText?.trim()) return res.status(400).json({ detail: 'İçerik boş.' });

    const parsed = await extractCitationsWithGemini(rawText.slice(0, 30000), apiKey);
    if (!parsed.length) {
      return res.json({ status: 'success', data: { title: sourceName, citation_count: 0, verified_count: 0, success_rate: 0, citations: [], extraction_logs: [], method: 'Yapay Zeka (Gemini)' } });
    }

    const sorted = await verifyInBatches(parsed, MAX_PARALLEL_VERIFY);
    const verified = sorted.map(([, cite]) => cite);
    const { success, logs: extractionLogs } = buildExtractionLogs(sorted);

    return res.json({
      status: 'success',
      data: {
        title: sourceName,
        citation_count: verified.length,
        verified_count: success,
        success_rate: verified.length ? Math.round((success / verified.length) * 1000) / 10 : 0,
        citations: verified,
        extraction_logs: extractionLogs,
        method: 'Yapay Zeka (Gemini)'
      }
    });
  } catch (e) {
    console.warn('[SERVER]', e.message);
    return res.status(500).json({ detail: String(e.message) });
  }
});

app.get('/health', (_, res) => res.json({ ok: true, version: '2.0.0' }));

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`http://127.0.0.1:${PORT}`);
});

export { app };
