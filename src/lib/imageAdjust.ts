import { loadImage } from './ocr';

export type CropRect = { x: number; y: number; w: number; h: number };

export const applyBrightnessContrast = (imageData: ImageData, brightness: number, contrast: number): void => {
  const { data } = imageData;
  const c = contrast;
  const factor = (259 * (c + 255)) / (255 * (259 - c));
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.min(255, Math.max(0, factor * (data[i] - 128) + 128 + brightness));
    data[i + 1] = Math.min(255, Math.max(0, factor * (data[i + 1] - 128) + 128 + brightness));
    data[i + 2] = Math.min(255, Math.max(0, factor * (data[i + 2] - 128) + 128 + brightness));
  }
};

export const applyImageAdjustments = async (
  dataUrl: string,
  cropRect: CropRect,
  brightness: number,
  contrast: number
): Promise<string> => {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(cropRect.w);
  canvas.height = Math.round(cropRect.h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(
    img,
    Math.round(cropRect.x),
    Math.round(cropRect.y),
    Math.round(cropRect.w),
    Math.round(cropRect.h),
    0,
    0,
    canvas.width,
    canvas.height
  );
  if (brightness !== 0 || contrast !== 0) {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    applyBrightnessContrast(imageData, brightness, contrast);
    ctx.putImageData(imageData, 0, 0);
  }
  return canvas.toDataURL('image/jpeg', 0.92);
};
