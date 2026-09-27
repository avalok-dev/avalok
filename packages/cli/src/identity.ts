import manifest from "../package.json" with { type: "json" };
import product from "../product.json" with { type: "json" };

// The single identity boundary. `product.json` holds the provisional, reversible naming;
// `package.json#version` is the only version. Bundling inlines both files.
export const productIdentity = Object.freeze({
  displayName: product.displayName,
  cliName: product.cliName,
  packageName: product.packageName,
  description: product.description,
  legacyDataDirectoryName: product.legacyDataDirectoryName,
  version: manifest.version,
});
