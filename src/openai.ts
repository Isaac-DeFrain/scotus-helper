import { wrapOpenAI } from "langsmith/wrappers/openai";
import OpenAI from "openai";

export function openaiClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  return wrapOpenAI(new OpenAI({ apiKey }));
}
