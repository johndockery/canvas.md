import * as Y from "yjs";

// ============================================================
// markdownToYjs — write markdown string into Y.Text
// ============================================================

export function markdownToYjs(markdown: string, ytext: Y.Text): void {
  ytext.delete(0, ytext.length);
  ytext.insert(0, markdown);
}

// ============================================================
// yjsXmlFragmentToMarkdown — serialize old Yjs XmlFragment to markdown
// Used only for migration from XmlFragment("default") → Y.Text("markdown")
// ============================================================

export function yjsXmlFragmentToMarkdown(fragment: Y.XmlFragment): string {
  const lines: string[] = [];
  for (let i = 0; i < fragment.length; i++) {
    const child = fragment.get(i);
    if (child instanceof Y.XmlElement) {
      lines.push(elementToMarkdown(child));
    } else if (child instanceof Y.XmlText) {
      lines.push(deltaToMarkdown(child.toDelta()));
    }
  }
  return lines.join("\n\n") + "\n";
}

// Keep the old yjsToMarkdown name as an alias for backwards compat in migration code
export const yjsToMarkdown = yjsXmlFragmentToMarkdown;

function elementToMarkdown(el: Y.XmlElement): string {
  const nodeName = el.nodeName;

  switch (nodeName) {
    case "heading": {
      const level = Number(el.getAttribute("level")) || 1;
      const prefix = "#".repeat(level);
      const text = getInlineContent(el);
      return `${prefix} ${text}`;
    }
    case "paragraph": {
      return getInlineContent(el);
    }
    case "codeBlock": {
      const lang = el.getAttribute("language") || "";
      const content = getPlainText(el);
      return "```" + lang + "\n" + content + "\n```";
    }
    case "blockquote": {
      const inner: string[] = [];
      for (let i = 0; i < el.length; i++) {
        const child = el.get(i);
        if (child instanceof Y.XmlElement) {
          inner.push(elementToMarkdown(child));
        }
      }
      return inner
        .join("\n\n")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    }
    case "bulletList": {
      return listToMarkdown(el, false);
    }
    case "orderedList": {
      return listToMarkdown(el, true);
    }
    case "listItem": {
      const inner: string[] = [];
      for (let i = 0; i < el.length; i++) {
        const child = el.get(i);
        if (child instanceof Y.XmlElement) {
          inner.push(elementToMarkdown(child));
        }
      }
      return inner.join("\n");
    }
    case "horizontalRule": {
      return "---";
    }
    default: {
      return getInlineContent(el);
    }
  }
}

function listToMarkdown(el: Y.XmlElement, ordered: boolean): string {
  const items: string[] = [];
  for (let i = 0; i < el.length; i++) {
    const child = el.get(i);
    if (child instanceof Y.XmlElement && child.nodeName === "listItem") {
      const prefix = ordered ? `${i + 1}. ` : "- ";
      const contentParts: string[] = [];
      for (let j = 0; j < child.length; j++) {
        const itemChild = child.get(j);
        if (itemChild instanceof Y.XmlElement) {
          if (itemChild.nodeName === "bulletList" || itemChild.nodeName === "orderedList") {
            const nested = elementToMarkdown(itemChild);
            contentParts.push(
              nested
                .split("\n")
                .map((line) => "  " + line)
                .join("\n")
            );
          } else {
            contentParts.push(getInlineContent(itemChild));
          }
        }
      }
      if (contentParts.length === 0) {
        items.push(prefix);
      } else {
        const first = contentParts[0];
        const rest = contentParts.slice(1);
        let result = prefix + first;
        for (const part of rest) {
          result += "\n" + part;
        }
        items.push(result);
      }
    }
  }
  return items.join("\n");
}

function getInlineContent(el: Y.XmlElement): string {
  const parts: string[] = [];
  for (let i = 0; i < el.length; i++) {
    const child = el.get(i);
    if (child instanceof Y.XmlText) {
      parts.push(deltaToMarkdown(child.toDelta()));
    } else if (child instanceof Y.XmlElement) {
      parts.push(getInlineContent(child));
    }
  }
  return parts.join("");
}

function getPlainText(el: Y.XmlElement): string {
  const parts: string[] = [];
  for (let i = 0; i < el.length; i++) {
    const child = el.get(i);
    if (child instanceof Y.XmlText) {
      parts.push(child.toString());
    } else if (child instanceof Y.XmlElement) {
      parts.push(getPlainText(child));
    }
  }
  return parts.join("");
}

interface DeltaOp {
  insert: string;
  attributes?: Record<string, unknown>;
}

function deltaToMarkdown(delta: DeltaOp[]): string {
  return delta
    .map((op) => {
      let text = op.insert;
      if (!op.attributes) return text;

      if (op.attributes.code) {
        text = "`" + text + "`";
      }
      if (op.attributes.bold) {
        text = "**" + text + "**";
      }
      if (op.attributes.italic) {
        text = "*" + text + "*";
      }
      if (op.attributes.strike) {
        text = "~~" + text + "~~";
      }
      return text;
    })
    .join("");
}
