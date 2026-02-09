import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { dataClient } from '../lib/data';
import { runOcr, type OcrItem } from '../lib/ocr';

const formatMoney = (value: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);

const clampNumber = (value: number, fallback = 0) => (Number.isFinite(value) ? value : fallback);

type ReviewItem = OcrItem & { include: boolean };

const confidenceLabel = (confidence: number) => {
  if (confidence < 60) {
    return { label: 'Low confidence', className: 'warn' };
  }
  if (confidence < 80) {
    return { label: 'Check', className: 'mid' };
  }
  return { label: 'Good', className: 'good' };
};

export function Scanner() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const viewerScrollRef = useRef({ left: 0, top: 0 });
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageMeta, setImageMeta] = useState<{ width: number; height: number } | null>(null);
  const [ocrItems, setOcrItems] = useState<ReviewItem[]>([]);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'idle' | 'scanning' | 'review' | 'saving'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const currency = 'USD';

  const scannerMode = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('mode') ?? 'scan';
  }, [location.search]);
  const uploadOnly = scannerMode === 'upload';
  const isEditMode = scannerMode === 'edit';
  const canCapture = Boolean(stream && status === 'idle');
  const clampZoom = (value: number) => Math.min(4, Math.max(1, value));
  const applyViewerScroll = () => {
    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }
    viewer.scrollLeft = viewerScrollRef.current.left;
    viewer.scrollTop = viewerScrollRef.current.top;
  };
  const handleViewerClose = () => {
    const viewer = viewerRef.current;
    if (viewer) {
      viewerScrollRef.current = { left: viewer.scrollLeft, top: viewer.scrollTop };
    }
    setViewerOpen(false);
  };
  const total = useMemo(
    () =>
      ocrItems.reduce(
        (sum, item) => (item.include ? sum + (Number(item.total_price) || 0) : sum),
        0
      ),
    [ocrItems]
  );

  useEffect(() => {
    if (viewerOpen) {
      applyViewerScroll();
    }
  }, [viewerOpen]);

  useEffect(() => {
    if (imageDataUrl) {
      setZoom(1);
      viewerScrollRef.current = { left: 0, top: 0 };
    }
  }, [imageDataUrl]);

  useEffect(() => {
    if (uploadOnly || status !== 'idle' || imageDataUrl) {
      return;
    }
    if (isEditMode) {
      setStatus('review');
      return;
    }
    let active = true;
    const initCamera = async () => {
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (!active) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        setStream(media);
        if (videoRef.current) {
          videoRef.current.srcObject = media;
          await videoRef.current.play();
        }
      } catch (err) {
        setError('Camera access blocked. Use file upload instead.');
      }
    };

    initCamera();

    return () => {
      active = false;
    };
  }, [status, imageDataUrl, uploadOnly, isEditMode]);

  useEffect(() => {
    if (!sessionId || status !== 'idle') {
      return;
    }
    if (!uploadOnly) {
      return;
    }
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, [sessionId, status, uploadOnly]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    let active = true;
    const loadSession = async () => {
      try {
        const session = await dataClient.getSession(sessionId);
        if (!active || !session) {
          return;
        }
        setLocked(session.status === 'LOCKED');
      } catch {
        return;
      }
    };

    const loadItems = async () => {
      if (!isEditMode) {
        return;
      }
      try {
        const items = await dataClient.listItems(sessionId);
        if (!active) {
          return;
        }
        const mapped = items
          .filter((item) => !item.is_exploded)
          .map<ReviewItem>((item) => ({
            id: item.id,
            label: item.label,
            quantity: item.quantity,
            unit_price: item.unit_price,
            total_price: item.total_price,
            confidence: 100,
            include: true,
          }));
        setOcrItems(mapped);
      } catch {
        return;
      }
    };

    loadSession();
    loadItems();

    return () => {
      active = false;
    };
  }, [sessionId, isEditMode]);

  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  const handleCapture = async () => {
    if (!videoRef.current || !canvasRef.current) {
      return;
    }
    setError(null);
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
    setImageDataUrl(dataUrl);
    setImageMeta({ width, height });
    await runRecognition(dataUrl);
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result !== 'string') {
        return;
      }
      const dataUrl = reader.result;
      const img = new Image();
      img.onload = async () => {
        setImageMeta({ width: img.width, height: img.height });
        setImageDataUrl(dataUrl);
        await runRecognition(dataUrl);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const runRecognition = async (dataUrl: string) => {
    setStatus('scanning');
    setProgress(0);
    try {
      const items = await runOcr(dataUrl, (next) => setProgress(next));
      setOcrItems(items.map((item) => ({ ...item, include: true })));
      setStatus('review');
    } catch (err) {
      setError('OCR failed. You can still add items manually.');
      setStatus('review');
    }
  };

  const handleReset = () => {
    setStatus('idle');
    setImageDataUrl(null);
    setImageMeta(null);
    setOcrItems([]);
    setProgress(0);
  };

  const updateItem = (id: string, patch: Partial<ReviewItem>) => {
    setOcrItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) {
          return item;
        }
        const next = { ...item, ...patch };
        const quantity = clampNumber(Number(next.quantity), 1);
        const unitPrice = clampNumber(Number(next.unit_price), 0);
        const totalPrice = clampNumber(Number(next.total_price), unitPrice * quantity);
        return {
          ...next,
          quantity,
          unit_price: unitPrice,
          total_price: totalPrice,
        };
      })
    );
  };

  const handleCommit = async () => {
    if (!sessionId) {
      return;
    }
    if (locked) {
      setError('Session is locked. You cannot add new receipts.');
      return;
    }
    setStatus('saving');
    setError(null);
    try {
      if (!isEditMode && imageDataUrl && imageMeta) {
        await dataClient.addReceiptImage(sessionId, {
          dataUrl: imageDataUrl,
          width: imageMeta.width,
          height: imageMeta.height,
        });
      }

      if (!isEditMode) {
        for (const item of ocrItems) {
          if (!item.include || !item.label.trim()) {
            continue;
          }
          await dataClient.addItem(sessionId, {
            label: item.label.trim(),
            quantity: Number(item.quantity) || 1,
            unit_price: Number(item.unit_price) || 0,
            total_price: Number(item.total_price) || 0,
            group_id: null,
          });
        }
      } else {
        const existingItems = await dataClient.listItems(sessionId);
        const existingMap = new Map(existingItems.map((item) => [item.id, item]));
        for (const item of ocrItems) {
          if (!item.include || !item.label.trim()) {
            continue;
          }
          const payload = {
            label: item.label.trim(),
            quantity: Number(item.quantity) || 1,
            unit_price: Number(item.unit_price) || 0,
            total_price: Number(item.total_price) || 0,
          };
          if (existingMap.has(item.id)) {
            await dataClient.updateItem(sessionId, item.id, payload);
          } else {
            await dataClient.addItem(sessionId, { ...payload, group_id: null });
          }
        }
      }
      navigate(`/${sessionId}`);
    } catch (err) {
      setError('Unable to save items.');
      setStatus('review');
    }
  };

  const createBlankItem = (index: number): ReviewItem => ({
    id: `${Date.now()}-${index}`,
    label: '',
    quantity: 1,
    unit_price: 0,
    total_price: 0,
    confidence: 100,
    include: true,
  });

  const handleAddBlank = () => {
    setOcrItems((prev) => [...prev, createBlankItem(prev.length)]);
  };

  const handleAddBetween = (index: number) => {
    setOcrItems((prev) => {
      const next = [...prev];
      next.splice(index, 0, createBlankItem(prev.length));
      return next;
    });
  };

  const moveItem = (from: number, delta: number) => {
    setOcrItems((prev) => {
      const target = from + delta;
      if (target < 0 || target >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(target, 0, moved);
      return next;
    });
  };

  const handleRemove = (id: string) => {
    setOcrItems((prev) => prev.filter((item) => item.id !== id));
  };

  if (!sessionId) {
    return (
      <div className="app-shell">
        <div className="brand">
          <span className="brand-dot" />
          SplitScan
        </div>
        <div className="panel">
          <h2>Missing session</h2>
          <p>Return to the landing page to start a session.</p>
          <Link className="button secondary" to="/">
            Back to landing
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="brand">
        <span className="brand-dot" />
        SplitScan
      </div>

      <section className="panel">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>{isEditMode ? 'Edit Items' : 'Receipt Scanner'}</h2>
            <p className="caption">Session {sessionId}</p>
          </div>
          <Link className="button secondary" to={`/${sessionId}`}>
            Back to workspace
          </Link>
        </div>
      </section>

      {error && <div className="notice">{error}</div>}
      {locked && <div className="notice">This session is locked. Scans can be reviewed but not saved.</div>}

      {status === 'idle' && (
        <section className="panel">
          <h3 className="section-title">{uploadOnly ? 'Upload a receipt' : 'Capture a receipt'}</h3>
          {!uploadOnly && (
            <div className="camera-frame">
              <video ref={videoRef} playsInline muted className="camera-video" />
              {!stream && <div className="camera-overlay">Camera preview unavailable</div>}
            </div>
          )}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
            {!uploadOnly && (
              <button className="button primary" onClick={handleCapture} disabled={!canCapture || locked}>
                Capture
              </button>
            )}
            <label className={`button ${uploadOnly ? 'primary' : 'secondary'}`} style={{ cursor: 'pointer' }}>
              Upload Image
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFile}
                hidden
                disabled={locked}
              />
            </label>
          </div>
          <p className="caption" style={{ marginTop: 12 }}>
            Tip: keep the receipt flat and fill the frame for better OCR.
          </p>
        </section>
      )}

      {status === 'scanning' && (
        <section className="panel">
          <h3 className="section-title">Reading receipt</h3>
          <p className="caption">OCR in progress… {(progress * 100).toFixed(0)}%</p>
          <div className="progress">
            <div className="progress-bar" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </section>
      )}

      {status === 'review' && (
        <section className="panel">
          <div className="review-toolbar">
            <h3 className="section-title">{isEditMode ? 'Edit items' : 'Review parsed items'}</h3>
            <button
              className="button secondary"
              onClick={() => setViewerOpen(true)}
              disabled={!imageDataUrl}
            >
              View original
            </button>
          </div>
          {imageDataUrl && (
            <div className="receipt-preview">
              <img src={imageDataUrl} alt="Receipt preview" />
            </div>
          )}
          <div className="list" style={{ marginTop: 16 }}>
            {ocrItems.length === 0 ? (
              <p className="caption">
                {isEditMode
                  ? 'No items yet. Add manual items here or scan a receipt from the workspace.'
                  : 'No items detected. Add manually or try another photo.'}
              </p>
            ) : (
              ocrItems.map((item, index) => (
                <div key={item.id} className="ocr-item-group">
                  <div className="ocr-item">
                    <div className="ocr-item-body">
                      <label className="sr-only" htmlFor={`ocr-item-label-${item.id}`}>
                        Item label
                      </label>
                      <input
                        id={`ocr-item-label-${item.id}`}
                        className="input"
                        value={item.label}
                        onChange={(event) => updateItem(item.id, { label: event.target.value })}
                      />
                      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                        <span className={`badge ${confidenceLabel(item.confidence).className}`}>
                          {confidenceLabel(item.confidence).label}
                        </span>
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={item.include}
                            onChange={(event) => updateItem(item.id, { include: event.target.checked })}
                          />
                          Include
                        </label>
                      </div>
                      <div className="ocr-fields">
                        <label className="ocr-field">
                          <span className="field-label">Quantity</span>
                          <input
                            className="input"
                            type="number"
                            min={1}
                            step={1}
                            value={item.quantity}
                            onChange={(event) => {
                              const nextQty = Number(event.target.value);
                              updateItem(item.id, {
                                quantity: nextQty,
                                total_price: nextQty * item.unit_price,
                              });
                            }}
                          />
                        </label>
                        <label className="ocr-field">
                          <span className="field-label">Unit price</span>
                          <input
                            className="input"
                            type="number"
                            min={0}
                            step={0.01}
                            value={item.unit_price}
                            onChange={(event) => {
                              const nextUnit = Number(event.target.value);
                              updateItem(item.id, {
                                unit_price: nextUnit,
                                total_price: nextUnit * item.quantity,
                              });
                            }}
                          />
                        </label>
                        <div className="ocr-field ocr-field-total">
                          <span className="field-label">Total</span>
                          <div className="ocr-readout">{formatMoney(item.total_price, currency)}</div>
                        </div>
                      </div>
                    </div>
                    <div className="ocr-item-actions">
                      <div className="ocr-reorder">
                        <button
                          className="ocr-reorder-button"
                          type="button"
                          title="Move item up"
                          aria-label="Move item up"
                          onClick={() => moveItem(index, -1)}
                          disabled={index === 0}
                        >
                          ↑
                        </button>
                        <button
                          className="ocr-reorder-button"
                          type="button"
                          title="Move item down"
                          aria-label="Move item down"
                          onClick={() => moveItem(index, 1)}
                          disabled={index === ocrItems.length - 1}
                        >
                          ↓
                        </button>
                      </div>
                      <button className="button secondary" onClick={() => handleRemove(item.id)}>
                        Remove
                      </button>
                    </div>
                  </div>
                  {index < ocrItems.length - 1 && (
                    <div className="ocr-add-between-row">
                      <button className="ocr-add-between" type="button" onClick={() => handleAddBetween(index + 1)}>
                        + ADD
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
            <span className="caption">Parsed total</span>
            <strong>{formatMoney(total, currency)}</strong>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 20 }}>
            {!isEditMode && (
              <button className="button secondary" onClick={handleReset}>
                Retake
              </button>
            )}
            <button className="button secondary" onClick={handleAddBlank}>
              Add Manual Item
            </button>
            {!isEditMode ? (
              <button className="button primary" onClick={handleCommit} disabled={status === 'saving' || locked}>
                {status === 'saving' ? 'Saving...' : 'Commit to Workspace'}
              </button>
            ) : (
              <button className="button primary" onClick={handleCommit} disabled={status === 'saving' || locked}>
                {status === 'saving' ? 'Saving...' : 'Save changes'}
              </button>
            )}
          </div>
        </section>
      )}

      {viewerOpen && imageDataUrl && (
        <div
          className="receipt-viewer-backdrop"
          role="dialog"
          aria-modal="true"
          style={{ background: 'rgba(15, 12, 10, 0.65)' }}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              handleViewerClose();
            }
          }}
        >
          <div className="receipt-viewer-panel" onClick={(event) => event.stopPropagation()}>
            <div className="receipt-viewer-toolbar">
              <div className="receipt-viewer-title">Original receipt</div>
              <div className="receipt-viewer-actions">
                <button
                  className="button secondary"
                  onClick={() => setZoom((value) => clampZoom(Number((value - 0.25).toFixed(2))))}
                  disabled={zoom <= 1}
                >
                  Zoom out
                </button>
                <button
                  className="button secondary"
                  onClick={() => setZoom((value) => clampZoom(Number((value + 0.25).toFixed(2))))}
                  disabled={zoom >= 4}
                >
                  Zoom in
                </button>
                <button className="button secondary" onClick={() => setZoom(1)} disabled={zoom === 1}>
                  Reset
                </button>
                <button className="button primary" onClick={handleViewerClose}>
                  Close
                </button>
              </div>
            </div>
            <div className="receipt-viewer-canvas" ref={viewerRef}>
              <img
                src={imageDataUrl}
                alt="Receipt full"
                style={{ transform: `scale(${zoom})` }}
                onLoad={applyViewerScroll}
              />
            </div>
          </div>
        </div>
      )}

      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
}
