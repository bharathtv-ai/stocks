// POST /api/parse-cas
// multipart form: file (PDF), password, provider
// Decrypts, extracts text, returns parsed structure. No database writes here —
// the browser previews, then does the inserts itself.

import { extractPagesText } from '@/lib/pdfText';
import { parseNsdlCas } from '@/lib/parseCas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    const password = form.get('password') || '';
    const provider = form.get('provider') || 'NSDL_CAS';

    if (!file || typeof file === 'string') {
      return Response.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    let pages;
    try {
      pages = await extractPagesText(bytes, password);
    } catch (e) {
      const msg = String(e?.message || e);
      const isPw = /password/i.test(msg);
      return Response.json(
        { error: isPw ? 'Wrong password (or PDF needs a password)' : `PDF parse error: ${msg}` },
        { status: 400 }
      );
    }

    const rawText = pages.map((p) => p.join('\n')).join('\n');

    let parsed = null;
    if (provider === 'NSDL_CAS') {
      parsed = parseNsdlCas(rawText);
    }

    return Response.json({
      provider,
      file_name: file.name,
      file_size: bytes.byteLength,
      page_count: pages.length,
      raw_text: rawText,
      parsed,
    });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
