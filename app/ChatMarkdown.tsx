"use client";

import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

type ChatMarkdownProps = {
  content: string;
  className?: string;
};

/**
 * Renders assistant chat text as sanitized GitHub-flavored markdown.
 */
export function ChatMarkdown({ content, className }: ChatMarkdownProps) {
  if (!content.trim()) return null;

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
