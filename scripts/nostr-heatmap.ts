#!/usr/bin/env npx tsx
/**
 * Nostr Heatmap — periodic pulse of what's trending on Nostr.
 * Uses nostr-agent-interface CLI to query recent kind-1 notes,
 * then extracts hashtags, topics, and activity patterns.
 *
 * Usage: npx tsx scripts/nostr-heatmap.ts
 * Output: markdown summary to stdout
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';

const HOURS = 6;
const LIMIT = 200;
const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
  'wss://relay.nostr.band',
];

// Resolve the cached nostr-agent-interface build
const NAI_BIN = path.resolve(process.cwd(), '.cache/nostr-agent-interface/build/app/index.js');

function run(args: string[]): string {
  const opts = {
    encoding: 'utf-8' as const,
    timeout: 90_000,
    env: {
      ...process.env,
      NOSTR_DEFAULT_RELAYS: RELAYS.join(','),
      NOSTR_JSON_ONLY: 'true',
    },
    stdio: ['pipe', 'pipe', 'pipe'] as const,
    maxBuffer: 10 * 1024 * 1024,
  };
  try {
    return execFileSync('node', [NAI_BIN, ...args], opts);
  } catch (e: any) {
    const stdout = e.stdout || '';
    const stderr = e.stderr || '';
    if (stdout.length > 0) return stdout;
    console.error(`CLI failed: ${stderr.slice(0, 300) || e.message?.slice(0, 300)}`);
    return '';
  }
}

interface NostrEvent {
  content: string;
  tags: string[][];
  created_at: number;
}

function extractEvents(raw: string): NostrEvent[] {
  // The agent CLI returns a JSON envelope that contains a formatted text transcript, not
  // raw event objects, so this parser reconstructs lightweight event records from that.
  try {
    const parsed = JSON.parse(raw);
    // The CLI returns { content: [{ type: "text", text: "..." }] }
    const text: string = parsed?.content?.[0]?.text ?? '';
    // Parse individual events from the text block
    const events: NostrEvent[] = [];
    const blocks = text.split('\n---\n');
    for (const block of blocks) {
      const contentMatch = block.match(/Content:\s*([\s\S]*?)(?:\nTags:|$)/);
      const tagsMatch = block.match(/Tags:\s*(\[[\s\S]*?\])\s*$/);
      const dateMatch = block.match(/Created:\s*(.+)/);

      if (contentMatch) {
        let tags: string[][] = [];
        try {
          if (tagsMatch?.[1]) tags = JSON.parse(tagsMatch[1]);
        } catch {}

        let created_at = Math.floor(Date.now() / 1000);
        if (dateMatch?.[1]) {
          const d = new Date(dateMatch[1]);
          if (!isNaN(d.getTime())) created_at = Math.floor(d.getTime() / 1000);
        }

        events.push({
          content: contentMatch[1].trim(),
          tags,
          created_at,
        });
      }
    }
    return events;
  } catch {
    return [];
  }
}

function main() {
  const since = Math.floor(Date.now() / 1000) - HOURS * 3600;

  // Fetch recent kind-1 notes
  const raw = run([
    'cli', 'queryEvents',
    '--kinds', JSON.stringify([1]),
    '--since', String(since),
    '--limit', String(LIMIT),
    '--json',
  ]);

  const events = extractEvents(raw);

  if (events.length === 0) {
    console.log('# Nostr Pulse\n\nNo events fetched. Relays may be unreachable.');
    process.exit(0);
  }

  // Extract hashtags from tags (t-tags)
  const hashtagCounts = new Map<string, number>();
  const wordCounts = new Map<string, number>();
  const urlDomains = new Map<string, number>();

  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
    'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
    'where', 'why', 'how', 'all', 'both', 'each', 'few', 'more', 'most',
    'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same',
    'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and', 'or',
    'if', 'while', 'about', 'up', 'down', 'it', 'its', 'he', 'she',
    'they', 'them', 'their', 'this', 'that', 'these', 'those', 'i', 'me',
    'my', 'we', 'our', 'you', 'your', 'what', 'which', 'who', 'whom',
    'like', 'get', 'got', 'going', 'know', 'think', 'want', 'need',
    'make', 'way', 'well', 'also', 'back', 'even', 'new', 'now', 'one',
    'two', 'time', 'see', 'come', 'take', 'much', 'still', 'don\'t',
    'http', 'https', 'www', 'com', 'nostr', 'note', 'reply', 'root',
  ]);

  for (const ev of events) {
    // Hashtags from t-tags
    for (const tag of ev.tags) {
      if (tag[0] === 't' && tag[1]) {
        const ht = tag[1].toLowerCase();
        hashtagCounts.set(ht, (hashtagCounts.get(ht) || 0) + 1);
      }
    }

    // Word frequency from content
    const words = ev.content
      .replace(/https?:\/\/\S+/g, '')
      .replace(/nostr:\S+/g, '')
      .replace(/[^a-zA-Z\s]/g, '')
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w));

    for (const w of words) {
      wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
    }

    // URL domains
    const urls = ev.content.match(/https?:\/\/([^\s/]+)/g) || [];
    for (const url of urls) {
      try {
        const domain = new URL(url).hostname
          .replace(/^www\./, '')
          .replace(/^blossom\./, '')
          .replace(/^image\./, '')
          .replace(/^media\d*\./, '')
          .replace(/^cdn\./, '');
        // Skip media/image hosts
        if (/nostr\.build|giphy|twimg|primal\.net|sebastix/.test(domain)) continue;
        urlDomains.set(domain, (urlDomains.get(domain) || 0) + 1);
      } catch {}
    }
  }

  // Sort and take top entries
  const topHashtags = [...hashtagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  const topWords = [...wordCounts.entries()]
    .filter(([w]) => !hashtagCounts.has(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const topDomains = [...urlDomains.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  // Time distribution (hour buckets)
  const hourBuckets = new Map<number, number>();
  for (const ev of events) {
    const h = new Date(ev.created_at * 1000).getUTCHours();
    hourBuckets.set(h, (hourBuckets.get(h) || 0) + 1);
  }

  // Build output
  const now = new Date();
  const lines: string[] = [
    `# 🌐 Nostr Pulse — ${now.toISOString().slice(0, 16)} UTC`,
    ``,
    `Scanned **${events.length}** notes from the last ${HOURS}h across ${RELAYS.length} relays.`,
    ``,
  ];

  if (topHashtags.length) {
    lines.push('## 🔥 Trending Hashtags');
    for (const [tag, count] of topHashtags) {
      const bar = '█'.repeat(Math.min(Math.ceil(count / 2), 15));
      lines.push(`- **#${tag}** (${count}) ${bar}`);
    }
    lines.push('');
  }

  if (topWords.length) {
    lines.push('## 💬 Hot Words');
    lines.push(topWords.map(([w, c]) => `\`${w}\`(${c})`).join(' · '));
    lines.push('');
  }

  if (topDomains.length) {
    lines.push('## 🔗 Most Shared Domains');
    for (const [domain, count] of topDomains) {
      lines.push(`- ${domain} (${count})`);
    }
    lines.push('');
  }

  // Quick content samples for the top hashtag
  if (topHashtags.length) {
    const topTag = topHashtags[0][0];
    const samples = events
      .filter(ev => ev.tags.some(t => t[0] === 't' && t[1]?.toLowerCase() === topTag))
      .slice(0, 3)
      .map(ev => {
        const snippet = ev.content.replace(/https?:\/\/\S+/g, '').replace(/nostr:\S+/g, '').trim().slice(0, 120);
        return `> ${snippet}${ev.content.length > 120 ? '…' : ''}`;
      });

    if (samples.length) {
      lines.push(`## 📝 Sample notes (#${topTag})`);
      lines.push(...samples);
      lines.push('');
    }
  }

  console.log(lines.join('\n'));
}

main();