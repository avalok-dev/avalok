# Import saved OpenAI Agents API traces

This is an offline import of the public Agents API session trace export. Avalok does not contact OpenAI. Trace export must first be enabled for your OpenAI organization, and the API key must belong to the session's project with `api.traces.read` or `api.agents.read` permission. See the [official tracing guide](https://developers.openai.com/api/docs/guides/agents-api/tracing) and [endpoint reference](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/subresources/traces/methods/list).

1. In OpenAI **Logs → Agents**, find the session and copy its `sess_...` ID. Wait until its turn finishes. Completed traces and usage can appear later.
2. In a private shell, set `OPENAI_API_KEY`. Download the first page, replacing the session ID:

   ```bash
   curl --fail-with-body \
     'https://api.openai.com/v1/agents/sessions/sess_123/traces?limit=20&order=asc' \
     -H "Authorization: Bearer $OPENAI_API_KEY" \
     -H 'OpenAI-Beta: agents=v1' \
     --output trace-page-1.json
   ```

3. Open that saved page. If `has_more` is `true`, use its `last_id` for the next request, keeping `order=asc`:

   ```bash
   after=$(jq -r '.last_id' trace-page-1.json)
   curl --fail-with-body \
     "https://api.openai.com/v1/agents/sessions/sess_123/traces?limit=20&order=asc&after=$after" \
     -H "Authorization: Bearer $OPENAI_API_KEY" \
     -H 'OpenAI-Beta: agents=v1' \
     --output trace-page-2.json
   ```

   Repeat with each new page's `last_id` until `has_more` is `false`. Save every page. These files contain trace data and may contain private inputs and outputs; keep them private.

4. Import all saved pages locally:

   ```bash
   avalok import openai trace-page-1.json trace-page-2.json
   ```

   From this repository, use `pnpm avalok import openai ...`. Start Avalok normally and select **Telemetry** to view each imported turn trace. Reimporting a page updates the same trace rather than adding another run. New pages or later exports can add spans or token counts.

The public response is a paginated list: each `data` item has a root turn ID, session ID, and an `otlp.resourceSpans` payload. The import command accepts that saved response directly. It does not require the intermediate bare OTLP file shown in OpenAI's provider export example. One trace becomes one Avalok run; session and turn IDs remain attached to its events.

Observed span counts and elapsed times describe only the exported spans. Missing spans, parent relationships, model IDs, and token usage remain unknown. Token counts are best effort, can change after a turn, and are not a final bill. Parent agent summaries and child generation spans are not added together. Explicit retry markers are counted separately from repeated calls, which may have other causes. The command makes no outbound request and persists a sanitized normalized copy in Avalok's local runtime data directory.

The public endpoint does not provide a per-span revision marker. When saved pages disagree on the same span's token count, Avalok keeps the largest observed count so an older page imported later cannot erase arrived usage. If OpenAI corrects a count downward, this import cannot identify that correction; clear the affected local runtime data and reimport a fresh complete export to replace it.
