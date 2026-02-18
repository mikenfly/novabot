import React, { useMemo } from 'react';
import { Linking, StyleSheet } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { getBaseUrl, getToken } from '@nanoclaw/shared';
import { colors, radius, spacing } from '../../../theme';

interface NativeMarkdownProps {
  content: string;
  conversationId: string;
}

/**
 * Rewrite container-internal paths to the API files endpoint.
 * /workspace/group/photo.jpg → {baseUrl}/api/conversations/{id}/files/photo.jpg?token=...
 */
function rewriteUrls(content: string, conversationId: string, token: string | null, baseUrl: string): string {
  return content
    .replace(
      /(?:\/workspace\/group\/|\.\/)([\w./-]+)/g,
      (_, path) => {
        const url = `${baseUrl}/api/conversations/${conversationId}/files/${path}`;
        return token ? `${url}?token=${encodeURIComponent(token)}` : url;
      },
    );
}

export function NativeMarkdown({ content, conversationId }: NativeMarkdownProps) {
  const processedContent = useMemo(() => {
    const baseUrl = getBaseUrl();
    // getToken is async in shared, but we need sync here.
    // For native markdown, URL rewriting is optional — images will try to load anyway.
    // We do a best-effort sync read from the store.
    const token = null; // TODO: read from auth store synchronously
    return rewriteUrls(content, conversationId, token, baseUrl);
  }, [content, conversationId]);

  return (
    <Markdown
      style={markdownStyles}
      onLinkPress={(url) => {
        if (url) Linking.openURL(url);
        return false;
      }}
    >
      {processedContent}
    </Markdown>
  );
}

const markdownStyles = StyleSheet.create({
  body: {
    color: colors.textPrimary,
    fontSize: 15,
    lineHeight: 22,
  },
  heading1: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '700',
    marginVertical: spacing.sm,
  },
  heading2: {
    color: colors.textPrimary,
    fontSize: 19,
    fontWeight: '600',
    marginVertical: spacing.sm,
  },
  heading3: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '600',
    marginVertical: spacing.xs,
  },
  paragraph: {
    marginVertical: spacing.xs,
  },
  strong: {
    fontWeight: '600',
  },
  em: {
    fontStyle: 'italic',
  },
  link: {
    color: colors.accent,
    textDecorationLine: 'underline',
  },
  blockquote: {
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    backgroundColor: 'rgba(124, 92, 252, 0.06)',
    paddingLeft: spacing.md,
    paddingVertical: spacing.xs,
    marginVertical: spacing.xs,
  },
  code_inline: {
    fontFamily: 'Menlo',
    fontSize: 13,
    backgroundColor: colors.bgTertiary,
    color: colors.textPrimary,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  code_block: {
    fontFamily: 'Menlo',
    fontSize: 13,
    backgroundColor: colors.bgTertiary,
    color: colors.textPrimary,
    padding: spacing.md,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  fence: {
    fontFamily: 'Menlo',
    fontSize: 13,
    backgroundColor: colors.bgTertiary,
    color: colors.textPrimary,
    padding: spacing.md,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  table: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
  thead: {
    backgroundColor: colors.bgTertiary,
  },
  th: {
    color: colors.textPrimary,
    fontWeight: '600',
    padding: spacing.sm,
    borderRightWidth: 1,
    borderColor: colors.border,
  },
  td: {
    color: colors.textPrimary,
    padding: spacing.sm,
    borderRightWidth: 1,
    borderColor: colors.border,
  },
  tr: {
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  list_item: {
    marginVertical: 2,
  },
  bullet_list: {
    marginVertical: spacing.xs,
  },
  ordered_list: {
    marginVertical: spacing.xs,
  },
  image: {
    borderRadius: radius.sm,
    maxWidth: 280,
  },
  hr: {
    backgroundColor: colors.border,
    height: 1,
    marginVertical: spacing.md,
  },
});
