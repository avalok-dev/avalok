# Blog outline: "What 100 agent sessions did to my codebase"

Write this only from real data. The point of the post is the findings; the tool is the method.

1. **The question.** After an agent session, the diff tells you files, not systems. What did sessions actually do?
2. **Method.** Which repository, which agent(s), how many sessions, what period. [FILL: real numbers.] Counts come from `avalok wrapped` and `avalok recap`; say they are observed steps, not intent.
3. **What I found.** Candidates to check against your real data before writing (delete any you cannot show):
   - Where time went (commands, tests, waiting). Use the "where the time went" lists.
   - How often steps failed and were retried.
   - Which services were touched most, and whether any surprised you.
   - Sessions that changed code with no test activity observed (needs the touched-but-not-tested insight; today it is only visible by reading the recap).
4. **What the tool got wrong.** Honest section: map mismatches, things marked "not observed". People trust this section most.
5. **How to try it.** `npx avalok`, `avalok recap`, `avalok wrapped`. Local and open source.
6. **Privacy note.** What was shared in the post and how it was anonymized (`--anonymize`).

Include one real recap card and one replay link or GIF. Review every image for names and paths before publishing.
