import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { STATE_DIR } from "./state.ts";
import { generateId } from "./ids.ts";

export const UPLOADS_DIR = join(STATE_DIR, "uploads");

const MAX_ORIGINAL_NAME_LENGTH = 80;
const MAX_EXTENSION_LENGTH = 8;

export type StoredUpload = {
  savedPath: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
};

// SECURITY: the storage path is entirely daemon-generated — the user-chosen
// file name never influences where bytes land (no traversal, no collisions,
// no shell-hostile characters). Only a sanitized extension survives, and the
// sanitized original name is carried along as untrusted display metadata.
export async function storeUpload(sessionId: string, file: File): Promise<StoredUpload> {
  const directory = uploadDirFor(sessionId);
  mkdirSync(directory, { recursive: true });

  const fileName = generateUploadFileName(file.name);
  const savedPath = join(directory, fileName);
  await Bun.write(savedPath, file);

  return {
    savedPath,
    originalName: sanitizeOriginalName(file.name),
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
  };
}

export function uploadDirFor(sessionId: string): string {
  const safeSessionId = sessionId.replace(/[^A-Za-z0-9._-]/g, "_");
  return join(UPLOADS_DIR, safeSessionId);
}

export function generateUploadFileName(originalName: string): string {
  const extension = sanitizedExtensionOf(originalName);
  const uniquePart = generateId("upload");
  return extension.length > 0 ? `${uniquePart}.${extension}` : uniquePart;
}

export function sanitizeOriginalName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, "_");
  return cleaned.slice(0, MAX_ORIGINAL_NAME_LENGTH);
}

function sanitizedExtensionOf(name: string): string {
  const lastDot = name.lastIndexOf(".");
  if (lastDot === -1 || lastDot === name.length - 1) return "";
  const rawExtension = name.slice(lastDot + 1).toLowerCase();
  const cleaned = rawExtension.replace(/[^a-z0-9]/g, "");
  return cleaned.slice(0, MAX_EXTENSION_LENGTH);
}
