import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Upload as UploadGlyph } from "lucide-react";
import type { z } from "zod/v4";
import { UploadPropsSchema } from "../../shared/catalog/extensions/Upload.ts";
import { uploadCanvasFile } from "../api.ts";
import { useSlotContext } from "../SlotContext.tsx";

type UploadProps = z.infer<typeof UploadPropsSchema>;
type RenderProps = { props: UploadProps };

const DEFAULT_LABEL = "Drop a file or click to browse";

const UploadPhase = {
  Idle: "idle",
  Uploading: "uploading",
  Error: "error",
} as const;

type UploadPhase = (typeof UploadPhase)[keyof typeof UploadPhase];

export function Upload({ props }: RenderProps) {
  const { sessionId, slotId } = useSlotContext();
  const [phase, setPhase] = useState<UploadPhase>(UploadPhase.Idle);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deliveredNames, setDeliveredNames] = useState<string[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  // DOM ref only forwards the dropzone click to the hidden file input.
  const fileInputRef = useRef<HTMLInputElement>(null);

  const label = props.label ?? DEFAULT_LABEL;
  const isUploading = phase === UploadPhase.Uploading;
  const borderColor = isDragActive ? "var(--primary)" : "var(--border)";

  const deliverFiles = async (fileList: FileList | null): Promise<void> => {
    const files = selectFiles(fileList, props.multiple ?? false);
    if (files.length === 0) return;
    setPhase(UploadPhase.Uploading);
    setErrorMessage(null);
    try {
      for (const file of files) {
        await uploadCanvasFile(sessionId, slotId, null, file);
        setDeliveredNames((previous) => [...previous, file.name]);
      }
      setPhase(UploadPhase.Idle);
    } catch (caught) {
      setPhase(UploadPhase.Error);
      setErrorMessage(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const handleBrowseClick = (): void => {
    fileInputRef.current?.click();
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>): void => {
    void deliverFiles(event.target.files);
    event.target.value = "";
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setIsDragActive(true);
  };

  const handleDragLeave = (): void => {
    setIsDragActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setIsDragActive(false);
    void deliverFiles(event.dataTransfer.files);
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={handleBrowseClick}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") handleBrowseClick();
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center cursor-pointer bg-card transition-colors"
        style={{
          borderRadius: "var(--radius)",
          border: `1.5px dashed ${borderColor}`,
        }}
      >
        <UploadGlyph width={20} height={20} className="text-muted-foreground" aria-hidden />
        <span className="text-sm font-medium">{isUploading ? "Uploading…" : label}</span>
        {props.hint ? (
          <span className="text-xs text-muted-foreground">{props.hint}</span>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          {...(props.accept !== undefined ? { accept: props.accept } : {})}
          multiple={props.multiple ?? false}
          onChange={handleInputChange}
        />
      </div>
      {errorMessage ? (
        <p className="mt-2 mb-0 text-xs text-destructive">{errorMessage}</p>
      ) : null}
      {deliveredNames.length > 0 ? (
        <p className="mt-2 mb-0 text-xs text-muted-foreground">
          Handed to Claude: {deliveredNames.join(", ")} — it gets the saved path on its next turn.
        </p>
      ) : null}
    </div>
  );
}

function selectFiles(fileList: FileList | null, allowMultiple: boolean): File[] {
  if (!fileList || fileList.length === 0) return [];
  const files = Array.from(fileList);
  if (allowMultiple) return files;
  return files.slice(0, 1);
}
