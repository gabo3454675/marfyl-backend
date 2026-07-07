const { readFileSync } = require("fs");
const { resolve } = require("path");
const { PrismaClient } = require("@prisma/client");

const env = readFileSync(resolve(__dirname, "../.env"), "utf8");
const match = env.match(/^DATABASE_URL="([^"]+)"/m);
const dbUrl = match?.[1] ?? process.env.DATABASE_URL;

async function test() {
  console.log("URL protocol:", dbUrl?.slice(0, 16));

  const base = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  try {
    await base.$connect();
    console.log("base connect: OK");
    await base.$disconnect();
  } catch (e) {
    console.log("base connect FAIL:", e.code, e.message);
  }

  const base2 = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const ext = base2.$extends({
    name: "t",
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          return query(args);
        },
      },
    },
  });

  try {
    await ext.$connect();
    console.log("extended connect: OK");
    await ext.$disconnect();
  } catch (e) {
    console.log("extended connect FAIL:", e.code, e.message);
  }

  const localhost =
    "postgresql://test:test@localhost:5432/test?schema=public";
  const local = new PrismaClient({
    datasources: { db: { url: localhost } },
  });
  try {
    await local.$connect();
    console.log("localhost connect: OK");
    await local.$disconnect();
  } catch (e) {
    console.log("localhost connect FAIL:", e.code, e.message);
  }
}

test();
