import { Request, Response, NextFunction } from 'express';
import { isMongoDuplicateKeyError } from '../utils/mongoErrors';
import multer from 'multer';

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;
  code?: string;

  constructor(message: string, statusCode = 400, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err.code ? { code: err.code } : {}),
    });
    return;
  }

  if (isMongoDuplicateKeyError(err)) {
    console.error('MongoDB duplicate key error:', err);
    res.status(503).json({
      success: false,
      message: 'We could not complete your request right now. Please try again in a moment.',
    });
    return;
  }

  if (err instanceof multer.MulterError) {
    res.status(400).json({
      success: false,
      message: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : err.message,
    });
    return;
  }

  if (err.message?.includes('Only Excel') || err.message?.includes('Only JPEG')) {
    res.status(400).json({ success: false, message: err.message });
    return;
  }

  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
};

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
