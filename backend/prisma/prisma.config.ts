import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma 7 config. `datasource.url` is the migration/pooled URL; the
// runtime client passes a driver adapter (see src/lib/prisma.ts).
// `directUrl` is used by `prisma migrate` when set (Neon/Supabase pattern).
// @ts-ignore - Prisma 7 config typings are still early-access.
export default defineConfig({
  earlyAccess: true,
  schema: './schema.prisma',
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL!,
  },
  migrations: {
    path: './migrations',
  },
});
