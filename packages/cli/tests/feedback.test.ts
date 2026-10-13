import { describe, expect, it } from "vitest";
import { feedbackUrl, runFeedback } from "../src/feedback";
import { parseCliOptions } from "../src/options";

const environment = {
  version: "0.1.0-alpha.1",
  node: "22.12.0",
  platform: "darwin",
  arch: "arm64",
};

describe("avalok feedback", () => {
  it("parses as its own command", () => {
    expect(parseCliOptions(["feedback"]).command).toBe("feedback");
  });

  it("builds a prefilled issue-form link with only version, node and platform", () => {
    const url = new URL(feedbackUrl(environment, "https://github.com/example/repo/issues/new"));
    expect(url.origin + url.pathname).toBe("https://github.com/example/repo/issues/new");
    expect([...url.searchParams.keys()].sort()).toEqual([
      "node",
      "platform",
      "template",
      "version",
    ]);
    expect(url.searchParams.get("template")).toBe("feedback.yml");
    expect(url.searchParams.get("platform")).toBe("darwin arm64");
  });

  it("prints the link, says nothing is sent, and exits 0", () => {
    let text = "";
    expect(
      runFeedback({ output: { write: (chunk: string) => (text += chunk) }, environment }),
    ).toBe(0);
    expect(text).toContain("https://github.com/");
    expect(text).toContain("Nothing is sent");
  });

  it("never includes the working directory, home directory or user name", () => {
    let text = "";
    runFeedback({ output: { write: (chunk: string) => (text += chunk) } });
    for (const private_ of [process.cwd(), process.env.HOME ?? "\0", process.env.USER ?? "\0"])
      expect(text).not.toContain(private_);
  });
});
