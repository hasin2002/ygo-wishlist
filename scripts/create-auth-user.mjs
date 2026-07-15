import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import process from "node:process";
import { hashPassword } from "better-auth/crypto";
import pg from "pg";

const { Pool } = pg;
const args = process.argv.slice(2);

// Next.js loads .env.local automatically, but this standalone Node script does not.
if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

function option(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function hasFlag(name) {
  return args.includes(name);
}

function usage(message) {
  if (message) {
    console.error(message);
  }

  console.error(
    "Usage: npm run auth:create-user -- --username <name> [--name <display name>] [--email <email>] [--public] [--claim-existing]",
  );
  process.exit(1);
}

async function promptForPassword() {
  if (!process.stdin.isTTY) {
    usage("Run this command in an interactive terminal so it can ask for a password.");
  }

  const readPassword = (label) =>
    new Promise((resolve, reject) => {
      const input = process.stdin;
      let password = "";

      process.stdout.write(label);
      input.setEncoding("utf8");
      input.setRawMode(true);
      input.resume();

      const done = () => {
        input.off("data", onData);
        input.setRawMode(false);
        input.pause();
      };

      const onData = (key) => {
        if (key === "\u0003") {
          done();
          reject(new Error("Cancelled."));
          return;
        }

        if (key === "\r" || key === "\n") {
          done();
          process.stdout.write("\n");
          resolve(password);
          return;
        }

        if (key === "\u007f" || key === "\b") {
          password = password.slice(0, -1);
          return;
        }

        password += key;
      };

      input.on("data", onData);
    });

  const password = await readPassword("Password: ");
  const confirmation = await readPassword("Confirm password: ");

  if (password !== confirmation) {
    usage("Passwords did not match.");
  }

  return password;
}

const username = option("--username")?.trim().toLowerCase();
const name = option("--name")?.trim() || username;
const email = option("--email")?.trim().toLowerCase() || `${username}@local.invalid`;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  usage("DATABASE_URL is required.");
}

if (!username || !/^[a-z0-9_.]{3,40}$/.test(username)) {
  usage("Username must be 3-40 characters using letters, numbers, dots, or underscores.");
}

if (!name) {
  usage("A display name is required.");
}

const password = await promptForPassword();

if (password.length < 12 || password.length > 128) {
  usage("Password must be between 12 and 128 characters.");
}

const pool = new Pool({ connectionString: databaseUrl });
const client = await pool.connect();

try {
  await client.query("BEGIN");

  const duplicate = await client.query(
    "select id from users where username = $1 or email = $2 limit 1",
    [username, email],
  );

  if (duplicate.rowCount) {
    throw new Error("A user with that username or email already exists.");
  }

  const userId = randomUUID();
  const now = new Date();
  const publicCollection = hasFlag("--public");

  if (publicCollection) {
    await client.query("update users set public_collection = false where public_collection = true");
  }

  await client.query(
    `insert into users (id, name, email, email_verified, username, display_username, public_collection, created_at, updated_at)
     values ($1, $2, $3, false, $4, $5, $6, $7, $7)`,
    [userId, name, email, username, name, publicCollection, now],
  );

  await client.query(
    `insert into accounts (id, account_id, provider_id, user_id, password, created_at, updated_at)
     values ($1, $2, 'credential', $2, $3, $4, $4)`,
    [randomUUID(), userId, await hashPassword(password), now],
  );

  if (hasFlag("--claim-existing")) {
    await client.query("update cards set owner_id = $1 where owner_id is null", [userId]);
    await client.query("update binder_slots set owner_id = $1 where owner_id is null", [userId]);
    await client.query("update wheel_entries set owner_id = $1 where owner_id is null", [userId]);
    await client.query("update monthly_favorites set owner_id = $1 where owner_id is null", [userId]);
  }

  await client.query("COMMIT");
  console.log(`Created ${username}${publicCollection ? " as the public collection owner" : ""}.`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
