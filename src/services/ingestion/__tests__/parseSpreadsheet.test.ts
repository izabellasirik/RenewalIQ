import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { parseSpreadsheet } from '../parseSpreadsheet';
import { extractInsuranceFields } from '../../extraction';

describe('reading a spreadsheet with empty cells', () => {
  it('empty cells become blanks, so extraction never trips over them (Google Sheets exports skip empty cells)', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Vehicles');
    ws.getCell('A1').value = 'Unit';
    ws.getCell('C1').value = 'VIN';
    ws.getCell('D1').value = 'Year';
    ws.getCell('A2').value = '1';
    ws.getCell('C2').value = '1FUJGLDR7CLBP8834';
    ws.getCell('D2').value = 2019;
    const raw = await parseSpreadsheet(new File([await wb.xlsx.writeBuffer()], 'units.xlsx'));
    expect(raw.tables![0].headers).toEqual(['Unit', '', 'VIN', 'Year']);
    expect(raw.tables![0].rows[0]).toEqual(['1', '', '1FUJGLDR7CLBP8834', '2019']);
    expect(() => extractInsuranceFields(raw, { documentId: 'd', documentName: 'units.xlsx', isImageSource: false })).not.toThrow();
  });
});
