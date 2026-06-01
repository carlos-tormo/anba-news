# NBA2K League Journalist Bot

A Discord bot for a 30-user NBA2K simulation league. It acts like a recurring league journalist: it DMs GMs with roleplay questions, records their answers, and publishes a daily news recap in a configured Discord channel.

## What It Does

- Registers GMs and their teams with slash commands.
- Sends recurring DM questions to random registered GMs.
- Records answers when GMs reply directly to the bot in DM.
- Publishes a daily league article from answered questions.
- Uses OpenAI for richer articles when `OPENAI_API_KEY` is configured.
- Falls back to a simple generated recap when no OpenAI key is present.
- Stores data locally in `data/league-journalist.json`.

## Setup

1. Create a Discord application and bot in the Discord Developer Portal.
2. Enable the bot's `Message Content Intent` under the bot settings. The bot needs this to read GM replies in DMs.
3. Invite the bot to your server with these scopes:
   - `bot`
   - `applications.commands`
4. Install dependencies:

```bash
npm install
```

5. Create your environment file:

```bash
cp .env.example .env
```

6. Fill in `.env` with your bot token. Add `DISCORD_GUILD_ID` while testing so commands register to your server quickly.

7. Run the bot:

```bash
npm run dev
```

## Slash Commands

`/gm set user:@User team:"Atlanta Hawks"`  
Registers or updates a GM.

`/gm remove user:@User`  
Removes a GM from the active pool.

`/gm list`  
Shows registered GMs.

`/journalist configure`  
Sets the news channel, daily question count, ask hour, publish hour, and timezone.

`/journalist ask-now`  
Immediately sends questions to a random sample of GMs, or to a specific GM.

`/journalist publish-now`  
Immediately publishes a news article from unposted answers.

`/journalist status`  
Shows the current bot configuration and pending answer counts.

## Recommended League Flow

1. Register all 30 GMs with `/gm set`.
2. Configure the news channel with `/journalist configure`.
3. Use `/journalist ask-now count:3` to test DMs.
4. Ask a few users to reply in DM.
5. Use `/journalist publish-now` to test the article output.
6. Leave the bot running for automatic daily questions and publishing.

## Railway Deployment

Deploy this repository as a Node.js service with this start command:

```bash
npm start
```

Set these Railway variables:

```env
DISCORD_TOKEN=your_raw_discord_bot_token
DISCORD_GUILD_ID=your_discord_server_id
JOURNALIST_NAME=The Association Insider
OPENAI_API_KEY=optional_openai_key
OPENAI_MODEL=gpt-5.4
```

`DISCORD_TOKEN` must be the bot token from Discord Developer Portal > Bot > Token. Do not use the client secret, public key, application ID, OAuth URL, quotes, or a leading `Bot ` prefix.

Keep the Railway service at one replica. Multiple replicas can send duplicate DMs and duplicate news posts.

## Notes

- Times use the configured timezone, defaulting to `Europe/Madrid`.
- The default schedule asks questions at 10:00 and publishes at 21:00.
- GMs with an unanswered active prompt are skipped by random selection to avoid piling up DMs.
- You can edit `config/questions.json` to match your league tone.
