import { env } from "cloudflare:workers";
import { afterEach, describe, expect, inject, it } from "vitest";

const migrations = inject("migrations");
const SHADOW_USERS_TABLE = "locale_migration_users";

describe("split-locale D1 migration", () => {
  afterEach(async () => {
    await env.DB.prepare(`DROP TABLE IF EXISTS ${SHADOW_USERS_TABLE}`).run();
  });

  it("backfills email_locale from every populated preferred_locale value", async () => {
    const migration = migrations.find((candidate) =>
      candidate.name.startsWith("0007_split_interface_email_locales"),
    );
    expect(migration).toBeDefined();
    await env.DB.prepare(
      `CREATE TABLE ${SHADOW_USERS_TABLE} (
         id TEXT PRIMARY KEY,
         preferred_locale TEXT NOT NULL DEFAULT 'en'
           CHECK (preferred_locale IN ('en', 'zh-Hans'))
       )`,
    ).run();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO ${SHADOW_USERS_TABLE} (id, preferred_locale) VALUES (?, ?)`).bind(
        "english-user",
        "en",
      ),
      env.DB.prepare(`INSERT INTO ${SHADOW_USERS_TABLE} (id, preferred_locale) VALUES (?, ?)`).bind(
        "chinese-user",
        "zh-Hans",
      ),
    ]);

    for (const query of migration?.queries ?? []) {
      await env.DB.prepare(query.replaceAll("users", SHADOW_USERS_TABLE)).run();
    }

    const result = await env.DB.prepare(
      `SELECT id, preferred_locale, email_locale
       FROM ${SHADOW_USERS_TABLE}
       ORDER BY id`,
    ).all<{
      id: string;
      preferred_locale: string;
      email_locale: string;
    }>();
    expect(result.results).toEqual([
      { id: "chinese-user", preferred_locale: "zh-Hans", email_locale: "zh-Hans" },
      { id: "english-user", preferred_locale: "en", email_locale: "en" },
    ]);
    await expect(
      env.DB.prepare(`UPDATE ${SHADOW_USERS_TABLE} SET email_locale = 'fr'`).run(),
    ).rejects.toThrow();
  });
});
