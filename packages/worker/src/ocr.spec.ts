import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from './config.js';
import { buildOcrArguments } from './ocr.js';

test('limits OCRmyPDF parallelism and skips existing text by default', () => {
  const previous = {
    ocrJobs: config.ocrJobs,
    ocrLanguages: config.ocrLanguages,
    ocrRotatePages: config.ocrRotatePages,
    ocrDeskew: config.ocrDeskew,
  };

  try {
    config.ocrJobs = 1;
    config.ocrLanguages = 'deu+eng';
    config.ocrRotatePages = true;
    config.ocrDeskew = false;

    assert.deepEqual(buildOcrArguments('/input.pdf', '/output.pdf'), [
      '--jobs',
      '1',
      '--skip-text',
      '--rotate-pages',
      '--language',
      'deu+eng',
      '--output-type',
      'pdf',
      '/input.pdf',
      '/output.pdf',
    ]);
  } finally {
    config.ocrJobs = previous.ocrJobs;
    config.ocrLanguages = previous.ocrLanguages;
    config.ocrRotatePages = previous.ocrRotatePages;
    config.ocrDeskew = previous.ocrDeskew;
  }
});

test('allows OCR quality options to be disabled or enabled independently', () => {
  const previous = {
    ocrJobs: config.ocrJobs,
    ocrLanguages: config.ocrLanguages,
    ocrRotatePages: config.ocrRotatePages,
    ocrDeskew: config.ocrDeskew,
  };

  try {
    config.ocrJobs = 2;
    config.ocrLanguages = 'eng';
    config.ocrRotatePages = false;
    config.ocrDeskew = true;

    assert.deepEqual(buildOcrArguments('/input.pdf', '/output.pdf'), [
      '--jobs',
      '2',
      '--skip-text',
      '--deskew',
      '--language',
      'eng',
      '--output-type',
      'pdf',
      '/input.pdf',
      '/output.pdf',
    ]);
  } finally {
    config.ocrJobs = previous.ocrJobs;
    config.ocrLanguages = previous.ocrLanguages;
    config.ocrRotatePages = previous.ocrRotatePages;
    config.ocrDeskew = previous.ocrDeskew;
  }
});
