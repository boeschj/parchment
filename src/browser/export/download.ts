// Browser-only side effects for handing an export to the user: a file download
// into ~/Downloads, opening a print window, and copying text to the clipboard.
// Kept apart from the pure builders so those stay unit-testable.

export function downloadTextFile(filename: string, text: string, mimeType: string): void {
  const blob = new Blob([text], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Opens fully-formed HTML in a new tab via a blob URL. Used by the print flow:
// the document carries its own auto-print script, so the browser's Save-as-PDF
// dialog appears on load with no app shell around it.
export function openHtmlInNewWindow(html: string): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, "_blank");
  if (!opened) {
    // Popup blocked — fall back to a download so the user still gets the file.
    URL.revokeObjectURL(url);
    downloadTextFile("parchment-print.html", html, "text/html");
    return;
  }
  // Revoke after the new window has had time to load the blob.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function copyTextToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
