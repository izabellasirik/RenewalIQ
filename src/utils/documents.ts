import type { DocumentCategory, DocumentFileType } from '../types';

export function inferFileType(fileName: string): DocumentFileType {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
  if (ext === 'csv') return 'csv';
  if (ext === 'docx' || ext === 'doc') return 'docx';
  if (ext === 'txt') return 'txt';
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
