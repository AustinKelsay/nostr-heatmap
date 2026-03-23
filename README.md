# nostr-heatmap

Periodic Nostr trending topic heatmap. Scans recent kind-1 notes across multiple relays and outputs a markdown summary of trending hashtags, hot words, most-shared domains, and sample content.

Built on [nostr-agent-interface](https://github.com/AustinKelsay/nostr-agent-interface).

## Setup

```bash
# Clone nostr-agent-interface and build it
git clone https://github.com/AustinKelsay/nostr-agent-interface.git .cache/nostr-agent-interface
cd .cache/nostr-agent-interface && npm install && npm run build && cd ../..

# Run the heatmap
npx tsx scripts/nostr-heatmap.ts
```

## Output

Produces a markdown Nostr Pulse with:
- Trending hashtags with frequency bars
- Hot words
- Most shared domains
- Sample notes from the top hashtag

## Configuration

Edit the constants at the top of scripts/nostr-heatmap.ts:
- HOURS - lookback window (default: 6)
- LIMIT - max events to fetch (default: 200)
- RELAYS - relay list to query

## License

MIT
