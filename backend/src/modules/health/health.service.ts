import { Injectable } from '@nestjs/common';

import { getConfig } from '../../core/config';
import { PrismaService } from '../prisma/prisma.service';

export type HealthResponse = {
  status: string;
  appName: string;
  version: string;
  environment: string;
  database: string;
};

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async getHealth(): Promise<HealthResponse> {
    const config = getConfig();
    const databaseOk = await this.prisma.checkDatabase();

    return {
      status: databaseOk ? 'ok' : 'degraded',
      appName: config.appName,
      version: config.appVersion,
      environment: config.environment,
      database: databaseOk ? 'ok' : 'unavailable',
    };
  }
}

