import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { getConfig } from './core/config';
import { ResultInterceptor } from './core/result.interceptor';

async function bootstrap() {
  const config = getConfig();
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix(config.apiPrefix.replace(/^\//u, ''));
  app.useGlobalInterceptors(new ResultInterceptor());

  await app.listen(config.port);
}

void bootstrap();

