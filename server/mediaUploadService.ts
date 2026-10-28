import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'mp4', 'webm', 'ogg', 'mov']);
const UPLOADS_DIR = path.resolve(process.cwd(), 'public', 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function getSafeExtension(filename: string, mimeType?: string): string {
  const ext = (path.extname(filename || '').slice(1) || '').toLowerCase();
  if (ALLOWED_EXTENSIONS.has(ext)) return ext;

  if (mimeType) {
    const mime = mimeType.toLowerCase();
    if (mime.includes('image/png')) return 'png';
    if (mime.includes('image/jpeg')) return 'jpg';
    if (mime.includes('image/webp')) return 'webp';
    if (mime.includes('image/gif')) return 'gif';
    if (mime.includes('video/mp4')) return 'mp4';
    if (mime.includes('video/webm')) return 'webm';
    if (mime.includes('video/ogg')) return 'ogg';
    if (mime.includes('video/quicktime')) return 'mov';
  }
  return 'bin';
}

/** Handles media file upload requests without requiring external multipart libraries. */
export async function handleMediaUpload(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return;
  }

  const MAX_SIZE = 50 * 1024 * 1024; // 50MB
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  req.on('data', (chunk: Buffer) => {
    totalBytes += chunk.length;
    if (totalBytes > MAX_SIZE) {
      req.destroy();
      res.statusCode = 413;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Payload Too Large: Maximum allowed media upload is 50MB' }));
    } else {
      chunks.push(chunk);
    }
  });

  req.on('end', async () => {
    try {
      const buffer = Buffer.concat(chunks);
      const contentType = req.headers['content-type'] || '';

      let fileBuffer: Buffer;
      let originalName = 'upload';
      let mimeType = 'application/octet-stream';

      if (contentType.includes('application/json')) {
        const json = JSON.parse(buffer.toString('utf-8'));
        originalName = json.filename || 'upload';
        const dataUrl = json.dataUrl || json.data || '';

        const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          mimeType = match[1];
          fileBuffer = Buffer.from(match[2], 'base64');
        } else {
          fileBuffer = Buffer.from(dataUrl, 'base64');
        }
      } else {
        fileBuffer = buffer;
        mimeType = contentType.split(';')[0].trim();
        const headerName = req.headers['x-filename'];
        if (typeof headerName === 'string') {
          originalName = decodeURIComponent(headerName);
        }
      }

      const ext = getSafeExtension(originalName, mimeType);
      if (ext === 'bin' || !ALLOWED_EXTENSIONS.has(ext)) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Unsupported media format. Allowed: PNG, JPG, GIF, WebP, MP4, WebM, OGG' }));
        return;
      }

      const uniqueId = crypto.randomUUID();
      const storedFileName = `${uniqueId}.${ext}`;
      const targetPath = path.join(UPLOADS_DIR, storedFileName);

      await fs.promises.writeFile(targetPath, fileBuffer);

      const publicUrl = `/uploads/${storedFileName}`;
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        url: publicUrl,
        filename: originalName,
        size: fileBuffer.length,
        type: mimeType,
      }));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Upload processing failed' }));
    }
  });

  req.on('error', (err) => {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: err.message }));
  });
}
