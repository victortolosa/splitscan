import { useEffect, useRef, useState, useCallback } from 'react';
import type { CropRect } from '../lib/imageAdjust';
import { applyBrightnessContrast } from '../lib/imageAdjust';

type Props = {
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  brightness: number;
  contrast: number;
  cropRect: CropRect;
  onBrightnessChange: (value: number) => void;
  onContrastChange: (value: number) => void;
  onCropChange: (rect: CropRect) => void;
  onConfirm: () => void;
  onRetake: () => void;
};

type DragMode = { type: 'corner'; index: number } | { type: 'move' } | null;

const HANDLE_RADIUS = 12;
const HANDLE_HIT = 24;
const MIN_CROP = 50;
const MAX_CANVAS_HEIGHT = 500;
const MAX_CANVAS_HEIGHT_MOBILE = 380;

export function ImageAdjuster({
  imageDataUrl,
  imageWidth,
  imageHeight,
  brightness,
  contrast,
  cropRect,
  onBrightnessChange,
  onContrastChange,
  onCropChange,
  onConfirm,
  onRetake,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLImageElement | null>(null);
  const [sourceLoaded, setSourceLoaded] = useState(false);
  const dragRef = useRef<DragMode>(null);
  const dragStartRef = useRef<{ px: number; py: number; crop: CropRect }>({
    px: 0,
    py: 0,
    crop: cropRect,
  });

  // Load source image and trigger re-render when ready
  useEffect(() => {
    setSourceLoaded(false);
    const img = new Image();
    img.onload = () => {
      sourceRef.current = img;
      setSourceLoaded(true);
    };
    img.src = imageDataUrl;
  }, [imageDataUrl]);

  // Compute display dimensions that fit within the container, respecting max height
  const getDisplayDimensions = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return { displayWidth: 300, displayHeight: 200 };
    const containerWidth = wrap.clientWidth;
    const maxH = window.innerWidth <= 900 ? MAX_CANVAS_HEIGHT_MOBILE : MAX_CANVAS_HEIGHT;
    const aspect = imageHeight / imageWidth;
    let displayWidth = containerWidth;
    let displayHeight = Math.round(containerWidth * aspect);
    if (displayHeight > maxH) {
      displayHeight = maxH;
      displayWidth = Math.round(maxH / aspect);
    }
    return { displayWidth, displayHeight };
  }, [imageWidth, imageHeight]);

  const getDisplayScale = useCallback(() => {
    const { displayWidth } = getDisplayDimensions();
    return displayWidth / imageWidth;
  }, [imageWidth, getDisplayDimensions]);

  // Redraw canvas on any prop change (including sourceLoaded)
  useEffect(() => {
    const canvas = canvasRef.current;
    const source = sourceRef.current;
    if (!canvas || !source || !sourceLoaded) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { displayWidth, displayHeight } = getDisplayDimensions();

    canvas.width = Math.round(displayWidth * dpr);
    canvas.height = Math.round(displayHeight * dpr);
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;

    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    // Draw full image scaled to display
    ctx.drawImage(source, 0, 0, displayWidth, displayHeight);

    // Apply brightness/contrast preview
    if (brightness !== 0 || contrast !== 0) {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      applyBrightnessContrast(imgData, brightness, contrast);
      ctx.putImageData(imgData, 0, 0);
      // putImageData works in pixel space, need to re-apply scale for overlay drawing
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Crop overlay
    const scale = displayWidth / imageWidth;
    const cx = cropRect.x * scale;
    const cy = cropRect.y * scale;
    const cw = cropRect.w * scale;
    const ch = cropRect.h * scale;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    // Top
    ctx.fillRect(0, 0, displayWidth, cy);
    // Bottom
    ctx.fillRect(0, cy + ch, displayWidth, displayHeight - cy - ch);
    // Left
    ctx.fillRect(0, cy, cx, ch);
    // Right
    ctx.fillRect(cx + cw, cy, displayWidth - cx - cw, ch);

    // Crop border
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(cx, cy, cw, ch);

    // Corner handles
    const corners = [
      [cx, cy],
      [cx + cw, cy],
      [cx, cy + ch],
      [cx + cw, cy + ch],
    ];
    const handleSize = Math.max(6, HANDLE_RADIUS * scale);
    ctx.fillStyle = '#fff';
    for (const [hx, hy] of corners) {
      ctx.beginPath();
      ctx.arc(hx, hy, handleSize * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(47, 93, 80, 0.8)';
    for (const [hx, hy] of corners) {
      ctx.beginPath();
      ctx.arc(hx, hy, handleSize, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [sourceLoaded, imageWidth, imageHeight, brightness, contrast, cropRect, getDisplayDimensions]);

  const getImageCoords = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { ix: 0, iy: 0, dx: 0, dy: 0 };
      const rect = canvas.getBoundingClientRect();
      const dx = e.clientX - rect.left;
      const dy = e.clientY - rect.top;
      const scale = getDisplayScale();
      return { ix: dx / scale, iy: dy / scale, dx, dy };
    },
    [getDisplayScale]
  );

  const hitTestCorner = useCallback(
    (dx: number, dy: number): number => {
      const scale = getDisplayScale();
      const corners = [
        [cropRect.x * scale, cropRect.y * scale],
        [(cropRect.x + cropRect.w) * scale, cropRect.y * scale],
        [cropRect.x * scale, (cropRect.y + cropRect.h) * scale],
        [(cropRect.x + cropRect.w) * scale, (cropRect.y + cropRect.h) * scale],
      ];
      for (let i = 0; i < corners.length; i++) {
        const dist = Math.hypot(dx - corners[i][0], dy - corners[i][1]);
        if (dist <= HANDLE_HIT) return i;
      }
      return -1;
    },
    [cropRect, getDisplayScale]
  );

  const hitTestBody = useCallback(
    (ix: number, iy: number): boolean => {
      return (
        ix >= cropRect.x &&
        ix <= cropRect.x + cropRect.w &&
        iy >= cropRect.y &&
        iy <= cropRect.y + cropRect.h
      );
    },
    [cropRect]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const { ix, iy, dx, dy } = getImageCoords(e);
      const cornerIdx = hitTestCorner(dx, dy);
      if (cornerIdx >= 0) {
        dragRef.current = { type: 'corner', index: cornerIdx };
      } else if (hitTestBody(ix, iy)) {
        dragRef.current = { type: 'move' };
      } else {
        return;
      }
      dragStartRef.current = { px: ix, py: iy, crop: { ...cropRect } };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [cropRect, getImageCoords, hitTestCorner, hitTestBody]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const mode = dragRef.current;
      if (!mode) return;
      const { ix, iy } = getImageCoords(e);
      const { px, py, crop } = dragStartRef.current;
      const deltaX = ix - px;
      const deltaY = iy - py;

      if (mode.type === 'move') {
        let nx = crop.x + deltaX;
        let ny = crop.y + deltaY;
        nx = Math.max(0, Math.min(nx, imageWidth - crop.w));
        ny = Math.max(0, Math.min(ny, imageHeight - crop.h));
        onCropChange({ x: nx, y: ny, w: crop.w, h: crop.h });
      } else if (mode.type === 'corner') {
        let { x, y, w, h } = crop;
        const idx = mode.index;
        // corners: 0=TL, 1=TR, 2=BL, 3=BR
        if (idx === 0) {
          x = crop.x + deltaX;
          y = crop.y + deltaY;
          w = crop.w - deltaX;
          h = crop.h - deltaY;
        } else if (idx === 1) {
          y = crop.y + deltaY;
          w = crop.w + deltaX;
          h = crop.h - deltaY;
        } else if (idx === 2) {
          x = crop.x + deltaX;
          w = crop.w - deltaX;
          h = crop.h + deltaY;
        } else {
          w = crop.w + deltaX;
          h = crop.h + deltaY;
        }
        // Enforce minimum size
        if (w < MIN_CROP) {
          if (idx === 0 || idx === 2) x = crop.x + crop.w - MIN_CROP;
          w = MIN_CROP;
        }
        if (h < MIN_CROP) {
          if (idx === 0 || idx === 1) y = crop.y + crop.h - MIN_CROP;
          h = MIN_CROP;
        }
        // Clamp to image bounds
        x = Math.max(0, x);
        y = Math.max(0, y);
        if (x + w > imageWidth) w = imageWidth - x;
        if (y + h > imageHeight) h = imageHeight - y;
        onCropChange({ x, y, w, h });
      }
    },
    [getImageCoords, imageWidth, imageHeight, onCropChange]
  );

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  return (
    <div className="adjust-panel">
      <h3 className="section-title">Adjust image</h3>
      <p className="caption">Crop the receipt and adjust brightness/contrast for better results.</p>
      <div className="adjust-canvas-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      </div>
      <div className="adjust-controls">
        <div className="adjust-slider-group">
          <div className="adjust-slider-header">
            <span className="field-label">Brightness</span>
            <span className="adjust-slider-value">{brightness}</span>
            {brightness !== 0 && (
              <button
                className="adjust-slider-reset"
                type="button"
                onClick={() => onBrightnessChange(0)}
              >
                Reset
              </button>
            )}
          </div>
          <input
            className="adjust-slider"
            type="range"
            min={-100}
            max={100}
            value={brightness}
            onChange={(e) => onBrightnessChange(Number(e.target.value))}
          />
        </div>
        <div className="adjust-slider-group">
          <div className="adjust-slider-header">
            <span className="field-label">Contrast</span>
            <span className="adjust-slider-value">{contrast}</span>
            {contrast !== 0 && (
              <button
                className="adjust-slider-reset"
                type="button"
                onClick={() => onContrastChange(0)}
              >
                Reset
              </button>
            )}
          </div>
          <input
            className="adjust-slider"
            type="range"
            min={-100}
            max={100}
            value={contrast}
            onChange={(e) => onContrastChange(Number(e.target.value))}
          />
        </div>
      </div>
      <div className="adjust-actions">
        <button className="button secondary" onClick={onRetake}>
          Retake
        </button>
        <button className="button primary" onClick={onConfirm}>
          Scan
        </button>
      </div>
    </div>
  );
}
