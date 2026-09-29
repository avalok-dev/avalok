export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    {
      status: "ok",
      cli: process.env.SARVADRIK_CLI_MODE === "1",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
