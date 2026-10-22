import { Injectable } from "@nestjs/common";

import { getConfig } from "../../core/config";

@Injectable()
export class RedisKeyFactory {
  private readonly prefix = getConfig().redis.prefix.replace(/:+$/u, "");

  create(...segments: string[]): string {
    const normalized = segments.map((segment) => {
      const value = segment.trim();
      if (!value || value.includes(":")) {
        throw new Error("Redis key segment must be non-empty and must not contain ':'");
      }
      return value;
    });
    return [this.prefix, ...normalized].join(":");
  }

  queuePrefix(): string {
    return `${this.prefix}:queue`;
  }
}
