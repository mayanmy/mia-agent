import { Global, Module } from "@nestjs/common";

import { RedisKeyFactory } from "./redis-key.factory";
import { RedisService } from "./redis.service";

@Global()
@Module({
  providers: [RedisService, RedisKeyFactory],
  exports: [RedisService, RedisKeyFactory]
})
export class RedisModule {}
