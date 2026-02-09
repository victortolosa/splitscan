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

const STOPWORDS = ['subtotal', 'total', 'tax', 'tip', 'balance', 'change', 'cash', 'card'];

const priceRegex = /(?:\$)?(\d+[\.,]\d{2})/g;

const normalizePrice = (raw: string) => Number(raw.replace(/,/g, ''));

const shouldSkipLine = (text: string) => {
  const lower = text.toLowerCase();
  return STOPWORDS.some((word) => lower.includes(word));
};

const parseQuantity = (text: string) => {
  const qtyMatch = text.match(/^(\d+)\s*[xX]\s+/);
  if (qtyMatch) {
    return Number(qtyMatch[1]);
  }
  const atMatch = text.match(/(\d+)\s*@/);
  if (atMatch) {
    return Number(atMatch[1]);
  }
  const qtyWordMatch = text.match(/qty\s*(\d+)/i);
  if (qtyWordMatch) {
    return Number(qtyWordMatch[1]);
  }
  return 1;
};

let tesseractImport: Promise<typeof import('tesseract.js')> | null = null;

const getTesseract = async () => {
  if (!tesseractImport) {
    tesseractImport = import('tesseract.js');
  }
  return tesseractImport;
};

export const parseOcrLines = (lines: OcrLine[]): OcrItem[] => {
  const items: OcrItem[] = [];
  lines.forEach((line, index) => {
    const text = line.text.trim();
    if (!text || shouldSkipLine(text)) {
      return;
    }
    const prices = [...text.matchAll(priceRegex)].map((match) => match[1]);
    if (prices.length === 0) {
      return;
    }
    const lastPrice = prices[prices.length - 1];
    const secondLastPrice = prices.length > 1 ? prices[prices.length - 2] : null;
    const totalPrice = normalizePrice(lastPrice);
    if (Number.isNaN(totalPrice)) {
      return;
    }
    const quantity = parseQuantity(text);
    const label = text
      .replace(priceRegex, '')
      .replace(/^\s*\d+\s*[xX]\s+/, '')
      .replace(/^\s*\d+\s*@\s*/, '')
      .replace(/\bqty\s*\d+/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    let unitPrice = quantity > 0 ? Number((totalPrice / quantity).toFixed(2)) : totalPrice;

    if (secondLastPrice && quantity > 1) {
      const candidate = normalizePrice(secondLastPrice);
      if (!Number.isNaN(candidate)) {
        unitPrice = candidate;
      }
    }

    if (!label) {
      return;
    }

    items.push({
      id: `${Date.now()}-${index}`,
      label,
      quantity,
      unit_price: unitPrice,
      total_price: totalPrice,
      confidence: line.confidence,
    });
  });

  return items;
};

export const runOcr = async (
  imageDataUrl: string,
  onProgress?: (progress: number) => void
): Promise<OcrItem[]> => {
  const { default: Tesseract } = await getTesseract();
  const result = await Tesseract.recognize(imageDataUrl, 'eng', {
    logger: (message) => {
      if (message.status === 'recognizing text' && typeof message.progress === 'number') {
        onProgress?.(message.progress);
      }
    },
  });

  const lines = (result.data.lines ?? []).map((line) => ({
    text: line.text,
    confidence: line.confidence ?? 0,
  }));

  return parseOcrLines(lines);
};
