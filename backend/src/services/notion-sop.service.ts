/**
 * Fetches SOP content from Notion pages at runtime.
 *
 * Requires NOTION_TOKEN env var — create an Internal Integration at
 * https://www.notion.so/my-integrations and share the relevant SOP pages with it.
 *
 * If NOTION_TOKEN is not set, all functions return null and the caller falls back
 * to the static sops.json file.
 */

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const pageContentCache = new Map<string, { text: string; fetchedAt: number }>();
const searchCache = new Map<string, { pages: Array<{ id: string; title: string }>; fetchedAt: number }>();

export const isNotionSOPEnabled = Boolean(process.env.NOTION_TOKEN);

function notionHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

function extractRichText(richText: any[]): string {
  return (richText || []).map((t: any) => t.plain_text || '').join('');
}

function blocksToText(blocks: any[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case 'heading_1':
        lines.push(`# ${extractRichText(block.heading_1?.rich_text || [])}`);
        break;
      case 'heading_2':
        lines.push(`## ${extractRichText(block.heading_2?.rich_text || [])}`);
        break;
      case 'heading_3':
        lines.push(`### ${extractRichText(block.heading_3?.rich_text || [])}`);
        break;
      case 'paragraph': {
        const t = extractRichText(block.paragraph?.rich_text || []);
        if (t.trim()) lines.push(t);
        break;
      }
      case 'bulleted_list_item':
        lines.push(`- ${extractRichText(block.bulleted_list_item?.rich_text || [])}`);
        break;
      case 'numbered_list_item':
        lines.push(extractRichText(block.numbered_list_item?.rich_text || []));
        break;
      case 'callout':
        lines.push(extractRichText(block.callout?.rich_text || []));
        break;
      case 'quote':
        lines.push(`> ${extractRichText(block.quote?.rich_text || [])}`);
        break;
      case 'code':
        lines.push(extractRichText(block.code?.rich_text || []));
        break;
      case 'divider':
        lines.push('---');
        break;
    }
  }
  return lines.filter(Boolean).join('\n');
}

async function fetchBlocks(pageId: string): Promise<any[]> {
  const res = await fetch(`${NOTION_API}/blocks/${pageId}/children?page_size=100`, {
    headers: notionHeaders(),
  });
  if (!res.ok) throw new Error(`Notion blocks ${pageId} → ${res.status}`);
  const data = await res.json() as { results: any[] };
  return data.results || [];
}

async function fetchPageText(pageId: string): Promise<string> {
  const cached = pageContentCache.get(pageId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.text;

  const blocks = await fetchBlocks(pageId);
  const text = blocksToText(blocks);
  pageContentCache.set(pageId, { text, fetchedAt: Date.now() });
  return text;
}

async function searchNotionPages(query: string): Promise<Array<{ id: string; title: string }>> {
  const cached = searchCache.get(query);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.pages;

  const res = await fetch(`${NOTION_API}/search`, {
    method: 'POST',
    headers: notionHeaders(),
    body: JSON.stringify({
      query,
      filter: { value: 'page', property: 'object' },
      page_size: 5,
    }),
  });

  if (!res.ok) throw new Error(`Notion search → ${res.status}`);
  const data = await res.json() as { results: any[] };

  const pages = (data.results || [])
    .filter((r: any) => r.object === 'page')
    .map((r: any) => {
      const titleProp = r.properties?.title || r.properties?.Name;
      const title = titleProp?.title?.[0]?.plain_text || '';
      return { id: r.id as string, title };
    })
    .filter((p: any) => p.title);

  searchCache.set(query, { pages, fetchedAt: Date.now() });
  return pages;
}

/**
 * Find and return the best-matching SOP page from Notion.
 * Returns null if Notion is not configured or no match found.
 */
export async function findSOPFromNotion(
  category?: string,
  tags?: string,
): Promise<{ title: string; content: string } | null> {
  if (!isNotionSOPEnabled) return null;

  const query = [category, tags].filter(Boolean).join(' ').trim();
  if (!query) return null;

  try {
    const pages = await searchNotionPages(query);
    if (pages.length === 0) return null;

    const best = pages[0];
    const content = await fetchPageText(best.id);
    if (!content.trim()) return null;

    // Truncate to keep prompt size reasonable
    const truncated = content.length > 2500 ? `${content.slice(0, 2500)}\n[...truncated]` : content;
    return { title: best.title, content: truncated };
  } catch (err: any) {
    console.warn(`[Notion SOP] ${err.message}`);
    return null;
  }
}

export function clearNotionSOPCache(): void {
  pageContentCache.clear();
  searchCache.clear();
  console.log('[Notion SOP] Cache cleared');
}
