// The sandbox proxy page for MCP app iframes (SEP-1865 double-iframe
// pattern). The canvas page embeds THIS page in an outer iframe served from
// the daemon's other loopback name (localhost vs 127.0.0.1), so the proxy
// runs on a different origin from the canvas. The proxy mounts the app HTML
// in an inner srcdoc iframe and relays postMessage traffic both ways.
//
// SECURITY INVARIANTS:
// - The inner iframe is sandboxed WITHOUT allow-same-origin: the app runs on
//   an opaque origin and can never reach the daemon API or the canvas DOM.
// - A deny-by-default CSP is injected into the app HTML; only domains the
//   resource declared via _meta.ui.csp are opened up (host MUST block
//   undeclared domains per SEP-1865).
// - Only the sandbox-* lifecycle notifications are consumed here; every other
//   message is relayed verbatim — the proxy never interprets app traffic.

export const SANDBOX_PAGE_PATH = "/sandbox.html";

const INNER_IFRAME_SANDBOX = "allow-scripts allow-forms";

export const SANDBOX_PAGE_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>parchment app sandbox</title>
<style>html,body{margin:0;height:100%;background:transparent}iframe{border:0;width:100%;height:100%;display:block}</style>
</head>
<body>
<script>
(() => {
  const INNER_SANDBOX = ${JSON.stringify(INNER_IFRAME_SANDBOX)};
  let innerFrame = null;
  let innerLoaded = false;
  const queuedForInner = [];

  function domainList(value) {
    return Array.isArray(value) ? value.filter((d) => typeof d === "string").join(" ") : "";
  }

  function buildCspContent(csp) {
    const resource = domainList(csp && csp.resourceDomains);
    const connect = domainList(csp && csp.connectDomains);
    const frame = domainList(csp && csp.frameDomains);
    return [
      "default-src 'none'",
      ("script-src 'unsafe-inline' 'unsafe-eval' " + resource).trim(),
      ("style-src 'unsafe-inline' " + resource).trim(),
      ("img-src data: blob: " + resource).trim(),
      ("font-src data: " + resource).trim(),
      ("media-src data: blob: " + resource).trim(),
      "connect-src " + (connect || "'none'"),
      "frame-src " + (frame || "'none'"),
      "form-action 'none'",
    ].join("; ");
  }

  function injectCspMeta(html, cspContent) {
    const meta = '<meta http-equiv="Content-Security-Policy" content="' + cspContent + '">';
    const headMatch = html.match(/<head[^>]*>/i);
    if (headMatch) {
      const insertAt = headMatch.index + headMatch[0].length;
      return html.slice(0, insertAt) + meta + html.slice(insertAt);
    }
    const htmlMatch = html.match(/<html[^>]*>/i);
    if (htmlMatch) {
      const insertAt = htmlMatch.index + htmlMatch[0].length;
      return html.slice(0, insertAt) + "<head>" + meta + "</head>" + html.slice(insertAt);
    }
    return "<head>" + meta + "</head>" + html;
  }

  function mountInner(params) {
    if (innerFrame) innerFrame.remove();
    innerLoaded = false;
    innerFrame = document.createElement("iframe");
    innerFrame.setAttribute("sandbox", INNER_SANDBOX);
    innerFrame.addEventListener("load", () => {
      innerLoaded = true;
      for (const message of queuedForInner.splice(0)) {
        innerFrame.contentWindow.postMessage(message, "*");
      }
    });
    innerFrame.srcdoc = injectCspMeta(String(params.html || ""), buildCspContent(params.csp));
    document.body.appendChild(innerFrame);
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (event.source === window.parent) {
      if (message && message.method === "ui/notifications/sandbox-resource-ready") {
        mountInner(message.params || {});
        return;
      }
      if (innerFrame && innerLoaded) {
        innerFrame.contentWindow.postMessage(message, "*");
      } else {
        queuedForInner.push(message);
      }
      return;
    }
    if (innerFrame && event.source === innerFrame.contentWindow) {
      const method = message && message.method;
      if (typeof method === "string" && method.indexOf("ui/notifications/sandbox-") === 0) return;
      window.parent.postMessage(message, "*");
    }
  });

  window.parent.postMessage(
    { jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready", params: {} },
    "*",
  );
})();
</script>
</body>
</html>
`;
