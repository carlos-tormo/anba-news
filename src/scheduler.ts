import type { Client } from "discord.js";
import {
  askRandomGms,
  markAskedToday,
  markPublishedToday,
  publishNews
} from "./journalist.js";
import { getZonedNow } from "./time.js";
import type { JsonStore } from "./store.js";

export function startScheduler(client: Client, store: JsonStore): NodeJS.Timeout {
  const tick = async () => {
    const data = await store.read();
    const now = getZonedNow(data.settings.timezone);

    if (now.hour === data.settings.askHour && data.lastRun.askedDate !== now.dateKey) {
      const result = await askRandomGms(client, store, data.settings.dailyQuestionCount);
      await markAskedToday(store, result);
      console.log(
        `[scheduler] ${now.dateKey} asked ${result.sent}/${result.attempted} GM(s), failed ${result.failed}.`
      );
    }

    if (now.hour === data.settings.publishHour && data.lastRun.publishedDate !== now.dateKey) {
      const result = await publishNews(client, store);
      await markPublishedToday(store, result);
      console.log(
        result.posted
          ? `[scheduler] ${now.dateKey} published "${result.title}".`
          : `[scheduler] ${now.dateKey} skipped publishing: ${result.reason}`
      );
    }
  };

  void tick().catch((error) => console.error("[scheduler] initial tick failed", error));
  return setInterval(() => {
    void tick().catch((error) => console.error("[scheduler] tick failed", error));
  }, 60_000);
}
