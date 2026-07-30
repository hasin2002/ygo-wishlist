import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensions = [".ts", ".tsx", ".js", ".mjs"];

async function existingFile(candidate) {
  for (const extension of extensions) {
    const file = `${candidate}${extension}`;
    try {
      await access(file);
      return file;
    } catch {}
  }
  for (const extension of extensions) {
    const file = path.join(candidate, `index${extension}`);
    try {
      await access(file);
      return file;
    } catch {}
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  // Next substitutes this marker during its server build. Router integration
  // tests run directly in Node and have no client bundle, so the marker is a
  // harmless no-op there.
  if (specifier === "server-only") {
    return { shortCircuit: true, url: "data:text/javascript,export%20default%20undefined" };
  }
  if (specifier === "next/headers") {
    return { shortCircuit: true, url: "data:text/javascript,export%20async%20function%20headers()%7Breturn%20new%20Headers()%7D" };
  }
  if (specifier === "next/server") {
    return nextResolve("next/server.js", context);
  }
  if (specifier.startsWith("@/")) {
    const file = await existingFile(path.join(root, "src", specifier.slice(2)));
    if (file) return { shortCircuit: true, url: pathToFileURL(file).href };
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !path.extname(specifier)) {
    const parent = fileURLToPath(context.parentURL);
    const file = await existingFile(path.resolve(path.dirname(parent), specifier));
    if (file) return { shortCircuit: true, url: pathToFileURL(file).href };
  }
  return nextResolve(specifier, context);
}
