export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    {
      status: "ok",
      cli: process.env.AVALOK_CLI_MODE === "1",
      // `avalok demo`: open the built-in demo instead of the repository landing.
      demo: process.env.AVALOK_DEMO === "1",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
