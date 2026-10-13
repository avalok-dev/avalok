# User tests (L6): script and measurements

Goal: before announcing, 10 developers who use Claude Code or Codex daily install the release candidate and try it on their own repository, while you watch where they hesitate. Launch only when most of them get a map and an export without help.

## Recruiting

Ask people you know, and ask in a community you belong to (say it is an early alpha and you want to watch them use it). Skip anyone who cannot use a coding agent daily. Aim for a mix of Claude Code and Codex, macOS, and at least two on Windows or Linux. Offer 30 minutes. Do not explain the product first.

## Before the session

- Send only the install command and the version. Do not send a walkthrough.
- Ask permission to screen-record and take notes. Say they can stop any time and skip anything they do not want on screen. Tell them not to share private code; any repository will do.
- Keep notes in a private file, **not in this repository**.

## Session (30 minutes)

1. **Context (3 min).** Which agent do you use? What did you last use it for? (Do not mention Avalok features.)
2. **Install and first run (10 min).** "Please install this and open it on a project where you have used your agent." Say nothing unless they are stuck for more than two minutes; then note exactly where, and help. Record the time to the first map.
3. **Explore (7 min).** "What do you see? What do you think it is telling you?" Ask them to think aloud.
4. **Share (5 min).** "Imagine you want to show a teammate what the agent did. Show me how." Record whether they find Share or `avalok recap` unaided, and the time to the first export.
5. **Questions (5 min).** Ask all of these and write the answers word for word:
   - What were you trying to do? What did you expect to see?
   - What surprised you? What was confusing?
   - Would you be upset if this disappeared tomorrow? Why or why not?
   - Who else should see this?
   - What would make your team pay for it? (Listen; do not pitch.)

## What to record per tester

| Measure                                          | How                                                        |
| ------------------------------------------------ | ---------------------------------------------------------- |
| Install succeeded without help (yes/no)          | You did not need to intervene                              |
| Time to first map                                | From pasting the command to seeing a map                   |
| Landed on a session, or only the map             | Did a session from this repository open?                   |
| Time to first export                             | From the map to a saved recap, replay or diagram           |
| Exported something (yes/no)                      | Any format                                                 |
| First hesitation or wrong turn                   | Where, and what they said                                  |
| Would miss it (strongly / somewhat / not at all) | The "upset if it disappeared" answer                       |
| Came back the next day (yes/no)                  | Message them the next day; ask only whether they opened it |
| Platform, Node version, agent                    | For debugging                                              |

Testers can run `avalok feedback` at the end to leave anything else; it prints a link and sends nothing.

## Deciding

Fix the top three blockers by frequency. Re-test the fixes with two new people. Launch when most testers got a map and an export without help and several say they would miss it. If not, do not announce; change something and test again.

## Privacy of the tests

Do not store recordings in the repository. Delete recordings once you have notes, unless the tester agrees to keep them. Never copy a tester's code, prompts or paths into an issue.
