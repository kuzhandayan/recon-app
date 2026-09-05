import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaClient } from "@/app/generated/prisma/client";

// Neon over WebSocket/443 instead of Postgres/5432, which some networks block
neonConfig.webSocketConstructor = WebSocket;

type PrismaClientInstance = InstanceType<typeof PrismaClient>;

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClientInstance };

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });

export const db: PrismaClientInstance = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
