import { productIdentity } from "./identity.ts";

// `avalok feedback`: prints a link to a prefilled GitHub issue form. Avalok sends nothing and does
// not open a browser; the person decides whether to follow the link and what to write. The link
// carries only the Avalok version, the Node version and the operating system, never a path,
// repository name, prompt or session.

export interface FeedbackEnvironment {
  version: string;
  node: string;
  platform: string;
  arch: string;
}

export function feedbackUrl(
  environment: FeedbackEnvironment,
  base: string = productIdentity.issuesUrl,
) {
  const parameters = new URLSearchParams({
    template: "feedback.yml",
    version: environment.version,
    node: environment.node,
    platform: `${environment.platform} ${environment.arch}`,
  });
  return `${base}?${parameters}`;
}

export function runFeedback(options: {
  output: { write(text: string): unknown };
  environment?: FeedbackEnvironment;
}) {
  const environment = options.environment ?? {
    version: productIdentity.version,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
  };
  options.output.write(
    [
      `Thanks for trying ${productIdentity.displayName}. Tell us what you expected and what happened:`,
      "",
      `  ${feedbackUrl(environment)}`,
      "",
      "The link only prefills the version, Node version and operating system. Nothing is sent",
      "until you submit the form on GitHub. Please do not paste private code, prompts or secrets.",
      "",
    ].join("\n"),
  );
  return 0;
}
