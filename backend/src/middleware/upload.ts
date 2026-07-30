import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { env } from '../config/env';

const uploadDir = process.env.VERCEL
  ? path.join('/tmp', env.uploadDir)
  : path.join(process.cwd(), env.uploadDir);

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

function ensureUploadDir(): void {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      ensureUploadDir();
      cb(null, uploadDir);
    } catch (err) {
      cb(err as Error, uploadDir);
    }
  },
  filename: (_req, file, cb) => {
    const ext = MIME_TO_EXT[file.mimetype] || path.extname(file.originalname) || '.bin';
    const unique = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    cb(null, `${unique}${ext}`);
  },
});

const uploadLimits: multer.Options['limits'] = {
  fileSize: env.maxFileSize,
  files: 1,
  fields: 5,
  fieldNameSize: 100,
  fieldSize: 1024,
};

export const upload = multer({
  storage,
  limits: uploadLimits,
  fileFilter: (_req, file, cb) => {
    if (MIME_TO_EXT[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, WebP, and GIF images are allowed'));
    }
  },
});

export const uploadSpreadsheet = multer({
  storage: multer.memoryStorage(),
  limits: uploadLimits,
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/csv',
      'application/octet-stream',
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xls') {
      cb(new Error('Legacy .xls is not supported. Save as .xlsx or .csv and try again.'));
      return;
    }
    if (allowed.includes(file.mimetype) || ['.xlsx', '.csv', '.txt'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel (.xlsx), CSV, or TXT files are allowed'));
    }
  },
});
