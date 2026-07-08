import path from "path";

import { restoreEnvVars } from "./test/restoreEnvVars";

async function loadChatDbPath(): Promise<string> {
  jest.resetModules();
  const { CHAT_DB_PATH } = await import("./constants");
  return CHAT_DB_PATH;
}

describe("CHAT_DB_PATH", () => {
  const chatDbPathEnv = process.env.CHAT_DB_PATH;

  afterEach(() => {
    restoreEnvVars({ CHAT_DB_PATH: chatDbPathEnv });
    jest.resetModules();
  });

  it("defaults to data/chat.db under cwd when env is unset", async () => {
    delete process.env.CHAT_DB_PATH;
    expect(await loadChatDbPath()).toBe(
      path.join(process.cwd(), "data", "chat.db"),
    );
  });

  it("uses CHAT_DB_PATH when set", async () => {
    const CHAT_DB_PATH = "/app/chat-data/chat.db";
    process.env.CHAT_DB_PATH = CHAT_DB_PATH;
    expect(await loadChatDbPath()).toBe(CHAT_DB_PATH);
  });
});
