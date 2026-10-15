import Fastify from "fastify";
Fastify().get("/health", async () => ({ ok: true }));
