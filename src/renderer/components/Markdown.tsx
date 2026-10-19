import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../api';

// Сырой HTML не выполняется (без rehype-raw); ссылки — только http(s), открываются в браузере
const components: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href && /^https?:\/\//i.test(href)) api.links.open(href);
      }}
    >
      {children}
    </a>
  ),
  img: ({ alt }) => <span className="md-img">[{alt || 'картинка'}]</span>,
};

const safeUrl = (url: string) => (/^(https?:|#|mailto:)/i.test(url) ? url : '');

/** Ответ Claude в markdown (GFM: таблицы, списки задач, зачёркивание). */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={safeUrl}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
