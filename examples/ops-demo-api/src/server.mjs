import { createOpsDemoServer } from "./app.mjs";

const port = Number.parseInt(process.env.PORT ?? "3100", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

const server = createOpsDemoServer();
server.listen(port, "0.0.0.0", () => {
  console.log(`Mia Ops Demo API listening on http://0.0.0.0:${port}`);
});

function shutdown() {
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
