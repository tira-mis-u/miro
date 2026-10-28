import dns from 'node:dns';
import net from 'node:net';

export interface LinkMetadata {
  url: string;
  title: string;
  description: string;
  image: string;
  favicon: string;
  siteName: string;
  mediaType: 'website' | 'video' | 'article' | 'image';
  embedUrl?: string;
}

/** Check if an IPv4 or IPv6 address belongs to private, loopback, or reserved ranges. */
export function isPrivateOrBlockedIP(ip: string): boolean {
  if (!ip) return true;

  // Handle IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
  if (ip.startsWith('::ffff:') || ip.startsWith('::FFFF:')) {
    const v4 = ip.slice(7);
    if (net.isIPv4(v4)) return isPrivateOrBlockedIP(v4);
  }

  // IPv4 validation
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [b0, b1] = parts;

    if (b0 === 0) return true; // 0.0.0.0/8 Current network
    if (b0 === 10) return true; // 10.0.0.0/8 Private
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return true; // 100.64.0.0/10 Carrier-grade NAT
    if (b0 === 127) return true; // 127.0.0.0/8 Loopback
    if (b0 === 169 && b1 === 254) return true; // 169.254.0.0/16 Link-local
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true; // 172.16.0.0/12 Private
    if (b0 === 192 && b1 === 168) return true; // 192.168.0.0/16 Private
    if (b0 === 192 && b1 === 0 && (parts[2] === 0 || parts[2] === 2)) return true; // 192.0.0.0/24 & 192.0.2.0/24
    if (b0 === 198 && (b1 === 18 || b1 === 19)) return true; // 198.18.0.0/15 Benchmark
    if (b0 === 198 && b1 === 51 && parts[2] === 100) return true; // 198.51.100.0/24 TEST-NET-2
    if (b0 === 203 && b1 === 0 && parts[2] === 113) return true; // 203.0.113.0/24 TEST-NET-3
    if (b0 >= 224) return true; // 224.0.0.0/4 Multicast & 240.0.0.0/4 Reserved
    return false;
  }

  // IPv6 validation
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true; // Loopback or Unspecified
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 Unique Local (ULA)
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // fe80::/10 Link-Local
    if (lower.startsWith('2001:db8:')) return true; // 2001:db8::/32 Documentation
    if (lower.startsWith('ff')) return true; // ff00::/8 Multicast
    return false;
  }

  return true;
}

/** Validate target URL and verify all resolved DNS addresses against SSRF attack surfaces. */
export async function validateTargetUrl(urlString: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error('Invalid URL format');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Unsupported protocol: only http and https are allowed');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('Access to local domain is forbidden');
  }

  // If hostname is directly an IP literal
  if (net.isIP(hostname)) {
    if (isPrivateOrBlockedIP(hostname)) {
      throw new Error(`Access to private IP address is forbidden: ${hostname}`);
    }
    return parsed;
  }

  // Resolve hostname through DNS and verify all returned addresses
  try {
    const records = await dns.promises.lookup(hostname, { all: true });
    if (!records.length) {
      throw new Error(`Could not resolve hostname: ${hostname}`);
    }
    for (const record of records) {
      if (isPrivateOrBlockedIP(record.address)) {
        throw new Error(`Hostname resolves to private IP address: ${record.address}`);
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('private IP')) throw err;
    throw new Error(`DNS resolution failed for hostname: ${hostname}`);
  }

  return parsed;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function extractMetaTag(html: string, propertyNames: string[]): string {
  for (const name of propertyNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex1 = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i');
    const match1 = html.match(regex1);
    if (match1?.[1]) return decodeHtmlEntities(match1[1]);

    const regex2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i');
    const match2 = html.match(regex2);
    if (match2?.[1]) return decodeHtmlEntities(match2[1]);
  }
  return '';
}

function extractTitleTag(html: string): string {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match?.[1] ? decodeHtmlEntities(match[1]) : '';
}

function extractFavicon(html: string, baseUrl: URL): string {
  const match = html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']*)["']/i)
    || html.match(/<link[^>]+href=["']([^"']*)["'][^>]+rel=["'](?:shortcut )?icon["']/i);
  if (match?.[1]) {
    try {
      return new URL(match[1], baseUrl).href;
    } catch {
      // Fall through to Google favicon fallback
    }
  }
  return `https://www.google.com/s2/favicons?domain=${baseUrl.hostname}&sz=64`;
}

export function extractYouTubeVideoId(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([^"&?\/\s]{11})/i);
  return match?.[1] ?? null;
}

/** Fetch URL metadata with full SSRF protection, strict redirect verification, timeout, and response size limits. */
export async function getLinkPreviewMetadata(rawUrl: string): Promise<LinkMetadata> {
  let currentUrl = await validateTargetUrl(rawUrl);
  const originalDomain = currentUrl.hostname.replace(/^www\./i, '');

  // Fast path for YouTube links: extract video ID for guaranteed thumbnail and embed
  const ytVideoId = extractYouTubeVideoId(rawUrl);
  let ytOEmbedData: { title?: string; author_name?: string } | null = null;
  if (ytVideoId) {
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(rawUrl)}&format=json`;
      const oembedRes = await fetch(oembedUrl, {
        signal: AbortSignal.timeout(3000),
        headers: { 'User-Agent': 'MiroBoard-LinkPreview/1.0' },
      });
      if (oembedRes.ok) {
        ytOEmbedData = await oembedRes.json() as { title?: string; author_name?: string };
      }
    } catch {
      // Fallback to direct video id formatting
    }

    if (ytVideoId) {
      return {
        url: rawUrl,
        title: ytOEmbedData?.title || 'YouTube Video',
        description: ytOEmbedData?.author_name ? `Uploaded by ${ytOEmbedData.author_name}` : 'Watch video on YouTube',
        image: `https://img.youtube.com/vi/${ytVideoId}/hqdefault.jpg`,
        favicon: 'https://www.youtube.com/s/desktop/favicon.ico',
        siteName: 'YouTube',
        mediaType: 'video',
        embedUrl: `https://www.youtube.com/embed/${ytVideoId}?autoplay=1`,
      };
    }
  }

  // Fetch with manual redirect handling (max 3 redirects)
  const MAX_REDIRECTS = 3;
  let redirects = 0;
  let html = '';

  while (redirects <= MAX_REDIRECTS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    try {
      const res = await fetch(currentUrl.href, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
        },
      });

      // Handle Redirects with re-validation
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        redirects++;
        if (redirects > MAX_REDIRECTS) {
          throw new Error('Too many redirects');
        }
        const location = res.headers.get('location');
        if (!location) throw new Error('Redirect without location header');
        const nextUrlString = new URL(location, currentUrl).href;
        // CRITICAL: Re-validate redirect target to prevent SSRF bypass
        currentUrl = await validateTargetUrl(nextUrlString);
        continue;
      }

      if (!res.ok) {
        // Return clean fallback
        return {
          url: rawUrl,
          title: originalDomain,
          description: rawUrl,
          image: '',
          favicon: `https://www.google.com/s2/favicons?domain=${originalDomain}&sz=64`,
          siteName: originalDomain,
          mediaType: 'website',
        };
      }

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml') && !contentType.includes('application/json')) {
        return {
          url: rawUrl,
          title: originalDomain,
          description: rawUrl,
          image: '',
          favicon: `https://www.google.com/s2/favicons?domain=${originalDomain}&sz=64`,
          siteName: originalDomain,
          mediaType: contentType.includes('image/') ? 'image' : contentType.includes('video/') ? 'video' : 'website',
        };
      }

      // Stream body with 256KB cap
      const reader = res.body?.getReader();
      if (!reader) {
        html = await res.text();
      } else {
        const chunks: Uint8Array[] = [];
        let bytesRead = 0;
        const MAX_BYTES = 256 * 1024; // 256KB

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            bytesRead += value.length;
            if (bytesRead >= MAX_BYTES) {
              await reader.cancel();
              break;
            }
          }
        }
        const combined = new Uint8Array(bytesRead);
        let offset = 0;
        for (const chunk of chunks) {
          const take = Math.min(chunk.length, bytesRead - offset);
          combined.set(chunk.subarray(0, take), offset);
          offset += take;
        }
        html = new TextDecoder('utf-8').decode(combined);
      }
      break;
    } finally {
      clearTimeout(timeout);
    }
  }

  // Parse OpenGraph and Twitter card metadata
  const title = extractMetaTag(html, ['og:title', 'twitter:title']) || extractTitleTag(html) || originalDomain;
  const description = extractMetaTag(html, ['og:description', 'twitter:description', 'description']) || '';
  let image = extractMetaTag(html, ['og:image', 'twitter:image', 'og:image:url']);
  if (image) {
    try {
      image = new URL(image, currentUrl).href;
    } catch {
      image = '';
    }
  }

  const siteName = extractMetaTag(html, ['og:site_name', 'twitter:site']) || originalDomain;
  const rawType = extractMetaTag(html, ['og:type']).toLowerCase();
  const mediaType: LinkMetadata['mediaType'] = rawType.includes('video') ? 'video'
    : rawType.includes('article') ? 'article'
    : rawType.includes('image') ? 'image' : 'website';
  const favicon = extractFavicon(html, currentUrl);

  return {
    url: rawUrl,
    title: title.slice(0, 300),
    description: description.slice(0, 500),
    image,
    favicon,
    siteName: siteName.slice(0, 100),
    mediaType,
  };
}
