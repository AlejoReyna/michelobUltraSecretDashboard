export type ExporterConfig = {
  cascadeAiPath: string;
  token: string | undefined;
  dashboardOrigin: string | undefined;
  port: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ExporterConfig {
  return {
    cascadeAiPath: env.CASCADE_AI_PATH ?? "/home/ec2-user/cascade-ai",
    token: env.AGENT_EXPORTER_TOKEN,
    dashboardOrigin: env.VERCEL_DASHBOARD_ORIGIN,
    port: Number.parseInt(env.PORT ?? "8787", 10),
  };
}
