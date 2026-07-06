import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface ImageAttachmentsProps {
  images: string[];
  downloadBaseName?: string;
}

export function ImageAttachments({ images, downloadBaseName }: ImageAttachmentsProps) {
  const [zoomedSrc, setZoomedSrc] = useState<string | null>(null);

  if (images.length === 0) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {images.map((src, index) => (
          <ImageCard
            key={index}
            src={src}
            downloadName={downloadName(downloadBaseName, index)}
            onZoom={() => setZoomedSrc(src)}
          />
        ))}
      </div>
      {zoomedSrc ? <Lightbox src={zoomedSrc} onClose={() => setZoomedSrc(null)} /> : null}
    </>
  );
}

interface ImageCardProps {
  src: string;
  downloadName: string;
  onZoom: () => void;
}

function ImageCard({ src, downloadName, onZoom }: ImageCardProps) {
  const handleDownloadClick = (event: React.MouseEvent): void => {
    event.stopPropagation();
  };

  return (
    <div
      className="transcript-image-frame relative group/img bg-background overflow-hidden"
      style={{ borderRadius: "var(--radius-md)" }}
    >
      <img
        src={src}
        onClick={onZoom}
        alt="attachment"
        className="transcript-image max-w-full object-contain cursor-zoom-in block"
      />
      <a
        href={src}
        download={downloadName}
        onClick={handleDownloadClick}
        aria-label="Download image"
        className="absolute top-2 right-2 w-7 h-7 inline-flex items-center justify-center rounded-md bg-popover/90 text-muted-foreground hover:text-foreground opacity-0 group-hover/img:opacity-100 transition-opacity"
      >
        <DownloadIcon />
      </a>
    </div>
  );
}

interface LightboxProps {
  src: string;
  onClose: () => void;
}

function Lightbox({ src, onClose }: LightboxProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Portal to <body> so the overlay escapes the transcript's masked scroll
  // container — a `mask-image` ancestor becomes the containing block for
  // `position: fixed`, which would otherwise trap the overlay beside the rail.
  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8 cursor-zoom-out"
      onClick={onClose}
    >
      <img src={src} alt="attachment" className="max-h-full max-w-full object-contain" />
    </div>,
    document.body,
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  );
}

function downloadName(base: string | undefined, index: number): string {
  if (base && base.length > 0) return base;
  return `attachment-${index + 1}.png`;
}
