# SH Protection Shield

SH Protection Shield is a Discord security and community-management bot focused on server protection, moderation, automation, recovery, tickets, community utilities, and optional local AI support.

## Highlights

- Anti-nuke and anti-raid protection
- Bot, webhook, channel, and role protection
- Anti-spam and mass-mention protection
- Moderation, warnings, cases, and logs
- Server recovery tools
- Ticketing and community utilities
- Configurable welcome system
- Web dashboard
- Optional Ollama integration
- SQLite-backed configuration and data

Some modules are still evolving. Review the implementation before enabling a feature on an important production server.

## Requirements

- Node.js 20+
- npm
- A Discord application and bot token
- Ollama only if you want the optional AI functionality

## Setup

Install dependencies:

```bash
npm install
```

Create your local environment file:

```bash
cp .env.example .env
```

Fill in your own Discord credentials and configuration in `.env`, then start the bot:

```bash
npm start
```

For a production server, PM2 can be used:

```bash
pm2 start src/index.js --name sh-protection
pm2 save
```

## Discord configuration

Create an application in the Discord Developer Portal, add a bot, and enable the gateway intents required by the features you use.

Keep the bot token and client secret private. The OAuth redirect configured in Discord must exactly match `OAUTH_REDIRECT_URI`.

## Optional local AI

The example configuration expects Ollama at:

```text
http://127.0.0.1:11434
```

and uses:

```text
qwen3:0.6b
```

If Ollama runs on another computer, connect it through a trusted private connection such as an SSH tunnel or private network. Avoid exposing an unsecured Ollama endpoint to the public internet.

## Security

- Never commit `.env`.
- Test destructive-protection and recovery features in a separate Discord server first.
- Give the bot only the permissions required by the features you enable.
- Keep backups before deploying updates.
- Recovery is reactive and cannot guarantee that every destructive action can be reversed.
- Review audit logs and recovery results for important servers.

## Contributing

Issues, fixes, and improvements are welcome. Keep changes focused and document any new configuration variables.

## License

No license has been selected for this release. Before publishing the repository as open source, add the license you want to distribute it under (for example MIT, Apache-2.0, or GPL-3.0).
