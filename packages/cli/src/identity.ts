import manifest from "../package.json" with { type: "json" };
import product from "../product.json" with { type: "json" };

// The single identity boundary. `product.json` holds the product name, CLI name, package name,
// and public metadata; `package.json#version` is the only version. Bundling inlines both files.
export const productIdentity = Object.freeze({
  displayName: product.displayName,
  cliName: product.cliName,
  packageName: product.packageName,
  tagline: product.tagline,
  description: product.description,
  homepage: product.homepage,
  repository: product.repository as string | null,
  legacyDataDirectoryName: product.legacyDataDirectoryName,
  version: manifest.version,
});
