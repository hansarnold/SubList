import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitepress";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const canonicalSelfHostingPath = fileURLToPath(
  new URL("../../docs/self-hosting.md", import.meta.url),
);

function canonicalSelfHostingUpdatedAt(): number {
  try {
    const timestamp = execFileSync(
      "git",
      ["log", "-1", "--format=%ct", "--", "docs/self-hosting.md"],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    const seconds = Number.parseInt(timestamp, 10);
    if (Number.isSafeInteger(seconds) && seconds > 0) return seconds * 1000;
  } catch {
    // A source archive may not contain Git history; its file timestamp is the fallback.
  }

  return statSync(canonicalSelfHostingPath).mtimeMs;
}

export default defineConfig({
  lang: "en-US",
  title: "OpenSubLists",
  titleTemplate: ":title · OpenSubLists",
  description: "A simple, open-source subscription tracker for Cloudflare Workers and D1.",
  base: "/SubList/",
  head: [
    [
      "link",
      {
        rel: "icon",
        type: "image/png",
        sizes: "1024x1024",
        href: "/SubList/open-sublists-logo.png",
      },
    ],
  ],
  lastUpdated: true,
  sitemap: {
    hostname: "https://hansarnold.github.io/SubList/",
  },
  transformPageData(pageData) {
    if (pageData.filePath === "guide/self-hosting.md") {
      return { lastUpdated: canonicalSelfHostingUpdatedAt() };
    }
  },
  themeConfig: {
    logo: "/open-sublists-logo.png",
    nav: [
      { text: "Home", link: "/" },
      { text: "Self-hosting", link: "/guide/self-hosting" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [{ text: "Self-host on Cloudflare", link: "/guide/self-hosting" }],
      },
    ],
    outline: [2, 3],
    search: {
      provider: "local",
    },
    socialLinks: [{ icon: "github", link: "https://github.com/hansarnold/SubList" }],
    editLink: {
      pattern: ({ filePath }) => {
        const sourcePath =
          filePath === "guide/self-hosting.md" ? "docs/self-hosting.md" : `site/${filePath}`;
        return `https://github.com/hansarnold/SubList/edit/main/${sourcePath}`;
      },
      text: "Edit this page on GitHub",
    },
    lastUpdated: {
      text: "Last updated",
    },
    footer: {
      message: "Released under the MIT License.",
    },
  },
});
