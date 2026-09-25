import { loadCodexSessionById } from "@visual-system/codex-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const data = await loadCodexSessionById(id);
    if (!data) return Response.json({ error: "Session not found." }, { status: 404 });
    const session = Object.fromEntries(
      Object.entries(data.session).filter(([key]) => key !== "filePath"),
    );
    return Response.json({ ...data, session });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load the Codex session." },
      { status: 500 },
    );
  }
}
