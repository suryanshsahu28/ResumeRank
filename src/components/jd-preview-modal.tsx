'use client';

import React, { useEffect, useState, useRef } from 'react';
import type * as PdfJs from 'pdfjs-dist';
import { XMarkIcon, ArrowsPointingOutIcon, DownloadIcon } from './icons';

const pdfjsLibPromise = import('pdfjs-dist');
let pdfjsLib: typeof PdfJs | null = null;
let isInitialized = false;

const initializePdfJs = async () => {
  if (!isInitialized) {
    pdfjsLib = await pdfjsLibPromise;
    if (pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@4.3.136/build/pdf.worker.mjs`;
      isInitialized = true;
    }
  }
  return pdfjsLib;
};

interface JDPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  jdFile?: {
    filename: string;
    url: string;
  };
}

interface PdfPreviewProps {
  fileUrl: string;
  onDownload: () => void;
}

// ===== JD PdfPreview (drop-in) =====
const PdfPreview: React.FC<{ fileUrl: string; onDownload?: () => void }> = ({ fileUrl, onDownload }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    let pdfUrl: string | null = null;

    const renderPdf = async () => {
      try {
        const pdfLib = await initializePdfJs();
        if (!fileUrl || !containerRef.current || !pdfLib || !isMounted) return;

        setStatus('loading');
        setError(null);
        const container = containerRef.current;
        container.innerHTML = '';

        // Same proxy hop you use for resumes
        const proxyUrl = `/api/proxy-pdf?url=${encodeURIComponent(fileUrl)}`;
        const response = await fetch(proxyUrl);
        if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
        const pdfBlob = await response.blob();
        pdfUrl = URL.createObjectURL(pdfBlob);

        if (!isMounted) return;

        const loadingTask = pdfLib.getDocument(pdfUrl);
        const pdf = await loadingTask.promise;

        for (let i = 1; i <= pdf.numPages; i++) {
          if (!isMounted) break;
          const page = await pdf.getPage(i);
          const containerWidth = container.clientWidth || 800;
          const viewport = page.getViewport({ scale: 1 });
          const scale = (containerWidth / viewport.width) * 0.98;
          const scaledViewport = page.getViewport({ scale });

          const canvas = document.createElement('canvas');
          canvas.className = 'mb-4 shadow-lg';
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;

          canvas.width = scaledViewport.width;
          canvas.height = scaledViewport.height;
          container.appendChild(canvas);

          await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;
        }

        if (isMounted) setStatus('success');
      } catch (e) {
        if (isMounted) {
          console.error('JD PDF render error:', e);
          setError('Could not display PDF preview. The file may be corrupted or unsupported.');
          setStatus('error');
        }
      }
    };

    renderPdf();
    return () => {
      isMounted = false;
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [fileUrl]);

  return (
    <div className="w-full h-full bg-slate-300 overflow-y-auto">
      {status === 'loading' && (
        <div className="flex items-center justify-center h-full text-slate-600">
          <p>Loading JD PDF preview...</p>
        </div>
      )}

      {status === 'error' && (
        <div className="bg-white w-full h-full flex flex-col items-center justify-center p-6 text-center text-slate-700">
          <h3 className="text-xl font-semibold mb-2">JD PDF Preview Failed</h3>
          <p className="max-w-md">{error}</p>
          {onDownload && (
            <button
              onClick={onDownload}
              className="mt-6 inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              <DownloadIcon />
              <span>Download JD</span>
            </button>
          )}
        </div>
      )}

      {onDownload && (
        <div className="absolute top-2 right-14 z-10">
          <button
            onClick={onDownload}
            className="inline-flex items-center gap-2 rounded-md bg-slate-800/50 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-700"
            title="Download JD"
          >
            <DownloadIcon />
          </button>
        </div>
      )}

      <div
        ref={containerRef}
        className="p-2 sm:p-4 md:p-6 flex flex-col items-center"
        style={{ visibility: status === 'success' ? 'visible' : 'hidden' }}
      />
    </div>
  );
};


export function JDPreviewModal({ isOpen, onClose, jdFile }: JDPreviewModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Handle keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isOpen]);

  // Prevent background scrolling when modal is open
  useEffect(() => {
    if (!isOpen) return;
    
    const scrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
    
    return () => {
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      document.body.style.overflow = '';
      window.scrollTo(0, scrollY);
    };
  }, [isOpen]);

  // Early return after all hooks
  if (!jdFile) {
    return null;
  }

  const handleFullscreen = () => {
    if (modalRef.current) {
      if (!document.fullscreenElement) modalRef.current.requestFullscreen();
      else document.exitFullscreen();
    }
  };
  
  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = jdFile.url;
    link.download = jdFile.filename;
    link.target = '_blank';
    link.click();
  };

  if (!isOpen) {
    return null;
  }

  const isPdf = jdFile.filename.toLowerCase().endsWith('.pdf');
  return (
    <div ref={modalRef} className="fixed inset-0 bg-black/75 z-50 flex flex-col p-4" role="dialog" aria-modal="true">
      <header className="flex-shrink-0 flex items-center justify-between text-white p-2 bg-slate-800/50 rounded-t-lg">
        <h2 className="text-lg font-semibold truncate">
          Job Description Preview
        </h2>
        <div className="flex items-center gap-4">
          <button onClick={handleFullscreen} className="text-slate-300 hover:text-white" title="Toggle Fullscreen">
            <ArrowsPointingOutIcon />
          </button>
          <button onClick={onClose} className="text-slate-300 hover:text-white" title="Close (Esc)">
            <XMarkIcon />
          </button>
        </div>
      </header>

      <main className="flex-grow bg-slate-200 flex items-center justify-center overflow-hidden relative">
        {isPdf ? (
          <PdfPreview fileUrl={jdFile.url} onDownload={handleDownload} />
        ) : (
          <div className="flex items-center justify-center h-full text-slate-600 p-8 text-center">
            <div>
              <h3 className="text-xl font-semibold mb-2">Preview Not Available</h3>
              <p className="mb-4">This file type cannot be previewed directly.</p>
              <button
                onClick={handleDownload}
                className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
              >
                <DownloadIcon />
                <span>Download Original File</span>
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
