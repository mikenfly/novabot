import React from 'react';
import { NativeMarkdown } from './NativeMarkdown';
import { RichContentWebView } from './RichContentWebView';

interface MessageContentProps {
  content: string;
  conversationId: string;
}

/** Detect content that requires WebView (Shiki syntax highlighting, Mermaid diagrams) */
function hasComplexContent(markdown: string): boolean {
  // Fenced code block with explicit language (needs syntax highlighting)
  if (/```\w+/m.test(markdown)) return true;
  // Mermaid diagram
  if (/```mermaid/mi.test(markdown)) return true;
  return false;
}

export function MessageContent({ content, conversationId }: MessageContentProps) {
  if (hasComplexContent(content)) {
    return (
      <RichContentWebView
        content={content}
        conversationId={conversationId}
      />
    );
  }

  return (
    <NativeMarkdown
      content={content}
      conversationId={conversationId}
    />
  );
}
