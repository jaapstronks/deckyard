import { getPuppeteerBrowser } from '../utils/puppeteer-browser.js';

/**
 * Convert a PDF file (as a data URL or buffer) to an array of PNG image buffers.
 * Uses puppeteer to render each page at high resolution.
 *
 * @param {object} options
 * @param {string} [options.dataUrl] - PDF as a data URL (data:application/pdf;base64,...)
 * @param {Buffer} [options.buffer] - PDF as a buffer (alternative to dataUrl)
 * @param {number} [options.width=1920] - Render width in pixels
 * @param {number} [options.height=1080] - Render height in pixels
 * @param {function} [options.onProgress] - Callback for progress updates: (page, totalPages) => void
 * @returns {Promise<Array<{page: number, buffer: Buffer}>>} Array of page images
 */
export async function pdfToImages({
  dataUrl,
  buffer,
  width = 1920,
  height = 1080,
  onProgress,
} = {}) {
  // Convert buffer to data URL if provided
  let pdfDataUrl = dataUrl;
  if (!pdfDataUrl && buffer) {
    const base64 = buffer.toString('base64');
    pdfDataUrl = `data:application/pdf;base64,${base64}`;
  }

  if (!pdfDataUrl) {
    throw new Error('Either dataUrl or buffer is required');
  }

  // Validate it's a PDF data URL
  if (!pdfDataUrl.startsWith('data:application/pdf')) {
    throw new Error('Invalid PDF data URL');
  }

  const browser = await getPuppeteerBrowser({ featureName: 'PDF Import' });
  const results = [];

  try {
    // First, get the page count by opening the PDF and checking
    const page = await browser.newPage();

    // Set a reasonable viewport
    await page.setViewport({ width, height, deviceScaleFactor: 1 });

    // Navigate to the PDF data URL
    // Puppeteer's built-in PDF viewer will render it
    await page.goto(pdfDataUrl, { waitUntil: 'networkidle0', timeout: 60000 });

    // Get the total number of pages from the PDF viewer
    // The Chrome PDF viewer exposes page count in the toolbar
    const pageCount = await page.evaluate(() => {
      // Try to get page count from the PDF viewer
      const toolbar = document.querySelector('#toolbar');
      if (toolbar) {
        const pageCountEl = toolbar.querySelector('#numPages');
        if (pageCountEl) {
          // Format is typically "/ 5" or similar
          const text = pageCountEl.textContent || '';
          const match = text.match(/\/?\s*(\d+)/);
          if (match) return parseInt(match[1], 10);
        }
      }
      // Fallback: try to find it in the document
      const viewerContainer = document.querySelector('#viewerContainer');
      if (viewerContainer) {
        const pages = viewerContainer.querySelectorAll('.page');
        if (pages.length > 0) return pages.length;
      }
      return 1;
    });

    await page.close();

    // Now render each page using pdf.js approach
    // We'll create a page that uses pdf.js to render each PDF page to canvas
    const renderPage = await browser.newPage();
    await renderPage.setViewport({ width, height, deviceScaleFactor: 1 });

    // Create an HTML page that uses pdf.js to render PDF pages
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: white; }
    #canvas { display: block; }
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
</head>
<body>
  <canvas id="canvas"></canvas>
  <script>
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    window.renderPdfPage = async function(dataUrl, pageNum, targetWidth, targetHeight) {
      const base64 = dataUrl.split(',')[1];
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      const page = await pdf.getPage(pageNum);

      // Calculate scale to fit the target dimensions while maintaining aspect ratio
      const viewport = page.getViewport({ scale: 1 });
      const scaleX = targetWidth / viewport.width;
      const scaleY = targetHeight / viewport.height;
      const scale = Math.min(scaleX, scaleY);

      const scaledViewport = page.getViewport({ scale });

      const canvas = document.getElementById('canvas');
      const context = canvas.getContext('2d');

      // Set canvas to target dimensions and center the content
      canvas.width = targetWidth;
      canvas.height = targetHeight;

      // Fill with white background
      context.fillStyle = 'white';
      context.fillRect(0, 0, targetWidth, targetHeight);

      // Center the PDF page on the canvas
      const offsetX = (targetWidth - scaledViewport.width) / 2;
      const offsetY = (targetHeight - scaledViewport.height) / 2;

      context.translate(offsetX, offsetY);

      await page.render({
        canvasContext: context,
        viewport: scaledViewport,
      }).promise;

      return pdf.numPages;
    };

    window.getPageCount = async function(dataUrl) {
      const base64 = dataUrl.split(',')[1];
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      return pdf.numPages;
    };
  </script>
</body>
</html>
    `;

    await renderPage.setContent(htmlContent, { waitUntil: 'networkidle0' });

    // Get the actual page count using pdf.js
    const totalPages = await renderPage.evaluate(
      async (pdfData) => {
        return await window.getPageCount(pdfData);
      },
      pdfDataUrl
    );

    // Render each page
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      if (onProgress) {
        onProgress(pageNum, totalPages);
      }

      // Render the page
      await renderPage.evaluate(
        async (pdfData, num, w, h) => {
          await window.renderPdfPage(pdfData, num, w, h);
        },
        pdfDataUrl,
        pageNum,
        width,
        height
      );

      // Take screenshot of the canvas
      const canvas = await renderPage.$('#canvas');
      const imageBuffer = await canvas.screenshot({
        type: 'png',
        omitBackground: false,
      });

      results.push({
        page: pageNum,
        buffer: imageBuffer,
      });
    }

    await renderPage.close();
  } catch (err) {
    // Re-throw with more context
    const error = new Error(`Failed to convert PDF to images: ${err.message}`);
    error.cause = err;
    throw error;
  }

  return results;
}