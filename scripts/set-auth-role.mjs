import { existsSync } from "node:fs";
import process from "node:process";
import pg from "pg";

const { Pool } = pg;
const args = process.argv.slice(2);
const roles = new Set(["admin", "user"]);

// Next.js loads .env.local automatically, but this standalone Node script does not.
if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

function option(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function usage(message) {
  if (message) {
    console.error(message);
  }

  console.error(
    "Usage: npm run auth:set-role -- --username <name> --role <admin|user>",
  );
  process.exit(1);
}

const username = option("--username")?.trim().toLowerCase();
const role = option("--role")?.trim().toLowerCase();
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  usage("DATABASE_URL is required.");
}

if (!username) {
  usage("A username is required.");
}

if (!role || !roles.has(role)) {
  usage("Role must be either admin or user.");
}

const pool = new Pool({ connectionString: databaseUrl });
const client = await pool.connect();

try {
  await client.query("BEGIN");

  const targetResult = await client.query(
    "select id, role from users where lower(username) = $1 limit 1 for update",
    [username],
  );
  const target = targetResult.rows[0];

  if (!target) {
    throw new Error(`No account was found for username ${username}.`);
  }

  if (target.role === role) {
    await client.query("COMMIT");
    console.log(`${username} already has the ${role} role.`);
    process.exitCode = 0;
  } else {
    if (target.role === "admin" && role === "user") {
      const adminCountResult = await client.query(
        "select count(*)::integer as count from users where role = 'admin'",
      );

      if (adminCountResult.rows[0].count <= 1) {
        throw new Error("The last administrator cannot be demoted.");
      }
    }

    await client.query(
      "update users set role = $1, updated_at = $2 where id = $3",
      [role, new Date(), target.id],
    );
    await client.query("COMMIT");
    console.log(`Assigned the ${role} role to ${username}.`);
  }
} catch (error) {
  await client.query("ROLLBACK");

  if (error?.code === "42703") {
    throw new Error(
      "The users.role column is missing. Update the database schema before assigning roles.",
      { cause: error },
    );
  }

  throw error;
} finally {
  client.release();
  await pool.end();
}
