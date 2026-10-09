/**
 * Deklarasi tipe untuk `pdf-parse` (tidak menyediakan tipe sendiri).
 *
 * CATATAN PENTING: kode mengimpor `pdf-parse/lib/pdf-parse.js` — BUKAN `pdf-parse`
 * — karena `index.js` paket itu menjalankan KODE TES internal yang error di
 * serverless (ENOENT test/data/05-versions-space.pdf).
 */
declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    text?: string;
    numpages?: number;
    numrender?: number;
    info?: Record<string, unknown>;
    metadata?: unknown;
    version?: string;
  }
  function pdfParse(dataBuffer: Buffer, options?: Record<string, unknown>): Promise<PdfParseResult>;
  export default pdfParse;
}
