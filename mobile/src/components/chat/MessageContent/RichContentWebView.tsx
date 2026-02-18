import React, { useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { getBaseUrl } from '@nanoclaw/shared';
import { colors } from '../../../theme';

interface RichContentWebViewProps {
  content: string;
  conversationId: string;
}

/**
 * WebView-based markdown renderer for content that needs
 * syntax highlighting (Shiki) or Mermaid diagrams.
 */
export function RichContentWebView({ content, conversationId }: RichContentWebViewProps) {
  const [webViewHeight, setWebViewHeight] = useState(100);
  const baseUrl = getBaseUrl();

  const html = useMemo(() => buildHtml(content, conversationId, baseUrl), [content, conversationId, baseUrl]);

  return (
    <View style={[styles.container, { height: webViewHeight }]}>
      <WebView
        source={{ html, baseUrl }}
        style={styles.webview}
        scrollEnabled={false}
        showsVerticalScrollIndicator={false}
        originWhitelist={['*']}
        onMessage={(event) => {
          try {
            const data = JSON.parse(event.nativeEvent.data);
            if (data.type === 'height' && typeof data.value === 'number') {
              setWebViewHeight(Math.ceil(data.value) + 8);
            }
          } catch {
            // ignore
          }
        }}
        injectedJavaScript={HEIGHT_REPORT_SCRIPT}
      />
    </View>
  );
}

/** Injected JS to report content height back to React Native */
const HEIGHT_REPORT_SCRIPT = `
  (function() {
    function reportHeight() {
      const h = document.body.scrollHeight;
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'height', value: h }));
    }
    // Report after initial render
    setTimeout(reportHeight, 100);
    // Report after images/diagrams load
    new MutationObserver(reportHeight).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('load', reportHeight);
    // Periodic check for dynamic content (mermaid)
    let checks = 0;
    const interval = setInterval(() => {
      reportHeight();
      if (++checks > 20) clearInterval(interval);
    }, 500);
  })();
  true;
`;

function buildHtml(markdown: string, conversationId: string, baseUrl: string): string {
  // Escape for safe embedding in a JS string literal
  const escaped = markdown
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: transparent;
      color: ${colors.textPrimary};
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 15px;
      line-height: 1.5;
      padding: 0;
      -webkit-text-size-adjust: none;
    }
    a { color: ${colors.accent}; }
    p { margin: 4px 0; }
    pre {
      background: ${colors.bgTertiary};
      border-radius: 8px;
      padding: 12px;
      overflow-x: auto;
      margin: 6px 0;
      -webkit-overflow-scrolling: touch;
    }
    code {
      font-family: Menlo, Monaco, 'Courier New', monospace;
      font-size: 13px;
    }
    :not(pre) > code {
      background: ${colors.bgTertiary};
      padding: 1px 4px;
      border-radius: 4px;
    }
    blockquote {
      border-left: 3px solid ${colors.accent};
      background: rgba(124, 92, 252, 0.06);
      padding: 4px 12px;
      margin: 4px 0;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 6px 0;
    }
    th, td {
      border: 1px solid ${colors.border};
      padding: 6px 8px;
      text-align: left;
    }
    th { background: ${colors.bgTertiary}; font-weight: 600; }
    img { max-width: 100%; border-radius: 8px; }
    .mermaid { margin: 8px 0; }
    .mermaid svg { max-width: 100%; }
  </style>
</head>
<body>
  <div id="content"></div>

  <script src="https://cdn.jsdelivr.net/npm/marked@15/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>

  <script>
    // URL rewriting
    const baseUrl = ${JSON.stringify(baseUrl)};
    const conversationId = ${JSON.stringify(conversationId)};

    function rewriteUrl(url) {
      if (!url) return url;
      if (url.startsWith('/workspace/group/')) {
        return baseUrl + '/api/conversations/' + conversationId + '/files/' + url.replace('/workspace/group/', '');
      }
      if (url.startsWith('./')) {
        return baseUrl + '/api/conversations/' + conversationId + '/files/' + url.slice(2);
      }
      return url;
    }

    // Configure marked with URL rewriting
    const renderer = new marked.Renderer();
    const origImage = renderer.image.bind(renderer);
    renderer.image = function({ href, title, text }) {
      return '<img src="' + rewriteUrl(href) + '" alt="' + (text || '') + '" loading="lazy">';
    };
    const origLink = renderer.link.bind(renderer);
    renderer.link = function({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      return '<a href="' + rewriteUrl(href) + '" target="_blank">' + text + '</a>';
    };

    marked.setOptions({ renderer, gfm: true, breaks: true });

    // Render
    const md = \`${escaped}\`;
    document.getElementById('content').innerHTML = marked.parse(md);

    // Initialize Mermaid diagrams
    if (typeof mermaid !== 'undefined') {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        themeVariables: {
          darkMode: true,
          background: 'transparent',
          primaryColor: '${colors.accent}',
        },
      });
      mermaid.run({ querySelector: '.language-mermaid, code.mermaid' }).catch(() => {});
    }
  </script>
</body>
</html>`;
}

const styles = StyleSheet.create({
  container: {
    minHeight: 40,
    overflow: 'hidden',
  },
  webview: {
    backgroundColor: 'transparent',
  },
});
