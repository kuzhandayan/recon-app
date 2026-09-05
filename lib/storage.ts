import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function normalizeEndpoint(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  return /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
}

// B2's S3-compatible API, see docs/ARCHITECTURE.md#file-storage
const client = new S3Client({
  endpoint: normalizeEndpoint(process.env.B2_ENDPOINT),
  region: "us-east-005",
  credentials: {
    accessKeyId: process.env.B2_KEY_ID!,
    secretAccessKey: process.env.B2_APPLICATION_KEY!,
  },
});

const BUCKET = process.env.B2_BUCKET_NAME!;

export function b2Configured(): boolean {
  return Boolean(process.env.B2_KEY_ID && process.env.B2_APPLICATION_KEY && process.env.B2_BUCKET_NAME && process.env.B2_ENDPOINT);
}

export async function uploadRawFile(key: string, body: Buffer, contentType: string): Promise<void> {
  await client.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
}

export async function fetchRawFile(key: string): Promise<string> {
  const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return res.Body!.transformToString("utf-8");
}

// Never stored — generated fresh each time it's needed, expires in 5 minutes
export function getDownloadUrl(key: string): Promise<string> {
  return getSignedUrl(client, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 300 });
}
