import OpenAI from "openai";
import { Pool } from "pg";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const database = new Pool({ connectionString: process.env.DATABASE_URL });

export async function POST() {
  await database.query("select 1");
  return Response.json({ client: Boolean(client) });
}
