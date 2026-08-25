import { lstat, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  assertNoOperatorData,
  assertWoff2,
  classifyPublicArtifact,
  matchApprovedRaster,
  parseBinaryManifest,
  runPrivacyGuardSelfTest,
  sha256,
} from "./privacy-guard.mjs";

const mode = process.argv[2];
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const siteRoot = path.join(repositoryRoot, "site");
const outputRoot = path.join(siteRoot, ".vitepress", "dist");
const binaryManifestPath = "tools/docs/public-binaries.json";

const requiredInputs = [
  "docs/self-hosting.md",
  "docs/assets/open-sublists-dashboard-prototype-web.png",
  "docs/assets/open-sublists-logo.png",
  "site/.vitepress/config.mts",
  "site/index.md",
  "site/guide/self-hosting.md",
  "site/public/open-sublists-logo.png",
  binaryManifestPath,
];

async function requireFile(relativePath) {
  const absolutePath = path.join(repositoryRoot, relativePath);
  const metadata = await lstat(absolutePath).catch(() => null);
  if (metadata === null || !metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Required documentation input is missing or invalid: ${relativePath}`);
  }
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(absolutePath)));
    else files.push(absolutePath);
  }
  return files;
}

async function validateInputs() {
  await Promise.all(requiredInputs.map(requireFile));

  const manifest = parseBinaryManifest(
    await readFile(path.join(repositoryRoot, binaryManifestPath), "utf8"),
  );
  for (const entry of manifest) {
    const bytes = await readFile(path.join(repositoryRoot, entry.source));
    if (sha256(bytes) !== entry.sha256) {
      throw new Error(`Reviewed raster hash no longer matches its source: ${entry.source}`);
    }
  }

  for (const relativePath of requiredInputs.filter(
    (value) => !/\.(?:avif|gif|ico|jpe?g|png|webp)$/i.test(value),
  )) {
    assertNoOperatorData(await readFile(path.join(repositoryRoot, relativePath), "utf8"));
  }

  const includePage = await readFile(path.join(siteRoot, "guide", "self-hosting.md"), "utf8");
  if (!includePage.includes("<!--@include: ../../docs/self-hosting.md-->")) {
    throw new Error("The public self-hosting page must include docs/self-hosting.md.");
  }

  const siteFiles = await walk(siteRoot);
  const rootCname = await lstat(path.join(repositoryRoot, "CNAME")).catch(() => null);
  if (
    rootCname !== null ||
    siteFiles.some((file) => path.basename(file).toLowerCase() === "cname")
  ) {
    throw new Error("A CNAME file is not allowed; this site uses the default project URL.");
  }
}

async function validateOutput() {
  const outputMetadata = await lstat(outputRoot).catch(() => null);
  if (outputMetadata === null || !outputMetadata.isDirectory() || outputMetadata.isSymbolicLink()) {
    throw new Error("The Pages output root is missing or is not a regular directory.");
  }

  const requiredOutputFiles = ["index.html", "guide/self-hosting.html", "sitemap.xml"];
  await Promise.all(
    requiredOutputFiles.map(async (relativePath) => {
      const absolutePath = path.join(outputRoot, relativePath);
      const metadata = await lstat(absolutePath).catch(() => null);
      if (metadata === null || !metadata.isFile() || metadata.isSymbolicLink()) {
        throw new Error(`Required documentation output is missing: ${relativePath}`);
      }
    }),
  );

  const manifest = parseBinaryManifest(
    await readFile(path.join(repositoryRoot, binaryManifestPath), "utf8"),
  );
  const matchedRasters = new Map(manifest.map((entry) => [entry.source, 0]));
  const outputFiles = await walk(outputRoot);
  for (const file of outputFiles) {
    const metadata = await lstat(file);
    const relativePath = path.relative(outputRoot, file).split(path.sep).join("/");
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink > 1) {
      throw new Error(`The Pages artifact cannot contain links or non-files: ${relativePath}`);
    }

    const kind = classifyPublicArtifact(relativePath);
    const bytes = await readFile(file);
    if (kind === "text") {
      const text = bytes.toString("utf8");
      if (text.includes("\u0000") || text.includes("\uFFFD")) {
        throw new Error(`A text artifact is not valid plain UTF-8 text: ${relativePath}`);
      }
      assertNoOperatorData(text);
    } else if (kind === "raster") {
      const entry = matchApprovedRaster(bytes, relativePath, manifest);
      matchedRasters.set(entry.source, (matchedRasters.get(entry.source) ?? 0) + 1);
    } else {
      assertWoff2(bytes, relativePath);
    }
  }

  for (const entry of manifest) {
    if (matchedRasters.get(entry.source) !== 1) {
      throw new Error(`Reviewed raster must appear exactly once: ${entry.source}`);
    }
  }

  const [homeHtml, selfHostingHtml, sitemap] = await Promise.all([
    readFile(path.join(outputRoot, "index.html"), "utf8"),
    readFile(path.join(outputRoot, "guide", "self-hosting.html"), "utf8"),
    readFile(path.join(outputRoot, "sitemap.xml"), "utf8"),
  ]);

  if (!homeHtml.includes("/SubList/assets/")) {
    throw new Error("The generated home page is not using the /SubList/ asset base path.");
  }
  if (
    !homeHtml.includes("OpenSubLists Dashboard showing estimated totals") ||
    !outputFiles.some((file) =>
      path.basename(file).startsWith("open-sublists-dashboard-prototype-web."),
    )
  ) {
    throw new Error("The selected Dashboard image is missing from the generated home page.");
  }
  if (!selfHostingHtml.includes("Self-host OpenSubLists on Cloudflare")) {
    throw new Error("The canonical self-hosting guide was not rendered into the public site.");
  }
  if (selfHostingHtml.includes("@include:")) {
    throw new Error("An unresolved Markdown include remains in the generated guide.");
  }
  if (
    !sitemap.includes("https://hansarnold.github.io/SubList/") ||
    !sitemap.includes("https://hansarnold.github.io/SubList/guide/self-hosting")
  ) {
    throw new Error("The sitemap does not contain the expected GitHub Pages project URLs.");
  }
}

try {
  runPrivacyGuardSelfTest();

  if (mode === "inputs") await validateInputs();
  else if (mode === "output") await validateOutput();
  else if (mode !== "self-test") {
    throw new Error("Usage: node tools/docs/validate-site.mjs <inputs|output|self-test>");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
