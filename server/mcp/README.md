# ScanGym MCP Server

Book a gym session from **Claude**, **Cursor**, or any AI assistant that supports [Model Context Protocol (MCP)](https://modelcontextprotocol.io/).

> "Book me a gym near Bolton for tomorrow" — and Claude does it.

## Quick Start

### Claude Desktop

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "scangym": {
      "command": "node",
      "args": ["/path/to/server/mcp/scangym-mcp-server.js"],
      "env": {
        "SCANGYM_API_URL": "https://scangym.com"
      }
    }
  }
}
```

Restart Claude Desktop. You'll see ScanGym tools in the 🔨 menu.

### Cursor / VS Code

Add to your MCP settings:

```json
{
  "scangym": {
    "command": "node",
    "args": ["/path/to/server/mcp/scangym-mcp-server.js"],
    "env": { "SCANGYM_API_URL": "https://scangym.com" }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `search_gyms` | Find gyms by location or coordinates |
| `get_gym_details` | Full details: pricing, hours, reviews, photos |
| `book_gym_session` | Book a day pass (creates booking + payment link) |
| `cancel_booking` | Cancel a booking (free up to 2h before) |

## Example Conversation

> **User:** Find gyms near Bolton and book the cheapest one for tomorrow  
> **Claude:** *calls search_gyms* → *calls get_gym_details* → *calls book_gym_session*  
> "I've booked you a day pass at PureGym Bolton for tomorrow. Your booking code is 5WCB-8VDY. Please complete payment here: [link]. After paying, you'll get a QR code for entry."

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SCANGYM_API_URL` | `https://scangym.com` | ScanGym API base URL |

## How It Works

```
User → Claude → MCP Server → ScanGym API → Booking Created
                                          → Payment Link Returned
                                          → QR Code After Payment
```

No authentication needed for searching. Booking uses guest checkout (email only).

## Requirements

- Node.js 18+
- No additional dependencies (uses built-in `fetch` and `readline`)
