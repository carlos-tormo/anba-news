import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BotData } from "./types.js";

const defaultData: BotData = {
  settings: {
    timezone: "Europe/Madrid",
    dailyQuestionCount: 5,
    askHour: 10,
    publishHour: 21,
    contextChannelIds: [],
    contextLookbackHours: 48
  },
  gms: {},
  prompts: [],
  rumors: [],
  submittedQuestions: [],
  articles: [],
  lastRun: {}
};

function mergeDefaults(data: Partial<BotData>): BotData {
  return {
    settings: { ...defaultData.settings, ...data.settings },
    gms: data.gms ?? {},
    prompts: data.prompts ?? [],
    rumors: data.rumors ?? [],
    submittedQuestions: data.submittedQuestions ?? [],
    articles: data.articles ?? [],
    lastRun: data.lastRun ?? {}
  };
}

export class JsonStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async read(): Promise<BotData> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return mergeDefaults(JSON.parse(raw) as Partial<BotData>);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return structuredClone(defaultData);
      }
      throw error;
    }
  }

  async write(data: BotData): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await rename(tmpPath, this.filePath);
  }

  async mutate<T>(fn: (data: BotData) => T | Promise<T>): Promise<T> {
    const run = async () => {
      const data = await this.read();
      const result = await fn(data);
      await this.write(data);
      return result;
    };

    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
