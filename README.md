# Nova Browser

An AI agentic browser: a full tabbed browser with AI **companions** in a sidebar that read the page you're on and can **act** on it (click, type, navigate, scroll), powered by Claude.

## Features
- Tabbed browsing (Ctrl+T new, Ctrl+W close, Ctrl+L address bar), back/forward/reload
- Smart address bar: URL, search, or `/your question` to ask Nova directly
- 5 companions: Assistant, Researcher, Sales, Writer, Analyst
- One-click actions: Summarize, Extract, Translate, Next steps, **Compare all open tabs**
- Agent mode: Nova runs up to 10 steps on its own (click/type/navigate/scroll) and shows each action
- Safety: never enters passwords/payments or makes purchases without your confirmation
- Your API key stays in the main process and is never sent to web pages

## Run
```bash
npm install
npm start
```
Then open ⚙ in the sidebar and paste your Anthropic API key.
