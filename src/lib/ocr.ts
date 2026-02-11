export type OcrLine = {
  text: string;
  confidence: number;
};

export type OcrItem = {
  id: string;
  label: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  confidence: number;
};

// Matches summary/payment/non-item lines.
// Anchored patterns (^) protect product names like "Total Cereal".
const SKIP_PATTERNS = [
  /\b(sub[\s\-]*total|grand[\s\-]*total|net[\s\-]*total)\b/i,
  /\btotal\s*:?\s*$/i,          // "Total", "Total:", "Food Total", "Order Total" at end
  /^total\b/i,                   // "Total 466.57" at start
  /\btax(es)?\b/i,
  /^tip\b/i,
  /\b(balance|amount)\s*(due|owed|forward|tendered)?\s*$/i,
  /^change\s*(due)?\s*$/i,
  /^(cash|credit|debit|visa|mastercard|amex|discover)\s*(tend|payment|paid)?\s*$/i,
  /^(thank|gratuity|surcharge|service\s*(fee|charge)|convenience)/i,
  /\b(discount|savings|you\s*saved|coupon)\b/i,
  /^(payment|tendered|received)\b/i,
  /^(void|comp(ed)?|refund(ed)?)\b/i,
  /^(check|table|server|guest|order)\s*[:#]?\s*\d*\s*$/i,
  /^(date|time|store|tel|phone|fax|www\.|http)/i,
  /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\s*$/,  // bare dates
  /^\d{1,2}:\d{2}\s*(am|pm)?\s*$/i,            // bare times
  /^\*{2,}/,
  /^[-=]{3,}/,
  /^[_]{3,}/,
  /^\.{3,}/,
];

// Matches prices: $12.99, 12.99, 12,99, $ 12.99
const priceRegex = /(?:\$\s?)?(\d{1,6}[\.,]\d{2})\b/g;

const normalizePrice = (raw: string) => Number(raw.replace(/,/g, '.'));

const shouldSkipLine = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return SKIP_PATTERNS.some((pattern) => pattern.test(trimmed));
};

/** Normalize common receipt formatting before parsing. */
const normalizeLine = (text: string): string =>
  text
    .replace(/\t/g, '  ')              // tabs → spaces
    .replace(/\.{3,}/g, '  ')          // dot leaders → spaces
    .replace(/_{3,}/g, '  ')           // underscores → spaces
    .replace(/-{3,}/g, '  ')           // dash runs → spaces
    .trim();

const parseQuantity = (text: string): { qty: number; rest: string } => {
  // "2 x Burger", "2x Burger", "2X Burger"
  const qtyX = text.match(/^(\d+)\s*[xX×]\s+(.+)/);
  if (qtyX) return { qty: Number(qtyX[1]), rest: qtyX[2] };
  // "2 @ 4.99 Burger" or "2 @ $4.99 Burger"
  const atMatch = text.match(/^(\d+)\s*@\s*\$?[\d.,]+\s*(.*)/);
  if (atMatch) return { qty: Number(atMatch[1]), rest: atMatch[2] };
  // "1.5 lb @ 4.99/lb  7.49" — weight-based
  const weightMatch = text.match(/^([\d.]+)\s*(lb|kg|oz)\s*@\s*\$?[\d.,]+\s*\/\s*\w+\s*(.*)/i);
  if (weightMatch) return { qty: Number(weightMatch[1]), rest: weightMatch[3] || weightMatch[0] };
  // "Qty 2 Burger" or "QTY: 2 Burger"
  const qtyWord = text.match(/^qty[:\s]*(\d+)\s*(.*)/i);
  if (qtyWord) return { qty: Number(qtyWord[1]), rest: qtyWord[2] };
  // "Burger x2" or "Burger × 3" at end of line
  const trailingX = text.match(/^(.+?)\s*[xX×]\s*(\d+)\s*$/);
  if (trailingX) return { qty: Number(trailingX[2]), rest: trailingX[1] };
  // "2 BEER (8.50) 17.00" — leading number (1-2 digits) followed by a word
  const leadingNum = text.match(/^(\d{1,2})\s+([a-zA-Z].+)/);
  if (leadingNum && Number(leadingNum[1]) > 0) {
    return { qty: Number(leadingNum[1]), rest: leadingNum[2] };
  }
  return { qty: 1, rest: text };
};

const cleanLabel = (text: string): string =>
  text
    .replace(priceRegex, '')            // strip prices
    .replace(/\$\s*/g, '')             // stray dollar signs
    .replace(/\(\s*\)/g, '')           // empty parentheses left after price removal
    .replace(/^#\d+\s*/g, '')          // item codes: #4521
    .replace(/^\s*[-–—.•*+]+\s*/, '')  // leading bullets/dashes/dots/plus signs
    .replace(/\s*[-–—.•*]+\s*$/, '')   // trailing artifacts
    .replace(/\s{2,}/g, ' ')          // collapse whitespace
    .trim();

export const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });

/** Convert to grayscale, boost contrast, and apply an unsharp-mask sharpen. */
const preprocessImage = (img: HTMLImageElement): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;

  // Draw original
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;

  // --- Grayscale + contrast stretch ---
  let min = 255;
  let max = 0;
  // First pass: find luminance range
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (gray < min) min = gray;
    if (gray > max) max = gray;
  }
  const range = max - min || 1;
  // Second pass: grayscale + stretch contrast to full 0-255
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const stretched = ((gray - min) / range) * 255;
    data[i] = data[i + 1] = data[i + 2] = stretched;
  }

  // --- Unsharp mask (sharpen) ---
  // Blur a copy, then blend: sharpened = original + amount * (original - blurred)
  const blurred = new Uint8ClampedArray(data);
  const w = canvas.width;
  const h = canvas.height;
  // Simple 3x3 box blur on the gray channel (R = G = B at this point)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          sum += data[((y + dy) * w + (x + dx)) * 4];
        }
      }
      const idx = (y * w + x) * 4;
      const avg = sum / 9;
      blurred[idx] = blurred[idx + 1] = blurred[idx + 2] = avg;
    }
  }
  const amount = 1.5;
  for (let i = 0; i < data.length; i += 4) {
    const sharp = Math.min(255, Math.max(0, data[i] + amount * (data[i] - blurred[i])));
    data[i] = data[i + 1] = data[i + 2] = sharp;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
};


export const parseOcrLines = (lines: OcrLine[]): OcrItem[] => {
  const items: OcrItem[] = [];
  // Pending label from a previous line that had no price
  let pendingLabel: { text: string; confidence: number } | null = null;

  for (let index = 0; index < lines.length; index++) {
    const text = normalizeLine(lines[index].text);
    const confidence = lines[index].confidence;

    if (!text) {
      pendingLabel = null;
      continue;
    }
    if (shouldSkipLine(text)) {
      pendingLabel = null;
      continue;
    }

    const prices = [...text.matchAll(priceRegex)].map((m) => m[1]);
    const hasPrice = prices.length > 0;

    // Line has no price — hold it as a pending label for the next line
    if (!hasPrice) {
      const cleaned = cleanLabel(text);
      if (cleaned && /[a-zA-Z]/.test(cleaned)) {
        pendingLabel = { text: cleaned, confidence };
      }
      continue;
    }

    // Line has a price — parse it
    const lastPrice = prices[prices.length - 1];
    const totalPrice = normalizePrice(lastPrice);
    if (Number.isNaN(totalPrice)) {
      pendingLabel = null;
      continue;
    }

    const { qty, rest } = parseQuantity(text);
    let label = cleanLabel(rest);

    // If label is empty or just numbers, try merging with pending label
    if ((!label || !/[a-zA-Z]/.test(label)) && pendingLabel) {
      label = pendingLabel.text;
    } else if (label && pendingLabel) {
      // Both have text — prefer the current line's label, discard pending
    }

    pendingLabel = null;

    if (!label || !/[a-zA-Z]/.test(label)) {
      continue;
    }

    // Determine unit price: check for parenthesized price (unit) vs bare price (total)
    let unitPrice = qty > 0 ? Number((totalPrice / qty).toFixed(2)) : totalPrice;

    if (prices.length > 1 && qty > 1) {
      // Look for a parenthesized price as explicit unit price
      const parenPrice = text.match(/\(\s*\$?\s*(\d{1,6}[\.,]\d{2})\s*\)/);
      if (parenPrice) {
        const candidate = normalizePrice(parenPrice[1]);
        if (!Number.isNaN(candidate) && candidate > 0) {
          unitPrice = candidate;
        }
      } else {
        // Fall back: second-to-last price as unit price
        const secondLastPrice = prices[prices.length - 2];
        const candidate = normalizePrice(secondLastPrice);
        if (!Number.isNaN(candidate) && candidate > 0) {
          unitPrice = candidate;
        }
      }
    }

    items.push({
      id: `${Date.now()}-${index}`,
      label,
      quantity: qty,
      unit_price: unitPrice,
      total_price: totalPrice,
      confidence,
    });
  }

  return items;
};

/**
 * Smart receipt text parser for pasted text. Handles multiple formats:
 * 1. Normal: "Item Name  12.99" per line
 * 2. Column-split: all labels first, then all prices (common with text selection)
 * 3. Mixed: some lines have both, some are orphaned
 */
export const parseReceiptText = (rawText: string): OcrItem[] => {
  const allLines = rawText.split('\n').map((l) => normalizeLine(l)).filter(Boolean);
  if (allLines.length === 0) return [];

  // --- Try 1: normal line-by-line parsing ---
  const normalResult = parseOcrLines(
    allLines.map((l) => ({ text: l, confidence: 100 }))
  );

  // --- Classify every line ---
  const priceOnlyRegex = /^\(?[\$]?\s?\d{1,6}[\.,]\d{2}\)?\s*$/;
  const labels: string[] = [];
  const prices: number[] = [];

  for (const line of allLines) {
    if (shouldSkipLine(line)) continue;

    if (priceOnlyRegex.test(line)) {
      const match = line.match(/(\d{1,6}[\.,]\d{2})/);
      if (match) prices.push(normalizePrice(match[1]));
    } else if (/[a-zA-Z]/.test(line)) {
      labels.push(line);
    }
  }

  // If normal parsing already found a good portion of items, use it
  if (normalResult.length >= Math.max(1, labels.length * 0.4)) {
    return normalResult;
  }

  // --- Try 2: zip labels with prices (column-split pattern) ---
  if (labels.length > 0 && prices.length > 0) {
    const count = Math.min(labels.length, prices.length);
    const zipped: OcrItem[] = [];
    for (let i = 0; i < count; i++) {
      const { qty, rest } = parseQuantity(labels[i]);
      const label = cleanLabel(rest);
      if (!label || !/[a-zA-Z]/.test(label)) continue;

      const totalPrice = prices[i];
      const unitPrice = qty > 0 ? Number((totalPrice / qty).toFixed(2)) : totalPrice;

      zipped.push({
        id: `${Date.now()}-${i}`,
        label,
        quantity: qty,
        unit_price: unitPrice,
        total_price: totalPrice,
        confidence: 100,
      });
    }

    if (zipped.length > normalResult.length) {
      return zipped;
    }
  }

  return normalResult;
};

export const runOcr = async (
  imageDataUrl: string,
  onProgress?: (progress: number) => void
): Promise<OcrItem[]> => {
  const { createWorker } = await import('tesseract.js');

  const img = await loadImage(imageDataUrl);
  const canvas = preprocessImage(img);

  const worker = await createWorker('eng', undefined, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') {
        onProgress?.(m.progress);
      }
    },
  });

  const result = await worker.recognize(canvas);
  await worker.terminate();

  const lines: OcrLine[] = result.data.lines.map(
    (line: { text: string; confidence: number }) => ({
      text: line.text,
      confidence: line.confidence,
    })
  );

  onProgress?.(1);

  return parseOcrLines(lines);
};
