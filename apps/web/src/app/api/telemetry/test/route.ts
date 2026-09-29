export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const port = Number(process.env.SARVADRIK_OTLP_PORT || 4318);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/sarvadrik/test-trace`, {
      method: "POST",
      // The receiver only accepts JSON here so a web page cannot trigger it with a simple POST.
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(2_000),
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(body.error ?? `Receiver returned HTTP ${response.status}.`);
    return Response.json(body);
  } catch (error) {
    return Response.json(
      {
        error: `Test trace was not received. ${error instanceof Error ? error.message : "Receiver unavailable."}`,
      },
      { status: 503 },
    );
  }
}
