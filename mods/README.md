# Claude Code mods

Eight Claude Code mods (function-hook plugins) that change how Claude Code's interface looks and behaves. This repository is also a plugin marketplace (`.claude-plugin/marketplace.json`), so you can install each mod with one line.

## Install

At a Claude Code prompt:

```
/plugin install <mod> --marketplace jacattac314/freellmapi-hermes-agent-
```

Answer `y` to add the marketplace, then pick a scope.

## The mods

| Mod | What it does | Use |
|---|---|---|
| `savvy-progress` | A progress bar for running subagents, and a pane with each subagent's status, time and tokens, tokens per model, and session cost | `/progress` |
| `skins` | Color themes for the desktop and mobile apps: paper, nord, forest, synthwave. The choice persists | `/skin <name>`, `/skin default` |
| `you-should-know` | Haiku reads each long answer in the background and flags critical items: skipped steps, failures, manual actions, risks | `/ysk on\|off\|show` |
| `file-tree` | A live tree of the files Claude has read or edited, with the active file highlighted | `/files` |
| `cache-tax` | Prompt-cache hit rate per turn, input cost saved, and a warning when a large prompt prefix is re-cached | band above the prompt, `/cache-tax` |
| `blast-radius` | Asks for confirmation before destructive shell commands (`rm -rf`, force push, `reset --hard`, DROP TABLE, `curl \| sh`, …) | automatic |
| `reflect` | Saves feedback as standing rules that go into the system prompt of every session | `/reflect <rule>`, `/reflect list`, `/reflect forget <n>` |
| `replay-theater` | Records every Edit and Write and lets you step through them as diffs | `/replay` |

## Notes

- `you-should-know` makes one small Haiku call per answer longer than 300 characters. Turn it off with `/ysk off`.
- Themes from `skins` show only in the desktop and mobile apps; the terminal draws none.
- `blast-radius` matches a list of regexes. Add your own to `RULES` in `mods/blast-radius/hooks/register.tsx`.
- Validate with `claude plugin validate mods/<mod>`. Run the tests with `claude plugin test mods/<mod>`.
