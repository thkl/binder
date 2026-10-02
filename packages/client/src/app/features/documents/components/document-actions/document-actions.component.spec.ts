import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Document } from '@binder/common';
import { describe, expect, it, beforeEach } from 'vitest';
import { DocumentActionsComponent } from './document-actions.component';

const documentUuid = '11111111-1111-4111-8111-111111111111';
const ownerUuid = '22222222-2222-4222-8222-222222222222';

function createDocument(overrides: Partial<Document> = {}): Document {
  return {
    uuid: documentUuid,
    ownerUuid,
    title: 'Service report',
    originalFilename: 'service-report.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    checksumSha256: 'a'.repeat(64),
    storageKey: 'documents/2026/10/document.pdf',
    thumbnailKey: null,
    thumbnailUrl: '/api/v1/documents/thumbnail',
    archiveKey: null,
    archiveUrl: null,
    archiveStatus: 'not-requested',
    archiveError: null,
    pageCount: 1,
    issuerUuid: null,
    isNew: false,
    metadataSummary: {
      documentType: null,
      category: null,
      issuer: null,
      tags: [],
      custom: [],
    },
    status: 'ready',
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    ...overrides,
  };
}

describe('DocumentActionsComponent', () => {
  let fixture: ComponentFixture<DocumentActionsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DocumentActionsComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DocumentActionsComponent);
    fixture.componentRef.setInput('document', createDocument());
    fixture.detectChanges();
  });

  it('uses a direct download link when only the original is available', () => {
    const downloadMenu = fixture.nativeElement.querySelector('.download-version-menu');
    const downloadLink = fixture.nativeElement.querySelector(
      'a[download="service-report.pdf"]',
    ) as HTMLAnchorElement | null;

    expect(downloadMenu).toBeNull();
    expect(downloadLink).not.toBeNull();
    expect(downloadLink?.href).toContain('/api/v1/documents/' + documentUuid + '/file');
  });

  it('opens a version menu when a PDF/A archive is available', () => {
    fixture.componentRef.setInput(
      'document',
      createDocument({
        archiveKey: 'derived/' + documentUuid + '/archive.pdf',
        archiveUrl: '/api/v1/documents/' + documentUuid + '/archive',
        archiveStatus: 'ready',
      }),
    );
    fixture.detectChanges();

    const downloadButton = fixture.nativeElement.querySelector(
      '[aria-haspopup="menu"]',
    ) as HTMLButtonElement;
    downloadButton.click();
    fixture.detectChanges();

    const options = fixture.nativeElement.querySelectorAll('.download-version-option');
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain('Original document');
    expect(options[1].textContent).toContain('Download PDF/A archive');
  });

  it('closes the version menu when the user clicks outside the action control', () => {
    fixture.componentRef.setInput(
      'document',
      createDocument({
        archiveKey: 'derived/' + documentUuid + '/archive.pdf',
        archiveUrl: '/api/v1/documents/' + documentUuid + '/archive',
        archiveStatus: 'ready',
      }),
    );
    fixture.detectChanges();

    const downloadButton = fixture.nativeElement.querySelector(
      '[aria-haspopup="menu"]',
    ) as HTMLButtonElement;
    downloadButton.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.download-version-menu')).not.toBeNull();

    document.body.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.download-version-menu')).toBeNull();
  });
});
