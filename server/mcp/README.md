# ScanGym MCP Server 🏋️

**Book any gym, anywhere — from Claude, Cursor, or any MCP client.**

No memberships. Just flexible pay-per-session gym access through ScanGym.

<!-- mcp-name: io.github.mubarakpatelaithlete/scangym -->

## Tools

| Tool | Description |
|------|-------------|
| `search_gyms` | Search for gyms by location name or coordinates |
| `get_gym_details` | Get full details, pricing, hours, reviews, photos |
| `check_availability` | Check whether a gym is available for a date/time (read-only) |
| `reserve_gym_slot` | Hold a provisional day-pass slot (requires `confirmed=true`) |
| `cancel_booking` | Cancel a booking with automatic refund |

## Quick Start

### Install from npm

```bash
npm install -g @scangym/mcp-server   # not yet published to npm
```

### Claude Desktop Configuration

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "scangym": {
      "command": "npx",
      "args": ["-y", "@scangym/mcp-server"],
      "env": {
        "SCANGYM_API_URL": "https://scangym.com"
      }
    }
  }
}
```

### Run directly

```bash
SCANGYM_API_URL=https://scangym.com npx @scangym/mcp-server
```

## Example Usage

Once configured, you can ask Claude:

- *"Find gyms near me in Bolton"*
- *"What's the cheapest gym in Manchester?"*
- *"Book a day pass at Third Space for tomorrow"*
- *"Cancel my booking #12345"*

## How It Works

```
You: "Book me a gym in Bolton for tomorrow"
  ↓
Claude calls search_gyms("gym in Bolton")
  ↓
Shows top gyms ranked: closest → cheapest → highest rated → 24/7
  ↓
You pick one → Claude calls reserve_gym_slot
  ↓
You get a booking code + payment link → pay → get QR code for entry
```

## Ranking Algorithm

Gyms are ranked by:
1. **Closest** — nearest to your location
2. **Cheapest** — lowest day pass price
3. **Highest rated** — best Google & ScanGym reviews
4. **24/7 availability** — always-open gyms ranked higher

## Pricing

- Day passes from £3.99
- No memberships or subscriptions
- Free cancellation up to 2 hours before
- Referral codes for 15% off

## Links

- 🌐 Website: [scangym.com](https://scangym.com)
- 💬 ChatGPT GPT: [ScanGym on ChatGPT](https://chatgpt.com/g/g-6a2d42cd13e08191a65eebd2426bbe60-scangym)
- 📱 Telegram: [@ScanGymBot](https://t.me/ScanGymBot)
- 📞 WhatsApp: [+1 (318) 616-8331](https://wa.me/13186168331)

## License

MIT © [Mubarak Ibrahim Patel](https://scangym.com)
