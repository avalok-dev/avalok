import { describe, expect, it } from "vitest";
import {
  isAllowedLoopbackHost,
  isAllowedLoopbackOrigin,
  isJsonMediaType,
  parseHostHeader,
  parseOrigin,
} from "../src/index";

describe("Host validation", () => {
  it.each([
    ["127.0.0.1:4737", 4737],
    ["localhost:4737", 4737],
    ["LOCALHOST:4737", 4737],
    ["[::1]:4737", 4737],
    ["127.0.0.1:3000", 3000],
    ["localhost", 80],
  ])("accepts loopback %s on port %i", (host, port) => {
    expect(isAllowedLoopbackHost(host, { port })).toBe(true);
  });

  it.each([
    "attacker.example:4737",
    "attacker.example",
    "localhost.attacker.example:4737",
    "127.0.0.1.attacker.example:4737",
    "127.0.0.1.nip.io:4737",
    "attacker.example@127.0.0.1:4737",
    "127.0.0.1:4737@attacker.example",
    "127.0.0.2:4737",
    "0.0.0.0:4737",
    "192.168.1.20:4737",
    "[::ffff:127.0.0.1]:4737",
    "[0:0:0:0:0:0:0:1]:4737",
    "::1:4737",
    "localhost.:4737",
    "127.0.0.1:4737/path",
    "127.0.0.1 :4737",
    " 127.0.0.1:4737",
    "127.0.0.1:",
    "127.0.0.1:0",
    "127.0.0.1:65536",
    "127.0.0.1:99999999",
    "",
    "%31%32%37.0.0.1:4737",
  ])("rejects %j", (host) => {
    expect(isAllowedLoopbackHost(host, { port: 4737 })).toBe(false);
  });

  it("rejects a missing Host header", () => {
    expect(isAllowedLoopbackHost(undefined, { port: 4737 })).toBe(false);
    expect(isAllowedLoopbackHost(null)).toBe(false);
  });

  it("rejects the wrong port, including an omitted port that implies 80", () => {
    expect(isAllowedLoopbackHost("127.0.0.1:4318", { port: 4737 })).toBe(false);
    expect(isAllowedLoopbackHost("localhost", { port: 4737 })).toBe(false);
  });

  it("checks only the hostname when the actual port is unknown", () => {
    expect(isAllowedLoopbackHost("localhost:3001")).toBe(true);
    expect(isAllowedLoopbackHost("attacker.example:3001")).toBe(false);
  });

  it("parses bracketed IPv6 and lower-cases hostnames", () => {
    expect(parseHostHeader("[::1]:9")).toEqual({ hostname: "::1", port: 9 });
    expect(parseHostHeader("LocalHost")).toEqual({ hostname: "localhost", port: undefined });
  });
});

describe("Origin validation", () => {
  it.each([
    "http://127.0.0.1:4737",
    "http://localhost:4737",
    "http://[::1]:4737",
    "http://LOCALHOST:4737",
  ])("accepts the same loopback server %s", (origin) => {
    expect(isAllowedLoopbackOrigin(origin, { port: 4737 })).toBe(true);
  });

  it.each([
    "https://attacker.example",
    "http://attacker.example",
    "http://attacker.example:4737",
    "http://localhost.attacker.example:4737",
    "http://127.0.0.1.attacker.example:4737",
    "https://127.0.0.1:4737",
    "http://127.0.0.1:8080",
    "http://127.0.0.1",
    "null",
    "file://",
    "chrome-extension://abcdef",
    "http://127.0.0.1:4737/",
    "http://127.0.0.1:4737/path",
    "http://user@127.0.0.1:4737",
    "",
  ])("rejects %j for port 4737", (origin) => {
    expect(isAllowedLoopbackOrigin(origin, { port: 4737 })).toBe(false);
  });

  it("allows any loopback port only when asked to", () => {
    expect(isAllowedLoopbackOrigin("http://localhost:5173", { port: "any" })).toBe(true);
    expect(isAllowedLoopbackOrigin("http://localhost:5173", { port: 4318 })).toBe(false);
    expect(isAllowedLoopbackOrigin("https://attacker.example", { port: "any" })).toBe(false);
    expect(isAllowedLoopbackOrigin("null", { port: "any" })).toBe(false);
  });

  it("never parses the opaque null origin", () => {
    expect(parseOrigin("null")).toBeUndefined();
    expect(parseOrigin("http://[::1]:1")).toEqual({ scheme: "http", hostname: "::1", port: 1 });
  });
});

describe("media types", () => {
  it.each(["application/json", "Application/JSON", "application/json; charset=utf-8"])(
    "treats %j as JSON",
    (value) => expect(isJsonMediaType(value)).toBe(true),
  );

  it.each([
    "text/plain",
    "text/plain; charset=application/json",
    "application/x-www-form-urlencoded",
    "multipart/form-data; boundary=x",
    "application/json-patch+json",
    "",
    undefined,
  ])("does not treat %j as JSON", (value) => expect(isJsonMediaType(value)).toBe(false));
});
