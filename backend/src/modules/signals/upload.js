'use strict';
// Multipart upload for POST /signals/extract: one file in memory (never written to disk), 2 MB at most.
const multer = require('multer');
const AppError = require('../../shared/AppError');

const MAX_BYTES = 2 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1, fields: 10, parts: 12 } });

function documentUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof AppError) return next(err);
    if (err.code === 'LIMIT_FILE_SIZE') return next(new AppError(413, 'FILE_TOO_LARGE', 'The file is larger than 2 MB. Split it or paste the relevant part.'));
    if (err.code === 'LIMIT_UNEXPECTED_FILE') return next(new AppError(400, 'UNEXPECTED_FILE', 'Send the file in the form field named "file"'));
    return next(new AppError(400, 'UPLOAD_ERROR', 'Could not read the upload')); // never echo the content
  });
}

module.exports = { documentUpload, MAX_BYTES };
