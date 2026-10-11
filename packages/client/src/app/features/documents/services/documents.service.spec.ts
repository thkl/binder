import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DocumentsService } from './documents.service';

describe('DocumentsService format discovery', () => {
  let service: DocumentsService;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.removeItem('binder.document-formats.v1');
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DocumentsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('loads upload descriptors, builds the picker filter, and checks MIME and extension hints', async () => {
    const loading = service.loadSupportedFormats();
    http.expectOne((request) => request.url.endsWith('/v1/document-formats')).flush({
      data: {
        formats: [
          {
            id: 'pdf',
            displayName: 'PDF',
            extensions: ['.pdf'],
            mimeTypes: ['application/pdf'],
            capabilities: ['upload', 'download', 'preview', 'page-count', 'page-rotation', 'split'],
          },
          {
            id: 'text',
            displayName: 'Plain text',
            extensions: ['.txt'],
            mimeTypes: ['text/plain'],
            capabilities: ['upload', 'download', 'text-extraction'],
          },
        ],
      },
    });
    await loading;

    expect(service.uploadAccept()).toBe('application/pdf,.pdf,text/plain,.txt');
    expect(service.isLikelySupportedUpload(new File(['x'], 'notes.txt', { type: 'text/plain' }))).toBe(
      true,
    );
    expect(service.isLikelySupportedUpload(new File(['x'], 'notes.pdf', { type: 'text/plain' }))).toBe(
      true,
    );
    expect(service.isLikelySupportedUpload(new File(['x'], 'unknown.bin', { type: 'text/csv' }))).toBe(
      false,
    );
    expect(service.isLikelySupportedUpload(new File(['x'], 'unknown.bin'))).toBe(true);
    expect(service.supportsMimeCapability('application/pdf', 'split')).toBe(true);
    expect(service.supportsMimeCapability('text/plain', 'split')).toBe(false);
    expect(service.hasPdfPreview('text/plain')).toBe(false);
    expect(JSON.parse(localStorage.getItem('binder.document-formats.v1') ?? '{}').formats).toHaveLength(
      2,
    );
  });

  it('keeps the validated cached list when discovery is offline', async () => {
    localStorage.setItem(
      'binder.document-formats.v1',
      JSON.stringify({
        formats: [
          {
            id: 'text',
            displayName: 'Plain text',
            extensions: ['.txt'],
            mimeTypes: ['text/plain'],
            capabilities: ['upload', 'download'],
          },
        ],
      }),
    );
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DocumentsService);
    http = TestBed.inject(HttpTestingController);

    const loading = service.loadSupportedFormats();
    http.expectOne((request) => request.url.endsWith('/v1/document-formats')).error(
      new ProgressEvent('network-error'),
    );
    await loading;

    expect(service.uploadAccept()).toBe('text/plain,.txt');
    expect(service.isLikelySupportedUpload(new File(['x'], 'notes.txt', { type: 'text/plain' }))).toBe(
      true,
    );
  });

  it('surfaces the server rejection when a selected file is not actually supported', async () => {
    const upload = service.upload(new File(['not a PDF'], 'report.csv', { type: 'text/csv' }));
    http.expectOne(
      (request) => request.method === 'POST' && request.url.endsWith('/v1/documents'),
    ).flush(
      { message: 'The file format is not supported.' },
      { status: 415, statusText: 'Unsupported Media Type' },
    );

    expect(await upload).toBe(false);
    expect(service.error()).toBe('The file format is not supported.');
  });
});
