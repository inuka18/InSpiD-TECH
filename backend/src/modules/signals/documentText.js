'use strict';
// Turns an uploaded file (in memory) into plain text. Nothing is stored and the content is never logged.
// Supported: .txt .md .markdown .docx .pdf. Anything else is a 415.
const path = require('path');
const AppError = require('../../shared/AppError');

const TEXT_EXT = new Set(['.txt', '.md', '.markdown']);

const startsWith = (buf, str) => buf.length >= str.length && buf.subarray(0, str.length).toString('latin1') === str;

async function docxText(buffer) {
  if (!startsWith(buffer, 'PK')) throw new AppError(400, 'BAD_DOCX', 'This file is not a valid .docx document');
  try {
    // eslint-disable-next-line global-require
    const mammoth = require('mammoth');
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  } catch {
    throw new AppError(422, 'DOCX_UNREADABLE', 'Could not read text from this .docx file');
  }
}

async function pdfText(buffer) {
  if (!startsWith(buffer, '%PDF')) throw new AppError(400, 'BAD_PDF', 'This file is not a valid PDF');
  let unpdf;
  try {
    unpdf = await import('unpdf'); // ESM-only package, loaded on demand from this CommonJS code
  } catch {
    throw new AppError(415, 'PDF_UNSUPPORTED', 'PDF text extraction is not available on this server. Upload a .txt, .md or .docx file, or paste the text.');
  }
  try {
    const pdf = await unpdf.getDocumentProxy(new Uint8Array(buffer));
    const { text } = await unpdf.extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join('\n') : text;
  } catch {
    throw new AppError(422, 'PDF_UNREADABLE', 'Could not read text from this PDF (a scanned PDF has no text to extract)');
  }
}

/** @returns {Promise<string>} the text of the file */
async function extractTextFromFile({ buffer, originalname = '' }) {
  const ext = path.extname(originalname).toLowerCase();
  let text;
  if (TEXT_EXT.has(ext)) {
    if (buffer.includes(0)) throw new AppError(415, 'NOT_TEXT', 'This file looks binary, not text');
    text = buffer.toString('utf8');
  } else if (ext === '.docx') {
    text = await docxText(buffer);
  } else if (ext === '.pdf') {
    text = await pdfText(buffer);
  } else {
    throw new AppError(415, 'UNSUPPORTED_FILE_TYPE', `Unsupported file type "${ext || 'unknown'}". Upload a .txt, .md, .docx or .pdf file, or paste the text.`);
  }
  text = String(text ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (!text.trim()) throw new AppError(422, 'EMPTY_DOCUMENT', 'No text could be found in this file');
  return text;
}

module.exports = { extractTextFromFile };
