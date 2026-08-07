import type { DocumentCategory, DocumentFileType } from '../types';
import { sampleDocumentTemplates } from '../data/sampleDocuments';

export function inferFileType(fileName: string): DocumentFileType {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
  if (ext === 'csv') return 'csv';
  if (ext === 'docx' || ext === 'doc') return 'docx';
  return 'other';
}

export function inferCategory(fileName: string): DocumentCategory {
  const n = fileName.toLowerCase();
  if (n.includes('loss')) return 'loss_run';
  if (n.includes('vehicle')) return 'vehicle_schedule';
  if (n.includes('driver')) return 'driver_schedule';
  if (n.includes('application') || n.includes('acord')) return 'application';
  if (n.includes('financ')) return 'financials';
  return 'other';
}

/** Matches a dropped file's name against our known sample documents so the mock extraction provider recognizes it. */
export function matchKnownSampleDocId(fileName: string): string | null {
  const normalized = fileName.trim().toLowerCase();
  const match = sampleDocumentTemplates.find((t) => t.name.toLowerCase() === normalized);
  return match ? match.id : null;
}
