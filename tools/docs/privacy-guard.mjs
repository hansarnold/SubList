import { createHash } from "node:crypto";
import path from "node:path";

const textExtensions = new Set([".css", ".html", ".js", ".json", ".xml"]);
const rasterExtensions = new Set([".avif", ".gif", ".ico", ".jpeg", ".jpg", ".png", ".webp"]);
const publicExtensions = new Set([...textExtensions, ...rasterExtensions, ".woff2"]);

const forbiddenArtifactParts = new Set([
  "7z",
  "bak",
  "backup",
  "br",
  "conf",
  "config",
  "crt",
  "db",
  "dump",
  "env",
  "gz",
  "ini",
  "jsonc",
  "key",
  "log",
  "map",
  "old",
  "orig",
  "p12",
  "pem",
  "pfx",
  "private",
  "sql",
  "sqlite",
  "sqlite3",
  "swp",
  "tar",
  "text",
  "tmp",
  "toml",
  "txt",
  "yaml",
  "yml",
  "zip",
]);

const allowedHosts = new Set([
  "127.0.0.1",
  "[::1]",
  "a.com",
  "api.iconify.design",
  "developers.cloudflare.com",
  "docs.github.com",
  "docsearch.algolia.com",
  "example.cloudflareaccess.com",
  "example.invalid",
  "example.net",
  "github.com",
  "hansarnold.github.io",
  "localhost",
  "notify.example.com",
  "preview.example.com",
  "sublist.example.com",
  "vitepress.dev",
  "vuejs.github.io",
  "vuejs.org",
  "workers.dev",
  "www.google.com",
  "www.sitemaps.org",
  "www.w3.org",
]);

// Limiting bare names to real/public or deliberately private suffixes avoids treating
// minified JavaScript property chains such as `object.call` as hostnames.
const monitoredHostnameSuffixes = new Set([
  "ai",
  "app",
  "biz",
  "cloud",
  "cn",
  "co",
  "com",
  "corp",
  "de",
  "design",
  "dev",
  "edu",
  "gov",
  "home",
  "info",
  "internal",
  "invalid",
  "io",
  "jp",
  "lan",
  "local",
  "me",
  "mil",
  "net",
  "online",
  "org",
  "sh",
  "site",
  "tech",
  "test",
  "uk",
  "us",
  "xyz",
]);

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseBinaryManifest(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("The public binary manifest is not valid JSON.");
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    parsed.schemaVersion !== 1 ||
    !Array.isArray(parsed.rasters)
  ) {
    throw new Error("The public binary manifest must use schemaVersion 1 and contain rasters[].");
  }

  const entries = parsed.rasters.map((entry, index) => {
    if (
      entry === null ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      typeof entry.source !== "string" ||
      typeof entry.outputBasename !== "string" ||
      typeof entry.sha256 !== "string"
    ) {
      throw new Error(`Invalid raster entry at public binary manifest index ${index}.`);
    }
    if (Object.keys(entry).sort().join(",") !== "outputBasename,sha256,source") {
      throw new Error(`Unexpected field in public binary manifest raster index ${index}.`);
    }

    const source = path.posix.normalize(entry.source);
    const extension = path.posix.extname(source).toLowerCase();
    if (
      source !== entry.source ||
      source.startsWith("../") ||
      source.startsWith("/") ||
      !rasterExtensions.has(extension)
    ) {
      throw new Error(`Unsafe raster source in public binary manifest index ${index}.`);
    }
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(entry.outputBasename)) {
      throw new Error(`Unsafe raster output basename in public binary manifest index ${index}.`);
    }
    if (!/^[0-9a-f]{64}$/.test(entry.sha256)) {
      throw new Error(`Invalid SHA-256 in public binary manifest index ${index}.`);
    }
    return { source, outputBasename: entry.outputBasename, extension, sha256: entry.sha256 };
  });

  if (entries.length === 0) {
    throw new Error("The public binary manifest must approve at least one raster.");
  }
  if (new Set(entries.map((entry) => entry.source)).size !== entries.length) {
    throw new Error("The public binary manifest contains a duplicate raster source.");
  }
  if (
    new Set(entries.map((entry) => `${entry.outputBasename}${entry.extension}`)).size !==
    entries.length
  ) {
    throw new Error("The public binary manifest contains a duplicate raster output name.");
  }
  return entries;
}

export function classifyPublicArtifact(relativePath) {
  const normalized = relativePath.split(path.sep).join("/");
  const pathParts = normalized.toLowerCase().split("/");
  const basename = pathParts.at(-1) ?? "";
  const dottedParts = basename.split(".");
  const extension = path.posix.extname(basename).toLowerCase();

  if (
    basename.startsWith(".") ||
    pathParts.some((part) => part.startsWith(".env")) ||
    [...pathParts.slice(0, -1), ...dottedParts.slice(0, -1)].some((part) =>
      forbiddenArtifactParts.has(part),
    )
  ) {
    throw new Error(`Private, backup, or configuration artifact is not publishable: ${normalized}`);
  }
  if (!publicExtensions.has(extension)) {
    throw new Error(`Pages artifact has an unapproved public extension: ${normalized}`);
  }
  if (textExtensions.has(extension)) return "text";
  if (rasterExtensions.has(extension)) return "raster";
  return "font";
}

function canonicalizeText(text) {
  return text
    .replace(/\\u002f/gi, "/")
    .replaceAll("\\/", "/")
    .replace(/&#x0*2f;/gi, "/")
    .replace(/&#0*47;/g, "/")
    .replaceAll("&amp;", "&")
    .replace(/&quot;|&#0*34;|&#x0*22;/gi, '"')
    .replace(/&apos;|&#0*39;|&#x0*27;/gi, "'");
}

function hostnameFromUrl(value) {
  try {
    const cleaned = value.replace(/[),.;\]}]+$/g, "");
    return new URL(cleaned.startsWith("//") ? `https:${cleaned}` : cleaned).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function collectHostnames(text) {
  const canonical = canonicalizeText(text);
  const candidates = new Set();
  for (const match of canonical.matchAll(/https?:\/\/[^\s"'<>`\\]+/gi)) {
    const hostname = hostnameFromUrl(match[0]);
    if (hostname !== null) candidates.add(hostname);
  }
  for (const match of canonical.matchAll(
    /\/\/(?:\[[0-9a-f:]+\]|(?:[a-z0-9-]+\.)+[a-z]{2,63}|localhost|(?:\d{1,3}\.){3}\d{1,3}|[a-z][a-z0-9-]{1,62})(?::\d+)?(?=[/\s"'<>`]|$)/gi,
  )) {
    const hostname = hostnameFromUrl(match[0]);
    if (hostname !== null) candidates.add(hostname);
  }
  for (const match of canonical.matchAll(
    /(?<![a-z0-9_.-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?![a-z0-9_-])/gi,
  )) {
    const hostname = match[0].toLowerCase();
    const labels = hostname.split(".");
    const followingText = canonical.slice((match.index ?? 0) + match[0].length);
    if (
      !/^\s*\(/.test(followingText) &&
      monitoredHostnameSuffixes.has(labels.at(-1)) &&
      labels.slice(0, -1).some((label) => label.length >= 2)
    ) {
      candidates.add(hostname);
    }
  }
  for (const match of canonical.matchAll(/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g)) {
    candidates.add(match[0]);
  }
  for (const match of canonical.matchAll(/\[(?:[0-9a-f]{0,4}:){2,}[0-9a-f]{0,4}\]/gi)) {
    candidates.add(match[0].toLowerCase());
  }
  return candidates;
}

function assertApprovedHostnames(text) {
  for (const hostname of collectHostnames(text)) {
    if (!allowedHosts.has(hostname)) {
      throw new Error(`An unapproved public-documentation hostname was rendered: ${hostname}`);
    }
  }
}

function redactWebUrlLocations(text) {
  const preserveLength = (value) => " ".repeat(value.length);
  return text
    .replace(/https?:\/\/[^\s"'<>`\\]+/gi, preserveLength)
    .replace(/\b(?:action|href|poster|src)\s*=\s*(["'])\/(?!\/).*?\1/gi, preserveLength)
    .replace(/\burl\(\s*(["']?)\/(?!\/).*?\1\s*\)/gi, preserveLength);
}

function assertNoLocalPaths(text) {
  const canonical = canonicalizeText(text);
  if (/\b(?:file|vscode):\/\//i.test(canonical)) {
    throw new Error("A local absolute filesystem path leaked into the Pages artifact.");
  }
  const withoutWebLocations = redactWebUrlLocations(canonical);
  const posixPatterns = [
    /\/Users\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._~+ -]+)*/,
    /\/home\/[A-Za-z0-9._-]+\/[A-Za-z0-9._~+ -]+/,
    /\/private\/(?:tmp|var)(?:\/[A-Za-z0-9._~+ -]+)+/,
    /\/var\/(?:folders|tmp)(?:\/[A-Za-z0-9._~+ -]+)+/,
    /\/tmp(?:\/[A-Za-z0-9._~+ -]+)+/,
    /\/root(?:\/[A-Za-z0-9._~+ -]+)+/,
    /\/Volumes\/[A-Za-z0-9._~+ -]+(?:\/[A-Za-z0-9._~+ -]+)*/,
  ];
  if (posixPatterns.some((pattern) => pattern.test(withoutWebLocations))) {
    throw new Error("A local absolute filesystem path leaked into the Pages artifact.");
  }
  if (/[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\s"'<>]+/i.test(canonical)) {
    throw new Error("A local absolute filesystem path leaked into the Pages artifact.");
  }
  if (/\\\\[A-Za-z0-9][A-Za-z0-9._-]{1,62}\\[A-Za-z0-9$][A-Za-z0-9 $._-]{0,79}/.test(canonical)) {
    throw new Error("A local UNC filesystem path leaked into the Pages artifact.");
  }
}

function looksLikePlaceholder(value) {
  const normalized = value.toLowerCase();
  return (
    /^(?:0+|x+|\*+)$/.test(normalized) ||
    ["example", "placeholder", "replace", "sample", "test-only", "your-", "your_"].some((marker) =>
      normalized.includes(marker),
    )
  );
}

function shannonEntropy(value) {
  const counts = new Map();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function assertNoSecretTokens(text) {
  const canonical = canonicalizeText(text);
  const plainText = canonical.replace(/<[^>]*>/g, " ");
  if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(canonical)) {
    throw new Error("Private-key material leaked into the Pages artifact.");
  }
  if (/eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/.test(canonical)) {
    throw new Error("A JWT-shaped value leaked into the Pages artifact.");
  }
  if (
    /\b(?:AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk_live_[A-Za-z0-9]{16,})\b/.test(
      canonical,
    )
  ) {
    throw new Error("A provider credential leaked into the Pages artifact.");
  }
  for (const match of canonical.matchAll(/\bBearer\s+([A-Za-z0-9._~+/=-]{16,})/gi)) {
    if (!looksLikePlaceholder(match[1])) {
      throw new Error("A bearer credential leaked into the Pages artifact.");
    }
  }
  const namedSecret =
    /\b(?:api[_ -]?key|api[_ -]?token|access[_ -]?token|client[_ -]?secret|password|policy[_ -]?aud|secret(?:[_ -]?key)?)["']?\s*(?::|=)\s*["']?([A-Za-z0-9._~+/=-]{12,})/gi;
  for (const match of plainText.matchAll(namedSecret)) {
    if (!looksLikePlaceholder(match[1])) {
      throw new Error("A configured secret or Access audience leaked into the Pages artifact.");
    }
  }
  for (const match of canonical.matchAll(
    /(?<![A-Za-z0-9_-])([A-Za-z0-9_-]{32,128})(?![A-Za-z0-9_-])/g,
  )) {
    const token = match[1];
    if (
      /[a-z]/.test(token) &&
      /[A-Z]/.test(token) &&
      /\d/.test(token) &&
      shannonEntropy(token) >= 4.5 &&
      !looksLikePlaceholder(token)
    ) {
      throw new Error("A high-entropy credential-shaped value leaked into the Pages artifact.");
    }
  }
}

export function assertNoOperatorData(text) {
  assertNoLocalPaths(text);
  assertNoSecretTokens(text);

  const approvedPlaceholderEmails = new Set([
    "owner@example.net",
    "reminders@example.invalid",
    "reminders@notify.example.com",
  ]);
  const emailAddresses = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  if (emailAddresses.some((address) => !approvedPlaceholderEmails.has(address.toLowerCase()))) {
    throw new Error("An email address leaked into the Pages artifact; use a prose placeholder.");
  }
  const exampleUuid = "00000000-0000-0000-0000-000000000000";
  const uuids = text.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi) ?? [];
  if (uuids.some((value) => value.toLowerCase() !== exampleUuid)) {
    throw new Error("A non-placeholder UUID leaked into the Pages artifact.");
  }
  if (/sourceMappingURL\s*=|["']sourcesContent["']\s*:/i.test(text)) {
    throw new Error("Source-map material leaked into the Pages artifact.");
  }
  assertApprovedHostnames(text);
}

export function assertWoff2(bytes, relativePath) {
  if (bytes.length < 4 || bytes.subarray(0, 4).toString("ascii") !== "wOF2") {
    throw new Error(`A font artifact does not have the expected WOFF2 signature: ${relativePath}`);
  }
}

export function matchApprovedRaster(bytes, relativePath, manifest) {
  const basename = path.posix.basename(relativePath.split(path.sep).join("/"));
  const digest = sha256(bytes);
  const entry = manifest.find((candidate) => {
    if (candidate.sha256 !== digest) return false;
    const expectedName = new RegExp(
      `^${escapeRegExp(candidate.outputBasename)}(?:\\.[A-Za-z0-9_-]+)?${escapeRegExp(candidate.extension)}$`,
    );
    return expectedName.test(basename);
  });
  if (entry === undefined) {
    throw new Error(`Unreviewed or modified raster cannot be published: ${relativePath}`);
  }
  return entry;
}

function expectAccepted(label, operation) {
  try {
    operation();
  } catch (error) {
    throw new Error(
      `Validator self-test unexpectedly rejected ${label}: ${error instanceof Error ? error.message : error}`,
      { cause: error },
    );
  }
}

function expectRejected(label, operation, expectedMessage) {
  let error;
  try {
    operation();
  } catch (caught) {
    error = caught;
  }
  if (!(error instanceof Error) || !error.message.includes(expectedMessage)) {
    throw new Error(`Validator self-test did not reject ${label} as ${expectedMessage}.`);
  }
}

export function runPrivacyGuardSelfTest() {
  expectAccepted("approved public text", () =>
    assertNoOperatorData(
      'See https://developers.cloudflare.com/d1/ and <a href="/home/settings/profile">settings</a>. Fetch /api/users/123.',
    ),
  );
  expectAccepted("documented placeholders", () =>
    assertNoOperatorData(
      'POLICY_AUD = "replace-with-production-access-audience"; database_id = "00000000-0000-0000-0000-000000000000"',
    ),
  );
  expectAccepted("minified JavaScript property calls", () =>
    assertNoOperatorData("Oa.test(value); ft.test(node.className);"),
  );

  const operatorCases = [
    ["email", "operator@private.example", "email address"],
    ["UUID", "123e4567-e89b-12d3-a456-426614174000", "non-placeholder UUID"],
    ["JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvcGVyYXRvciJ9.YWJjZGVmZ2hpamtsbW5vcA", "JWT-shaped"],
    ["macOS path", "/Users/operator/project/.dev.vars", "filesystem path"],
    ["Linux path", "/home/operator/project/.env", "filesystem path"],
    ["macOS temporary path", "/var/folders/aa/private/item", "filesystem path"],
    ["private temporary path", "/private/tmp/operator/export", "filesystem path"],
    ["root path", "/root/project/config", "filesystem path"],
    ["volume path", "/Volumes/Private/project", "filesystem path"],
    ["Windows path", "C:/Users/operator/project/.env", "filesystem path"],
    ["UNC path", "\\\\fileserver\\operator\\private", "UNC filesystem path"],
    ["file URL", "file:///Users/operator/project", "filesystem path"],
    ["unapproved URL host", "https://operator-private.example.org/path", "unapproved"],
    ["unapproved bare host", "operator-private.example.org", "unapproved"],
    ["private IPv4 host", "http://192.168.1.7/config", "unapproved"],
    ["single-label host", "http://intranet/private", "unapproved"],
    ["protocol-relative host", "//operator-private.example.org/path", "unapproved"],
    ["escaped host", "https:\\/\\/operator-private.example.org/private", "unapproved"],
    ["private key", "-----BEGIN PRIVATE KEY-----", "Private-key"],
    ["GitHub credential", `ghp_${"A".repeat(36)}`, "provider credential"],
    ["bearer credential", `Bearer ${"Ab9_".repeat(10)}`, "bearer credential"],
    ["Access audience", 'POLICY_AUD = "2f7a93c10b4e58d61a7c92e30f4b68d2"', "Access audience"],
    ["opaque credential", "Q7kN2pV9sR4xT8mW1zB6cD3fH0jL5yUa", "high-entropy credential-shaped"],
    ["inline source map", "//# sourceMappingURL=app.js.map", "Source-map"],
    ["embedded sources", '{"sourcesContent":["private"]}', "Source-map"],
  ];
  for (const [label, value, expectedMessage] of operatorCases) {
    expectRejected(label, () => assertNoOperatorData(value), expectedMessage);
  }

  for (const relativePath of [
    "secret.txt",
    "app.js.map",
    "app.js.map.gz",
    "backup/index.html.bak",
    "config/settings.html",
    "dump.sql.html",
    "private.pem",
    "state.sqlite",
    "archive.zip",
    "CNAME",
  ]) {
    expectRejected(relativePath, () => classifyPublicArtifact(relativePath), "artifact");
  }
  expectAccepted("ordinary HTML artifact", () => classifyPublicArtifact("guide/index.html"));

  const approvedBytes = Buffer.from("approved raster fixture");
  const manifest = [
    {
      source: "docs/assets/approved.png",
      outputBasename: "approved",
      extension: ".png",
      sha256: sha256(approvedBytes),
    },
  ];
  expectAccepted("approved raster", () =>
    matchApprovedRaster(approvedBytes, "assets/approved.hash.png", manifest),
  );
  expectRejected(
    "modified raster",
    () =>
      matchApprovedRaster(Buffer.from("private screenshot"), "assets/approved.hash.png", manifest),
    "Unreviewed or modified raster",
  );
  expectRejected(
    "renamed raster",
    () => matchApprovedRaster(approvedBytes, "assets/operator-screenshot.png", manifest),
    "Unreviewed or modified raster",
  );
}
