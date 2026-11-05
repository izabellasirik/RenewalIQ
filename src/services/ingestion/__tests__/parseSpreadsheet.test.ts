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

describe('workbooks other tools save', () => {
  it('reads a workbook stored under a name exceljs does not look for', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
    zip.file('_rels/.rels', '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/book/main.xml"/></Relationships>');
    zip.file('book/main.xml', '<workbook xmlns:r="r"><sheets><sheet name="Vehicles &amp; Units" sheetId="1" r:id="rIdA"/></sheets></workbook>');
    zip.file('book/_rels/main.xml.rels', '<Relationships><Relationship Id="rIdA" Target="data/s1.xml"/><Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="strings.xml"/></Relationships>');
    zip.file('book/strings.xml', '<sst><si><t>Year</t></si><si><t>Make</t></si><si><r><t>VI</t></r><r><t>N</t></r></si></sst>');
    zip.file('book/data/s1.xml', '<worksheet><sheetData>'
      + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>'
      + '<row r="2"><c r="A2"><v>2021</v></c><c r="C2" t="inlineStr"><is><t>1FUJGLDR0CLBP0001</t></is></c></row>'
      + '</sheetData></worksheet>');
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    const file = new File([buf], 'units.xlsx');
    const doc = await parseSpreadsheet(file);
    expect(doc.tables).toEqual([{ sheetName: 'Vehicles & Units', headers: ['Year', 'Make', 'VIN'], rows: [['2021', '', '1FUJGLDR0CLBP0001']] }]);
    expect(doc.warnings).toEqual([]);
  });
});
