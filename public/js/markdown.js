// A small Markdown renderer for the built-in guides (public/docs/*.md).
// Supports: headings, paragraphs, bold/italic, inline code, links, images, lists (two levels),
// tables, block quotes, code blocks and horizontal rules. Text is escaped; no raw HTML.

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Inline formatting on escaped text. linkFn(href) -> href to use (guides link to each other).
function inline(text, linkFn) {
  const codes = [];
  let s = esc(text).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => `<img alt="${alt}" src="${src}">`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, href) => {
      const to = linkFn ? linkFn(href) : href;
      const ext = /^https?:/.test(to);
      return `<a href="${to}"${ext ? ' target="_blank" rel="noopener"' : ''}>${t}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<i>$2</i>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

export function render(md, linkFn) {
  const lines = md.replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  const isTable = (l) => /^\s*\|.*\|\s*$/.test(l);
  const isList = (l) => /^(\s*)([-*]|\d+\.)\s+/.test(l);
  const isBlock = (l) => /^(#{1,4}\s|>|```|---\s*$)/.test(l) || isTable(l) || isList(l);
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) {
      const n = m[1].length;
      const id = m[2].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      out.push(`<h${n} id="${id}">${inline(m[2], linkFn)}</h${n}>`);
      i++;
    } else if (/^```/.test(l)) {
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
    } else if (/^---\s*$/.test(l)) {
      out.push('<hr>');
      i++;
    } else if (/^>/.test(l)) {
      const q = [];
      while (i < lines.length && /^>/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${render(q.join('\n'), linkFn)}</blockquote>`);
    } else if (isTable(l)) {
      const rows = [];
      while (i < lines.length && isTable(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
      const head = cells(rows[0]);
      const body = rows.slice(/^[\s|:-]+$/.test(rows[1] || '') ? 2 : 1);
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c, linkFn)}</th>`).join('')}</tr></thead><tbody>${
        body.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c, linkFn)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    } else if (isList(l)) {
      // Items with their continuation lines; deeper-indented items become a nested list.
      const items = [];
      const baseIndent = /^(\s*)/.exec(l)[1].length;
      const ordered = /^\s*\d+\./.test(l);
      while (i < lines.length) {
        const cur = lines[i];
        if (!cur.trim()) {
          // a blank line ends the list unless the next line continues it
          const next = lines[i + 1] || '';
          if (isList(next) || /^\s{2,}\S/.test(next)) { i++; continue; }
          break;
        }
        const im = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(cur);
        if (im && im[1].length <= baseIndent + 1) {
          items.push({ text: [im[3]], sub: [] });
        } else if (items.length && (im || /^\s{2,}/.test(cur))) {
          const it = items[items.length - 1];
          if (im || it.sub.length) it.sub.push(cur.slice(Math.min(baseIndent + 2, cur.search(/\S/))));
          else it.text.push(cur.trim());
        } else break;
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((it) => `<li>${inline(it.text.join(' '), linkFn)}${it.sub.length ? render(it.sub.join('\n'), linkFn) : ''}</li>`).join('')}</${tag}>`);
    } else {
      const p = [];
      while (i < lines.length && lines[i].trim() && !isBlock(lines[i])) p.push(lines[i++].trim());
      out.push(`<p>${inline(p.join(' '), linkFn)}</p>`);
    }
  }
  return out.join('\n');
}

// Plain text of a guide, for search
export const plain = (md) => md.replace(/[#*`>|_[\]()-]/g, ' ').replace(/\s+/g, ' ');
