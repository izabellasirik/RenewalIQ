import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentLinkError, LINK_UNREADABLE_MESSAGE, detectDocumentLink, directDownloadUrl, fetchLinkedDocument, isFetchableUrl, linkAsFile } from '../documentLinks';
import { parseFile } from '../parseFile';

const file = (content: string, name: string) => new File([content], name, { type: 'text/plain' });
const respond = (body: BodyInit, headers: Record<string, string>, status = 200) => vi.fn(async () => new Response(body, { status, headers }));

afterEach(() => vi.unstubAllGlobals());

describe('spotting a document that is really a link', () => {
  it('reads .url and .webloc shortcuts, and text files that are only a URL', async () => {
    expect(await detectDocumentLink(file('[InternetShortcut]\nURL=https://example.com/a.pdf\n', 'Loss runs.url'))).toBe('https://example.com/a.pdf');
    expect(await detectDocumentLink(file('<plist><dict><key>URL</key><string>https://example.com/b.pdf</string></dict></plist>', 'b.webloc'))).toBe('https://example.com/b.pdf');
    expect(await detectDocumentLink(file('  https://example.com/c.xlsx \n', 'link.txt'))).toBe('https://example.com/c.xlsx');
    expect(await detectDocumentLink(file(linkAsFile('https://example.com/d.pdf') as never, 'x'))).toBe(null); // (sanity: File-in-File isn't a link)
    expect(await detectDocumentLink(linkAsFile('https://example.com/d.pdf'))).toBe('https://example.com/d.pdf');
  });

  it('leaves real documents alone', async () => {
    expect(await detectDocumentLink(file('Named insured: ABC Trucking\nSee https://example.com for more', 'notes.txt'))).toBe(null);
    expect(await detectDocumentLink(file('x'.repeat(20000), 'big.txt'))).toBe(null);
    expect(await detectDocumentLink(new File([new Uint8Array([0xff, 0xd8, 0xff])], 'photo.jpg'))).toBe(null);
  });
});

describe('only safe links are opened', () => {
  it('https on the public internet only', () => {
    expect(isFetchableUrl('https://www.dropbox.com/s/abc/loss.pdf')).toBe(true);
    for (const bad of ['http://example.com/a.pdf', 'https://localhost/a.pdf', 'https://192.168.1.5/a.pdf', 'https://[::1]/a.pdf', 'https://intranet/a.pdf', 'https://user:pw@example.com/a.pdf', 'file:///etc/passwd', 'javascript:alert(1)']) {
      expect(isFetchableUrl(bad), bad).toBe(false);
    }
  });

  it('rewrites Google Drive / Dropbox view links to direct downloads', () => {
    expect(directDownloadUrl('https://drive.google.com/file/d/ABC123/view?usp=sharing')).toBe('https://drive.google.com/uc?export=download&id=ABC123');
    expect(directDownloadUrl('https://www.dropbox.com/s/xyz/loss.pdf?dl=0')).toBe('https://www.dropbox.com/s/xyz/loss.pdf?dl=1');
  });
});

describe('downloading the linked document', () => {
  it('returns a real document', async () => {
    vi.stubGlobal('fetch', respond('%PDF-1.4 ...', { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="ABC Loss Runs.pdf"' }));
    const f = await fetchLinkedDocument('https://example.com/dl?id=1', 'link.url');
    expect(f.name).toBe('ABC Loss Runs.pdf');
  });

  it('a generic download is accepted only when its name is a type we read', async () => {
    vi.stubGlobal('fetch', respond('a,b\n1,2', { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="units.xlsx"' }));
    expect((await fetchLinkedDocument('https://example.com/u', 'link.url')).name).toBe('units.xlsx');
  });

  it.each([
    ['a sign-in page', respond('<html>Sign in</html>', { 'content-type': 'text/html' })],
    ['a 403', respond('nope', { 'content-type': 'text/plain' }, 403)],
    ['a fake PDF', respond('<html>not a pdf</html>', { 'content-type': 'application/pdf' })],
    ['a blocked download (CORS / network)', vi.fn(async () => { throw new TypeError('Failed to fetch'); })],
  ])('%s → not accessible, URL kept', async (_label, fetchMock) => {
    vi.stubGlobal('fetch', fetchMock);
    const err = await fetchLinkedDocument('https://example.com/doc', 'link.url').catch((e) => e);
    expect(err).toBeInstanceOf(DocumentLinkError);
    expect(err.message).toBe(LINK_UNREADABLE_MESSAGE);
    expect(err.sourceUrl).toBe('https://example.com/doc');
  });

  it('never fetches an unsafe link at all', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchLinkedDocument('http://example.com/a.pdf', 'x.url')).rejects.toBeInstanceOf(DocumentLinkError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('through the normal pipeline (parseFile)', () => {
  it('a link to a readable document is parsed as that document, with its source kept', async () => {
    vi.stubGlobal('fetch', respond('Named Insured,DOT\nABC Trucking,1234567', { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="info.csv"' }));
    const raw = await parseFile(linkAsFile('https://example.com/info.csv'));
    expect(raw.sourceUrl).toBe('https://example.com/info.csv');
    expect(raw.linkedFile?.name).toBe('info.csv');
    expect(raw.text).toContain('ABC Trucking');
  });

  it('a link that cannot be opened fails clearly — never read as text', async () => {
    vi.stubGlobal('fetch', respond('<html>Sign in to Google</html>', { 'content-type': 'text/html' }));
    await expect(parseFile(file('https://drive.google.com/file/d/abc/view', 'loss runs.txt'))).rejects.toMatchObject({ message: LINK_UNREADABLE_MESSAGE, sourceUrl: 'https://drive.google.com/file/d/abc/view' });
  });
});
