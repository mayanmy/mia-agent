export type AppConfig = {
  appName: string;
  appVersion: string;
  environment: string;
  apiPrefix: string;
  port: number;
};

export function getConfig(): AppConfig {
  return {
    appName: process.env.MIA_APP_NAME ?? 'Mia',
    appVersion: process.env.MIA_APP_VERSION ?? '0.1.0',
    environment: process.env.MIA_ENVIRONMENT ?? 'local',
    apiPrefix: process.env.MIA_API_PREFIX ?? '/api/v1',
    port: Number(process.env.PORT ?? 8000),
  };
}

